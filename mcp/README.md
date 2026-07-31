# SuperCompress MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any MCP-compatible agent (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) compress long context before sending it to an LLM.

**No API key needed for local compression** — runs entirely on your machine using the same compression engine as the hosted API.

## Tools

| Tool | Description |
|------|-------------|
| `compress` | Compress a long text context before LLM inference. Removes low-value tokens while preserving query-critical evidence |
| `retrieve` | Retrieve original text removed during CCR compression using a `[SC-Retrieve: hash]` marker |
| `simple_hash` | Compute the content-addressed hash for a given text |

## Setup

### 1. Install dependencies

```bash
cd /path/to/supercompress
npm install
```

### 2. Configure your MCP client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supercompress": {
      "command": "node",
      "args": ["/absolute/path/to/supercompress/mcp/server.js"]
    }
  }
}
```

**Claude Code** — add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "supercompress": {
      "command": "node",
      "args": ["/absolute/path/to/supercompress/mcp/server.js"]
    }
  }
}
```

**Cursor** — add in Cursor Settings → MCP Servers:

```
Name: supercompress
Type: command
Command: node /absolute/path/to/supercompress/mcp/server.js
```

### 3. Restart your MCP client

The client will launch the SuperCompress server automatically. You should see the tools appear in the available tools list.

## Usage

### Compress context (compiler mode)

The agent calls this automatically when it needs to fit long context into a window. You can also invoke it directly:

```
Use the compress tool with:
- context: [paste long text]
- query: "What does this code do?"
```

### Compress with CCR (reversible)

CCR replaces dropped blocks with `[SC-Retrieve: hash]` markers so the original text can be restored later.

```
Use the compress tool with:
- context: [paste long text]
- query: "What's the root cause?"
- mode: "ccr"
```

### Retrieve original text

When a compressed output contains a `[SC-Retrieve: a1b2c3d4_2f]` marker:

```
Use the retrieve tool with:
- hash: "a1b2c3d4_2f"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPERCOMPRESS_API_KEY` | No | Enables hosted API fallback for `retrieve` when the local cache doesn't have the hash |

## How it works

1. The MCP server launches as a stdio subprocess managed by your MCP client
2. `compress` loads the trained model (`web/assets/data/model.json`) and runs the same compiler engine as `supercompress.dev`
3. `retrieve` checks an in-memory LRU cache first, then optionally falls back to the hosted API
4. The cache is ephemeral — it persists for the current session only

## Files

| Path | Purpose |
|------|---------|
| `mcp/server.js` | MCP server implementation |
| `api/_lib/engine.js` | Shared compression engine (also used by the Vercel API) |
| `web/assets/js/compress-engine.js` | Browser-side engine (loaded into VM sandbox by the server) |
| `web/assets/data/model.json` | Trained model weights |
