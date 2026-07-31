# Changelog

## 0.5.6 — 2026-07-31

- Every-message compress threshold lowered (compress prompts ≥40 chars; tiny ones still write inbox).

## 0.5.5 — 2026-07-31

- **Every-message auto-compress**: Cursor `beforeSubmitPrompt` writes `~/.supercompress/inbox/latest.md` on every submit; Claude Code + Codex `UserPromptSubmit` inject compressed digests; `postToolUse` threshold lowered to 800 chars.
- Cursor always-on rule forces Read of inbox digest first every turn.

## Unreleased

- (rolled into 0.5.5)

## 0.5.4 — 2026-07-28

- OpenCode MCP: write `enabled: true`, `timeout: 60000`, and `experimental.mcp_timeout` (OpenCode’s default tool-fetch timeout is 5s). Prefer `supercompress-mcp` on PATH over a baked absolute Node path.

## 0.5.3 — 2026-07-28

- Harden MCP stdio server against `-32000: Connection closed`: catch unhandled errors, keep process alive on tool failures, timeouts on API calls, stderr-only logging, drop unused elicitation capability.

## 0.5.2 — 2026-07-26

- Ship LICENSE + CHANGELOG in the npm tarball.

## 0.5.1 — 2026-07-26

- **postinstall is guidance-only** — no longer rewrites agent MCP configs on `npm install`. Use `supercompress setup` or `supercompress plugin`.
- **FreeBuff dual-launch** — MCP compress handshake waits for tool responses (no early timeout flake).
- Docs/README aligned with MCP-first install path; agent catalog count 49.

## 0.5.0 — 2026-07-26

- MCP-first coding-agent plugin (`compress_context`, `connect_account`, `usage_summary`).
- Optional localhost API proxy via `supercompress setup --proxy`.
