"""SuperCompress benchmarks — compression quality and sustainability metrics."""

from .metrics import (
    sustainability_from_tokens_saved,
    compression_quality_score,
)

__all__ = [
    "sustainability_from_tokens_saved",
    "compression_quality_score",
]
