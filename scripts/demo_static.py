#!/usr/bin/env python3
"""Static demo server — SuperCompress landing page + in-browser impact demo."""

from __future__ import annotations

import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
PORT = int(os.environ.get("PORT", "8791"))

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".mp4": "video/mp4",
}


def resolve_static(path: str) -> Path | None:
    path = path.split("?", 1)[0]
    if path in ("/", ""):
        path = "/index.html"
    elif path == "/dashboard":
        path = "/dashboard.html"
    rel = path.lstrip("/")
    if not rel or ".." in rel.split("/"):
        return None
    candidate = (WEB / rel).resolve()
    try:
        candidate.relative_to(WEB.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _respond(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        file_path = resolve_static(self.path)
        if not file_path:
            return self._respond(404, b"Not found", "text/plain")
        suffix = file_path.suffix.lower()
        ctype = MIME.get(suffix) or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        return self._respond(200, file_path.read_bytes(), ctype)

    def do_HEAD(self):
        file_path = resolve_static(self.path)
        if not file_path:
            self.send_response(404)
            self.end_headers()
            return
        suffix = file_path.suffix.lower()
        ctype = MIME.get(suffix) or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()


def main() -> None:
    if not WEB.is_dir():
        raise SystemExit(f"Missing web folder: {WEB}")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"SuperCompress demo → http://127.0.0.1:{PORT}")
    print(f"Serving {WEB}")
    print("Impact demo + launch video run fully in-browser.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
