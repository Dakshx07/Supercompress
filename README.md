<div align="center">

<img src="https://www.supercompress.dev/assets/img/logo-chevrons.png" alt="SuperCompress" width="56" height="56" />

# SuperCompress

### Stop paying your model to reread junk.

Query-aware context compression for LLM apps and coding agents.  
Keep the evidence. Drop the filler. Cut ~**65%** of input tokens.

[Website](https://www.supercompress.dev) · [Playground](https://www.supercompress.dev/playground) · [Docs](https://www.supercompress.dev/docs/) · [Benchmarks](https://www.supercompress.dev/benchmarks) · [Changelog](./CHANGELOG.md)

[![PyPI](https://img.shields.io/pypi/v/supercompress?style=flat&logo=python&logoColor=white)](https://pypi.org/project/supercompress/)
[![npm](https://img.shields.io/npm/v/supercompress-proxy?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/supercompress-proxy)
[![License](https://img.shields.io/badge/license-Non--Commercial-3da639?style=flat)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Supercompress-181717?style=flat&logo=github&logoColor=white)](https://github.com/Supercompress/Supercompress)

</div>

---

## The problem in one picture

```text
┌─────────────────────────────────────────────────────────────┐
│  YOUR PROMPT                                                │
│                                                             │
│  query     "Why did checkout fail?"          ← tiny, critical │
│  context   12k tokens of logs, RAG, chat, JSON  ← mostly noise │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              Model rereads ALL of it. You pay for ALL of it.
```

That waste compounds every turn. Agents make it worse — tool dumps, file reads, search results stack up until half the bill is context you already know is irrelevant.

**Truncation** deletes the middle and hopes the answer wasn’t there.  
**Summarization** rewrites evidence into softer prose and loses IDs, stack traces, exact errors.  
**Smaller models** still eat the same bloated prompt.

You don’t need a different model. You need a smaller prompt that still has the answer.

---

## What SuperCompress does

It sits **in front of** the model call:

```text
  long context + query
           │
           ▼
    ┌──────────────┐
    │ SuperCompress │  score blocks against THIS query
    └──────────────┘
           │
           ▼
  smaller prompt + token stats  →  your LLM
```

1. Split context into blocks (not one blind chop)  
2. Detect what you’re looking at — text, code, JSON, logs, traces  
3. Score each block against the **current query**  
4. Keep entities, errors, definitions, nearby deps  
5. Drop boilerplate, duplicates, filler  
6. Hand back original wording (selection, not rewrite)

The **query is never compressed**. Only the surrounding context.

| | Truncate | Summarize | **SuperCompress** |
|---|---|---|---|
| Cuts tokens | yes | yes | **yes** |
| Keeps original evidence | sometimes | no | **yes** |
| Uses the question | no | weak | **yes** |
| Auditable kept lines | partial | no | **yes** |

Public benchmarks (same keep-budget quality tests): SuperCompress holds **answer-critical lines** where blind truncation often does not. Details: [benchmarks](https://www.supercompress.dev/benchmarks).

---

## Two ways in

<table>
<tr>
<td width="50%" valign="top">

### Coding agents
**One command. Works with your normal login.**

```bash
npm install -g supercompress-proxy
npx supercompress setup
```

Detects Cursor, Claude Code, Codex, FreeBuff, OpenCode, Gemini CLI, and more. Registers MCP tools so big dumps get compressed before they burn tokens.

[Coding agents guide →](https://www.supercompress.dev/docs/coding-agents)

</td>
<td width="50%" valign="top">

### Apps & APIs
**Compress right before inference.**

```bash
pip install supercompress
export SUPERCOMPRESS_API_KEY=sc_live_...
```

Get a key: [dashboard](https://www.supercompress.dev/dashboard)

[API reference →](https://www.supercompress.dev/docs/api-reference)

</td>
</tr>
</table>

---

## Quick start (Python)

```python
from supercompress.client import SuperCompress

sc = SuperCompress()  # reads SUPERCOMPRESS_API_KEY

result = sc.compress(
    context=long_context,          # logs, RAG, history, tool output…
    query="What failed and how do we fix it?",
)

print(result.compressed_text)
print(f"{result.original_tokens} → {result.kept_tokens} tokens")
```

### HTTP

```bash
curl -X POST https://www.supercompress.dev/api/v1/compress \
  -H "X-API-Key: $SUPERCOMPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "context": "...huge dump...",
    "query": "What failed?"
  }'
```

### Prefer to feel it first?

Paste a messy context into the [playground](https://www.supercompress.dev/playground) — no integration required.

---

## What it is good at

- RAG / retrieval dumps that drown the question  
- Long chat / agent memory that grows every turn  
- Logs, traces, support tickets, JSON payloads  
- Coding-agent tool output (files, search, diffs)  
- Any path where **input tokens** dominate cost

## What it is not

- Not a summarizer — it **selects** source text, it doesn’t invent prose  
- Not magic on already-tiny prompts — if the context is small, skip it  
- Not a reason to delete compliance-required verbatim payloads — if you must send every byte, don’t compress

---

## MCP tools (coding agents)

| Tool | Job |
|------|-----|
| `compress_context` | Shrink a bulky dump for the current task |
| `connect_account` | Link this install to your SuperCompress account |
| `usage_summary` | See savings for the connected account |

```bash
npx supercompress setup     # account + detect + install
npx supercompress agents    # what’s on this machine
npx supercompress plugin    # refresh MCP registrations
```

---

## Repo map

| Path | Purpose |
|------|---------|
| `supercompress/` | Python package |
| `api/` | Hosted compress API |
| `web/` | Site + docs |
| `packages/proxy` | Coding-agent plugin (`supercompress-proxy`) |
| `integrations/` · `examples/` | Drop-in wrappers |

---

## Develop locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .

cd web && python -m http.server 8080
```

Contributions: [CONTRIBUTING.md](./CONTRIBUTING.md) · Security: [SECURITY.md](./SECURITY.md)

---

## License

[Non-commercial license](./LICENSE) — personal, research, and evaluation use are welcome.  
Commercial / monetized use needs a separate license.

---

<div align="center">

**Keep the model. Cut the wasted context.**

[supercompress.dev](https://www.supercompress.dev) · built by [Arjun Shah](https://github.com/arjunkshah12345-hash)

</div>
