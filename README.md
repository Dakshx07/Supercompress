# SuperCompress

**Query-aware context compression for LLMs and coding agents.**

SuperCompress sits between your app and the model. It takes a long context plus the current query, removes low-value tokens, keeps answer-critical evidence, and returns a smaller prompt — typically **~65% fewer input tokens**.

[![GitHub](https://img.shields.io/badge/GitHub-Supercompress-181717?style=flat&logo=github&logoColor=white)](https://github.com/Supercompress/Supercompress)
[![PyPI](https://img.shields.io/pypi/v/supercompress?style=flat&logo=python&logoColor=white)](https://pypi.org/project/supercompress/)
[![npm](https://img.shields.io/npm/v/supercompress-proxy?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/supercompress-proxy)
[![License](https://img.shields.io/badge/license-Non--Commercial-3da639?style=flat)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-supercompress.dev-2563eb?style=flat)](https://www.supercompress.dev/docs/)

**Site:** [supercompress.dev](https://www.supercompress.dev) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md) · **Dashboard:** [get an API key](https://www.supercompress.dev/dashboard)

---

## Why

Most LLM apps accumulate context faster than they accumulate signal: retrieved chunks, chat history, tool dumps, logs, JSON. Models reread that waste on every call.

SuperCompress compiles the context **before** inference:

- Segments into blocks (not blind truncation)
- Detects text, code, JSON, logs, traces
- Scores blocks against the current query
- Keeps entities, definitions, errors, nearby deps
- Drops boilerplate, duplicates, filler
- Reports tokens saved and estimated risk

The **query is never compressed** — only the surrounding context.

## Install

### Python

```bash
pip install supercompress
export SUPERCOMPRESS_API_KEY=sc_live_YOUR_KEY
```

### Coding agents (Cursor, Claude Code, Codex, …)

```bash
npm install -g supercompress-proxy
npx supercompress setup
```

Docs: [Coding agents](https://www.supercompress.dev/docs/coding-agents)

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

HTTP:

```bash
curl -X POST https://www.supercompress.dev/api/v1/compress \
  -H "X-API-Key: $SUPERCOMPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"context":"...","query":"What failed?"}'
```

## Repo layout

| Path | Purpose |
|------|---------|
| `supercompress/` | Python compression library |
| `api/` | Hosted API (Vercel serverless) |
| `web/` | Product site + docs |
| `packages/proxy` | Coding-agent plugin (`supercompress-proxy`) |
| `integrations/` · `examples/` | Drop-in integrations |

## Development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .

# Static site
cd web && python -m http.server 8080
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Source of truth

- **Public code & issues:** [github.com/Supercompress/Supercompress](https://github.com/Supercompress/Supercompress)
- **CI/CD pipelines:** private GitLab mirror (internal builds/deploy)

## License

[Non-commercial license](./LICENSE) — personal, research, and evaluation use welcome. Commercial use needs a separate license.

---

Built by [Arjun Shah](https://github.com/arjunkshah12345-hash) · [supercompress.dev](https://www.supercompress.dev)
