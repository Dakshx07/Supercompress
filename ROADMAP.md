# SuperCompress roadmap (public)

Last updated: 2026-08-20 · Maintainer: [@arjunkshah](https://github.com/arjunkshah12345-hash) · Contributors welcome

This is the **public** product + OSS roadmap. Dates are targets, not promises. Comment on issues to claim work.

## Now (this week — launch window)

- [ ] Coding-agent reliability: Cursor / Claude Code / Codex / Roo / Cline / Grok hooks
- [ ] Proxy + MCP edge cases (SSE chunking, detector paths, setup UX)
- [ ] Published bakeoffs stay honest vs site copy ([#130](https://github.com/Supercompress/Supercompress/issues/130))
- [ ] Docs + CONTRIBUTING polish for first-time contributors
- [ ] Comparison pages that rank for Headroom / RTK / LLMLingua searches

## Next (2–4 weeks)

- [ ] Stronger query-aware keep model (neural track) behind the same API/MCP surface
- [ ] LiteLLM / gateway guardrail docs when bakeoff gate is green
- [ ] More agent plugins with one-command setup
- [ ] Benchmark harness outsiders can re-run from the repo

## Later

- [ ] Team / org dashboard polish
- [ ] Enterprise SSO / private cloud packs (sales-led; not in public OSS by default)
- [ ] Community Discord **if** GitHub volume justifies it (today: Issues + Discussions)

## Where to help

| Area | Good fit if you like… | Start here |
|------|------------------------|------------|
| Proxy / MCP | Node, agent configs, hooks | `packages/proxy`, open `bug` issues |
| CI / release | Scripts, lockfiles, fail-closed checks | `scripts/`, version consistency |
| Docs / site | Clear setup, SEO comparison pages | `web/docs`, `web/supercompress-vs-*` |
| Eval / benches | Honest metrics, reproducibility | `web/assets/data/*benchmark*`, issues like #130 |

Label filter: [`good first issue`](https://github.com/Supercompress/Supercompress/labels/good%20first%20issue)

## Community

- **Issues / PRs:** preferred
- **Email maintainers:** only for security → see `SECURITY.md`
- **Discord / Slack:** not standing yet — vote with issue volume; we’ll open one when it helps

## What we will not fake

- Marketing “beats Headroom / RTK by 90%” without a re-runnable bakeoff
- Shipping private outreach dumps or enterprise packs into the public repo
EOF