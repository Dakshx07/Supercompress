#!/usr/bin/env python3
"""Export EvictionPolicyNetwork weights to JSON for browser inference."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import torch

from supercompress.features import FEATURE_DIM
from supercompress.model import EvictionPolicyNetwork


def export(checkpoint: Path, out: Path) -> dict:
    model = EvictionPolicyNetwork(feature_dim=FEATURE_DIM)
    try:
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    except TypeError:
        state = torch.load(checkpoint, map_location="cpu")
    model.load_state_dict(state)
    model.eval()

    layers = []
    for module in model.net:
        if isinstance(module, torch.nn.Linear):
            layers.append(
                {
                    "type": "linear",
                    "weight": module.weight.detach().tolist(),
                    "bias": module.bias.detach().tolist(),
                }
            )
        elif isinstance(module, torch.nn.LayerNorm):
            layers.append(
                {
                    "type": "layernorm",
                    "weight": module.weight.detach().tolist(),
                    "bias": module.bias.detach().tolist(),
                }
            )
        else:
            layers.append({"type": module.__class__.__name__.lower()})

    payload = {
        "feature_dim": FEATURE_DIM,
        "hidden_dim": 64,
        "layers": layers,
        "policy_name": "SuperCompress",
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    return payload


def main() -> None:
    ckpt = ROOT / "checkpoints" / "default.pt"
    out = ROOT / "web" / "assets" / "data" / "model.json"
    if not ckpt.exists():
        raise SystemExit(f"Checkpoint not found: {ckpt}")
    export(ckpt, out)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
