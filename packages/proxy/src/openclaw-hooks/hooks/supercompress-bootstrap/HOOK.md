---
name: supercompress-bootstrap
description: "Inject SuperCompress inbox digest into agent bootstrap context when present."
metadata:
  {
    "openclaw":
      {
        "emoji": "🗜️",
        "events": ["agent:bootstrap"],
        "always": true,
      },
  }
---

# SuperCompress bootstrap

On `agent:bootstrap`, if `~/.supercompress/inbox/latest.md` exists, inject it as a bootstrap file named `SUPERCOMPRESS.md` so the agent prefers the session digest over re-pasting raw dumps.

Enable with:

```bash
openclaw hooks enable supercompress-bootstrap
```

Or run `supercompress setup` / `supercompress plugin`, which writes this hook and enables it in `openclaw.json`.
