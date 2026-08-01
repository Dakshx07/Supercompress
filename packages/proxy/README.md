# SuperCompress

**One install. Every agent. ~65% fewer LLM tokens.**

```bash
npm install -g supercompress-proxy
supercompress setup
# or just:
supercompress plugin
```

`setup` / `plugin` auto-detects agents and installs:
- **MCP** on every detected host (Cursor, Claude, Codex, OpenCode, FreeBuff, Windsurf, Continue, Gemini, …)
- **Hooks** for Cursor / Claude Code / Codex — **every submit with context** auto-compresses (Headroom-parity); tiny asks skip
- **Instruction files** so other agents still prefer `compress_context`

Your ask is never mangled (it stays the query). Pastes, attachments, and tool dumps are compressed before they burn tokens.

### Full-traffic auto (Headroom-style)

```bash
supercompress wrap claude    # starts proxy + launches Claude with ANTHROPIC_BASE_URL
supercompress wrap codex
supercompress wrap aider
```

Install alone does **not** rewrite agent configs. `supercompress setup` (or `supercompress plugin`) is the opt-in step.

Re-run detect anytime:

```bash
supercompress plugin
```

Optional localhost API proxy (base-URL rewrite) is opt-in only:

```bash
supercompress setup --proxy
supercompress start
```

## How it works

```
Coding agent ──→ compress_context (MCP) ──→ SuperCompress API
                 subscription / login safe     ~65% fewer tokens
```

When context gets huge — file dumps, search results, logs, diffs — the agent calls `compress_context`. SuperCompress returns a smaller, evidence-preserving version metered to your plan.

## Commands

| Command | Description |
|---------|-------------|
| `supercompress setup` | Link account + detect agents + install MCP plugin |
| `supercompress plugin` | Re-detect and refresh MCP registrations |
| `supercompress agents` | Show supported / detected integrations |
| `supercompress setup --proxy` | Opt into localhost OpenAI/Anthropic base-URL proxy |
| `supercompress start` / `stop` / `status` | Manage optional local proxy |
| `supercompress uninstall` | Remove MCP/plugin configs and `~/.supercompress` |
| `supercompress-mcp` | Run the MCP server over stdio |

## First-class MCP agents

| Agent | What setup writes |
|-------|-------------------|
| Cursor | `~/.cursor/mcp.json` + Cursor rule + `~/.cursor/hooks.json` (every submit + tool dumps) |
| Claude Code | `~/.claude.json` MCP + UserPromptSubmit / PostToolUse hooks |
| Codex | `~/.codex/config.toml` MCP + prompt/tool hooks |
| FreeBuff | `~/.agents/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.jsonc` (`type: "local"`, `enabled: true`) |
| Gemini CLI | Gemini settings MCP servers |

The detector catalog covers **49** integrations. Run `supercompress agents` to see what is on your machine.

## MCP tools

| Tool | Purpose |
|------|---------|
| `compress_context` | Compress bulky coding context for a query |
| `connect_account` | Open the dashboard to link this install |
| `usage_summary` | Per-agent savings for the connected account |

Manual MCP registration (any MCP client):

```json
{
  "mcpServers": {
    "supercompress": {
      "command": "supercompress-mcp"
    }
  }
}
```

## Optional API proxy

Use `--proxy` only when your agent already uses a provider API key and exposes a configurable OpenAI/Anthropic base URL. Point it at `http://localhost:8080/v1`.

ChatGPT-login Codex and similar hosted backends are **not** intercepted by the local proxy — stay on MCP.

## Requirements

- Node.js 18+
- A SuperCompress account — https://supercompress.dev/dashboard

## Privacy

The MCP server / optional proxy run on your machine. Provider API keys never leave your agent. Context text is sent to the SuperCompress API so the hosted compiler can process it.

## Docs

- Coding agents: https://supercompress.dev/docs/coding-agents
- API: https://supercompress.dev/docs/api-reference
- Source: https://github.com/Supercompress/Supercompress

## License

MIT. Commercial use is permitted. See [LICENSE](LICENSE).
