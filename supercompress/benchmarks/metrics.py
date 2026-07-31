"""
Sustainability and quality metrics for SuperCompress compression.

Provides calculations for:
- CO₂ / kWh savings from token reduction
- Compression quality scoring (retention vs. reduction)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


# Approximate energy per token (industry averages)
# Source: https://arxiv.org/abs/2310.07256
KWH_PER_TOKEN = 0.0000005  # ~0.5 µWh per token
CO2_PER_KWH = 0.4  # kg CO₂ per kWh (global average grid)


@dataclass
class SustainabilityMetrics:
    """Sustainability impact from token savings."""

    tokens_saved: int
    kwh_saved: float
    co2_saved_kg: float
    equivalent_km_driven: float  # approximate car km equivalent

    def to_dict(self) -> dict[str, Any]:
        return {
            "tokens_saved": self.tokens_saved,
            "kwh_saved": round(self.kwh_saved, 4),
            "co2_saved_kg": round(self.co2_saved_kg, 4),
            "equivalent_km_driven": round(self.equivalent_km_driven, 1),
        }


def sustainability_from_tokens_saved(tokens_saved: int) -> SustainabilityMetrics:
    """Calculate environmental impact of token savings.

    Args:
        tokens_saved: Number of tokens that were not sent to the LLM.

    Returns:
        A :class:`SustainabilityMetrics` with kWh saved, CO₂ saved,
        and equivalent car kilometers.
    """
    kwh = tokens_saved * KWH_PER_TOKEN
    co2 = kwh * CO2_PER_KWH
    # Avg car emits ~0.12 kg CO₂/km
    km_equiv = co2 / 0.12 if co2 > 0 else 0.0
    return SustainabilityMetrics(
        tokens_saved=tokens_saved,
        kwh_saved=kwh,
        co2_saved_kg=co2,
        equivalent_km_driven=km_equiv,
    )


def compression_quality_score(
    original_tokens: int,
    kept_tokens: int,
    confidence: float = 1.0,
) -> float:
    """Compute a composite quality score (0–1) for a compression result.

    Balances reduction ratio against confidence:
        ``score = (1 - kept/original) * confidence``

    Args:
        original_tokens: Token count before compression.
        kept_tokens: Token count after compression.
        confidence: Quality/confidence score from the verifier (0–1).

    Returns:
        A quality score between 0 and 1.
    """
    if original_tokens == 0:
        return 0.0
    reduction = 1 - (kept_tokens / original_tokens)
    return reduction * confidence


__all__ = [
    "sustainability_from_tokens_saved",
    "compression_quality_score",
    "SustainabilityMetrics",
]
