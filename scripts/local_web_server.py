#!/usr/bin/env python3
"""Local dev server — optional FastAPI wrapper around compress API. Not used on Vercel."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from supercompress import compare_policies, compress_detailed, compress_for_turn
from supercompress.api.router import router as api_router

api = FastAPI(title="SuperCompress Web", version="0.1.0")
api.include_router(api_router)
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CompressRequest(BaseModel):
    context: str = Field(..., min_length=1, max_length=120_000)
    query: str = Field(default="Summarize this context.", max_length=2000)
    budget_ratio: float = Field(default=0.35, ge=0.05, le=1.0)
    compare: bool = False


def _result_dict(r) -> dict:
    return {
        "original_tokens": r.original_tokens,
        "kept_tokens": r.kept_tokens,
        "tokens_saved_pct": round(r.tokens_saved_pct, 2),
        "kept_line_ratio": round(r.kept_line_ratio, 3),
        "policy_name": r.policy_name,
        "budget_ratio": r.budget_ratio,
        "compressed_text": r.compressed_text,
    }


@api.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "supercompress-web"}


@api.post("/api/compress")
def compress(body: CompressRequest) -> dict:
    return _demo_compress(body)


@api.post("/api/demo/compress")
def demo_compress(body: CompressRequest) -> dict:
    return _demo_compress(body)


def _demo_compress(body: CompressRequest) -> dict:
    try:
        compressed, result = compress_for_turn(
            [body.context],
            body.query,
            budget_ratio=body.budget_ratio,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    out = {"compressed_text": compressed, **_result_dict(result)}
    out["original_chars"] = len(body.context)
    out["compressed_chars"] = len(compressed)
    out["char_savings_pct"] = round(
        (1 - len(compressed) / max(len(body.context), 1)) * 100, 2
    )
    out["tokens_saved"] = max(0, result.original_tokens - result.kept_tokens)
    if body.compare:
        cmp = compare_policies(body.context, body.query, budget_ratio=body.budget_ratio)
        out["compare"] = {name: _result_dict(r) for name, r in cmp.items()}
    _, annotations = compress_detailed(body.context, body.query, budget_ratio=body.budget_ratio)
    out["line_annotations"] = [
        {"line_index": a.line_index, "text": a.text, "kept": a.kept, "reason": a.reason}
        for a in annotations
    ]
    return out


@api.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


@api.get("/dashboard")
@api.get("/dashboard.html")
def dashboard() -> FileResponse:
    return FileResponse(WEB / "dashboard.html")


api.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")


def main() -> None:
    import os

    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8790"))
    uvicorn.run(api, host=host, port=port)


if __name__ == "__main__":
    main()
