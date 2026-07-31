# SuperCompress

You’re paying your model to reread junk.

RAG dumps, chat history, tool output, logs, JSON blobs — most of it is irrelevant to the *current* question. Truncation throws away the answer. Summarization invents wording and loses evidence. SuperCompress does neither.

It takes a long **context** plus the **query**, keeps the lines that matter for that query, and drops the rest. Typical result: **~65% fewer input tokens**, with the evidence still in the prompt.

**Site:** [supercompress.dev](https://www.supercompress.dev) · **Docs:** [docs](https://www.supercompress.dev/docs/) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

[![PyPI](https://img.shields.io/pypi/v/supercompress?style=flat&logo=python&logoColor=white)](https://pypi.org/project/supercompress/)
[![npm](https://img.shields.io/npm/v/supercompress-proxy?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/supercompress-proxy)
[![License](https://img.shields.io/badge/license-Non--Commercial-3da639?style=flat)](LICENSE)

---

## The problem

Every LLM call ships a pile of context. Over a session that pile grows: retrieved chunks, previous turns, stack traces, file contents, search results. The model doesn’t know which parts answer *this* question, so it reads all of it — and you pay for all of it.

Common “fixes” fail in different ways:

| Approach | What goes wrong |
|----------|-----------------|
| Truncate / sliding window | Drops the line that had the answer |
| Summarize | Softens facts, loses IDs, errors, exact wording |
| Smaller model | Still pays for the same bloated prompt |

You need fewer tokens **without** guessing what the user asked.

## The solution

SuperCompress is **query-aware context compression**:

1. Split context into blocks (not one blind chop)
2. Notice what you’re looking at (text, code, JSON, logs, traces)
3. Score each block against the **current query**
4. Keep entities, errors, definitions, nearby dependencies
5. Drop boilerplate, duplicates, and filler
6. Return the smaller prompt + token counts

The **query is never compressed**. Only the surrounding context.

Use it in three places:

- **Python / HTTP API** — wrap your app’s `context` before the model call
- **Coding agents** — MCP plugin compresses big dumps inside Cursor, Claude Code, Codex, and others
- **Playground** — try a paste on [supercompress.dev/playground](https://www.supercompress.dev/playground)

---

## Install

### App / library (Python)

```bash
pip install supercompress
export SUPERCOMPRESS_API_KEY=sc_live_YOUR_KEY   # from https://www.supercompress.dev/dashboard
```

### Coding agents

```bash
npm install -g supercompress-proxy
npx supercompress setup
```

That links your account, detects installed agents, and registers the MCP tools (`compress_context`, `connect_account`, `usage_summary`). Keep your normal Cursor / Claude / Codex login — you don’t switch into provider API-key mode.

More: [Coding agents docs](https://www.supercompress.dev/docs/coding-agents)

---

## Quick start

```python
from supercompress.client import SuperCompress

sc = SuperCompress()
result = sc.compress(
    context=long_context,
    query="What failed and how do we fix it?",
)

print(result.compressed_text)
print(f"{result.original_tokens} → {result.kept_tokens} tokens")
```

Same thing over HTTP:

```bash
curl -X POST https://www.supercompress.dev/api/v1/compress \
  -H "X-API-Key: $SUPERCOMPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"context":"...","query":"What failed?"}'
```

---

## What’s in this repo

| Path | What it is |
|------|------------|
| `supercompress/` | Python client / compression library |
| `api/` | Hosted compress API |
| `web/` | Product site + docs |
| `packages/proxy` | Coding-agent plugin (`supercompress-proxy` on npm) |
| `integrations/` · `examples/` | Drop-in wrappers |

Issues and PRs: [github.com/Supercompress/Supercompress](https://github.com/Supercompress/Supercompress)

---

## Development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .

cd web && python -m http.server 8080
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[Non-commercial license](./LICENSE) — personal, research, and evaluation use are fine. Commercial use needs a separate license.

Built by [Arjun Shah](https://github.com/arjunkshah12345-hash) · [supercompress.dev](https://www.supercompress.dev)
