/**
 * SuperCompress CLI (OpenTUI) — paper-branded interactive UI.
 * Launched by `supercompress` / `supercompress tui` (needs Bun).
 */
import { runApp } from "./app.ts"

await runApp().catch((err) => {
  console.error(err)
  process.exit(1)
})
