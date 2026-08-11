---
name: supercompress-compact
description: "Before OpenClaw session compaction, compact SuperCompress session memory and refresh the session inbox."
metadata:
  {
    "openclaw":
      {
        "emoji": "🗜️",
        "events": ["session:compact:before"],
        "always": true,
        "requires": { "bins": ["node"] },
      },
  }
---

# SuperCompress compact

On `session:compact:before`, remind the chat to prefer SuperCompress digests and fire-and-forget `compactSessionMemory(sessionId)` (real compact of rolling session memory + session-scoped inbox write).

Enable with:

```bash
openclaw hooks enable supercompress-compact
```

Or run `supercompress setup` / `supercompress plugin`.
