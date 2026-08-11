---
name: supercompress-compact
description: "Before OpenClaw session compaction, nudge to prefer SuperCompress digests and refresh inbox when possible."
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

On `session:compact:before`, remind the chat to prefer SuperCompress digests and fire-and-forget a background compact of rolling session memory (via shared compress-prompt-lib).

Enable with:

```bash
openclaw hooks enable supercompress-compact
```

Or run `supercompress setup` / `supercompress plugin`.
