#!/usr/bin/env python3
"""
Train SuperCompress Verifier — tiny 200-param confidence classifier.

Estimates probability that compression preserved answer quality.
Outputs: checkpoints/verifier.pt + web/assets/data/verifier.json
Runs on CPU, ~30 seconds on MacBook Air.
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np
import torch
import torch.nn as nn

from supercompress.features import TokenRecord, SemanticType
from supercompress.oracle import extract_question_entities
from supercompress.simulator import generate_long_context, build_token_records

VERIFIER_FEATURE_DIM = 16


class CompressionVerifier(nn.Module):
    """
    Tiny 2-layer MLP that scores compression quality.

    Input: 16 features describing the compression outcome
    Output: sigmoid probability that answer quality >= 0.95
    """

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(VERIFIER_FEATURE_DIM, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)

    def confidence(self, x):
        return torch.sigmoid(self.forward(x))


def extract_verifier_features(compressed_text, original_text, question, records, kept_indices):
    """Build 16 features describing compression quality."""
    n = len(records)
    kept = len(kept_indices)
    kept_ratio = kept / max(n, 1)

    entities = extract_question_entities(question)
    entity_hits = sum(1 for e in entities if e in compressed_text)
    entity_total = max(len(entities), 1)
    entity_recall = entity_hits / entity_total

    terms = {t for t in question.lower().split()
             if t not in {"what", "how", "the", "is", "are", "does", "was", "were", "this", "that"}}
    term_hits = sum(1 for t in terms if t in compressed_text.lower())
    term_total = max(len(terms), 1)
    term_recall = term_hits / term_total

    important_kept = sum(1 for i in kept_indices if records[i].is_oracle_important)
    important_total = max(sum(1 for r in records if r.is_oracle_important), 1)
    important_pct = important_kept / important_total

    # Block-level features (approximate)
    num_blocks = max(1, n // 20)
    blocks_kept = max(1, kept // 20)
    block_density = min(1.0, blocks_kept / num_blocks)

    # Line variety
    lines_orig = original_text.split("\n")
    lines_comp = compressed_text.split("\n")
    line_variety = len(set(lines_comp)) / max(len(set(lines_orig)), 1)

    # Compression stats
    orig_tokens = n
    comp_tokens = kept
    token_reduction = 1 - (comp_tokens / max(orig_tokens, 1))

    feats = [
        kept_ratio,                     # 0: ratio of tokens kept
        entity_recall,                  # 1: entity recall
        term_recall,                    # 2: term/keyword recall
        important_pct,                  # 3: important token preservation
        block_density,                  # 4: block density
        line_variety,                   # 5: line variety ratio
        token_reduction,                # 6: token reduction
        min(1.0, kept / 50),           # 7: absolute kept count (scaled)
        1.0 if entity_recall > 0.9 else 0.0,  # 8: entity recall binary high
        1.0 if important_pct > 0.8 else 0.0,   # 9: important preservation binary high
        min(1.0, len(entities) / 10),          # 10: entity count
        min(1.0, len(terms) / 15),             # 11: term count
        1.0 if token_reduction > 0.5 else 0.0,  # 12: high compression binary
        _compression_entropy(records, kept_indices),  # 13: compression entropy
        _position_coverage(records, kept_indices),     # 14: position coverage
        1.0 if entity_recall > 0.9 and important_pct > 0.75 else 0.0,  # 15: combined quality signal
    ]
    return torch.tensor(feats, dtype=torch.float32)


def _compression_entropy(records, kept_indices):
    """How evenly distributed are kept tokens across the sequence?"""
    if not kept_indices:
        return 0.0
    kept_set = set(kept_indices)
    n = len(records)
    segments = max(5, n // 10)
    seg_size = max(1, n // segments)
    seg_counts = []
    for s in range(segments):
        start = s * seg_size
        end = min(n, (s + 1) * seg_size)
        seg_kept = sum(1 for i in range(start, end) if i in kept_set)
        seg_counts.append(seg_kept / max(end - start, 1))

    total = sum(seg_counts)
    if total == 0:
        return 0.0
    probs = [c / total for c in seg_counts]
    entropy = -sum(p * math.log(p) for p in probs if p > 0)
    max_entropy = math.log(segments)
    return min(1.0, entropy / max_entropy) if max_entropy > 0 else 0.0


def _position_coverage(records, kept_indices):
    """What fraction of positions have at least one kept token nearby?"""
    if not kept_indices:
        return 0.0
    kept_set = set(kept_indices)
    n = len(records)
    if n <= 1:
        return 1.0
    window = max(1, n // 20)
    covered = 0
    for i in range(0, n, window):
        if any(j in kept_set for j in range(i, min(n, i + window))):
            covered += 1
    segments = max(1, n // window)
    return covered / segments


def simulate_compression(records, budget_ratio=0.35):
    """Simulate compression using oracle importance ranking."""
    budget = max(1, int(len(records) * budget_ratio))
    scored = [(i, r.is_oracle_important, r.attention_mass) for i, r in enumerate(records)]
    scored.sort(key=lambda x: (-x[1], -x[2]))
    kept = sorted([s[0] for s in scored[:budget]])
    return kept


def generate_verifier_data(n_samples, rng, np_rng):
    """Generate labeled data for verifier training."""
    X, y = [], []

    for _ in range(n_samples):
        lines, question = generate_long_context(rng, target_tokens=rng.randint(200, 500))
        original = "\n".join(lines)
        records = build_token_records(lines, question, np_rng)

        # Compress at different budget ratios to get varied quality
        budget_ratio = rng.uniform(0.15, 0.55)
        kept = simulate_compression(records, budget_ratio)

        # Reconstruct compressed text
        tokens = []
        for line in lines:
            parts = __import__("re").findall(r"[A-Za-z_][A-Za-z0-9_]*|[^\s]", line) or [" "]
            tokens.extend(parts)

        # Map kept token indices to line indices
        kept_lines = set()
        tok_idx = 0
        for li, line in enumerate(lines):
            parts = __import__("re").findall(r"[A-Za-z_][A-Za-z0-9_]*|[^\s]", line) or [" "]
            for _ in parts:
                if tok_idx in kept:
                    kept_lines.add(li)
                tok_idx += 1

        compressed = "\n".join(lines[i] for i in sorted(kept_lines))

        # Extract features
        feats = extract_verifier_features(compressed, original, question, records, kept)
        X.append(feats)

        # Label: 1 if answer quality preserved (entity recall >= 0.9 AND important >= 0.75)
        entities = extract_question_entities(question)
        entity_hits = sum(1 for e in entities if e in compressed)
        entity_recall = entity_hits / max(len(entities), 1) if entities else 1.0
        important_kept = sum(1 for i in kept if records[i].is_oracle_important)
        important_total = max(sum(1 for r in records if r.is_oracle_important), 1)
        important_pct = important_kept / important_total

        label = 1.0 if (entity_recall >= 0.9 and important_pct >= 0.75) else 0.0
        y.append(label)

    X = torch.stack(X)
    y = torch.tensor(y, dtype=torch.float32)
    return X, y


def export_verifier(model, out_pt, out_json):
    """Export verifier weights to JSON."""
    torch.save(model.state_dict(), out_pt)

    layers = []
    for module in model.net:
        if isinstance(module, nn.Linear):
            layers.append({
                "type": "linear",
                "weight": module.weight.detach().tolist(),
                "bias": module.bias.detach().tolist(),
            })
        elif isinstance(module, nn.ReLU):
            layers.append({"type": "relu"})

    payload = {
        "feature_dim": VERIFIER_FEATURE_DIM,
        "hidden_dim": 8,
        "layers": layers,
        "policy_name": "SuperCompress Verifier",
    }

    out_pt.parent.mkdir(parents=True, exist_ok=True)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload), encoding="utf-8")

    print(f"Exported: {out_pt}")
    print(f"Exported: {out_json}")


def main():
    print("=" * 60)
    print("Training SuperCompress Verifier")
    print(f"Feature dimension: {VERIFIER_FEATURE_DIM}")
    print(f"Parameters: {sum(p.numel() for p in CompressionVerifier().parameters())}")
    print("=" * 60)

    rng = random.Random(42)
    np_rng = np.random.default_rng(42)

    model = CompressionVerifier()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-2)
    loss_fn = nn.BCEWithLogitsLoss()

    n_epochs = 50
    batch_size = 32
    n_train = 256

    for epoch in range(n_epochs):
        model.train()
        X, y = generate_verifier_data(batch_size, rng, np_rng)

        logits = model(X)
        loss = loss_fn(logits, y)

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        if (epoch + 1) % 10 == 0:
            with torch.no_grad():
                probs = torch.sigmoid(logits)
                acc = ((probs > 0.5) == (y > 0.5)).float().mean()
            print(f"Epoch {epoch+1:2d}/{n_epochs}  Loss: {loss.item():.4f}  Acc: {acc.item():.3f}")

    # Evaluate on held-out set
    model.eval()
    X_test, y_test = generate_verifier_data(64, rng, np_rng)
    with torch.no_grad():
        probs = torch.sigmoid(model(X_test))
        acc = ((probs > 0.5) == (y_test > 0.5)).float().mean()
        print(f"\nTest accuracy: {acc.item():.3f}")

    # Export
    ckpt_dir = ROOT / "checkpoints"
    ckpt_dir.mkdir(exist_ok=True)
    export_verifier(
        model,
        ckpt_dir / "verifier.pt",
        ROOT / "web" / "assets" / "data" / "verifier.json",
    )

    print("\nDone! Verifier model saved.")


if __name__ == "__main__":
    main()
