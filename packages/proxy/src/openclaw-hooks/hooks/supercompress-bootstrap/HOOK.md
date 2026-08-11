---
name: supercompress-bootstrap
description: "Inject this session's SuperCompress inbox digest into agent bootstrap context when present."
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

On `agent:bootstrap`, if this session's inbox digest exists (`$SUPERCOMPRESS_CONFIG_DIR/inbox/<sessionId>/latest.md`), inject it as a bootstrap file named `SUPERCOMPRESS.md` so the agent prefers the session digest over re-pasting raw dumps. No session id → no inject (avoids cross-session leaks).

Enable with:

```bash
openclaw hooks enable supercompress-bootstrap
```

Or run `supercompress setup` / `supercompress plugin`, which writes this hook and enables it in `openclaw.json`.
