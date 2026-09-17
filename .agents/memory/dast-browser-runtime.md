---
name: Headless DAST runtime
description: Runtime browser availability and fallback behavior for dynamic URL scans.
---

Headless DAST should use the workspace-provided Chromium executable when available and fall back to the static fetch path when browser launch is unavailable.

**Why:** Puppeteer’s browser download script is skipped in this workspace, but Chromium is provided separately; assuming Puppeteer’s bundled browser exists makes the dynamic layer silently unavailable.

**How to apply:** Keep browser capture additive to static fetch, configure the executable path from `CHROMIUM_PATH` with the workspace Chromium default, and treat launch/navigation failures as non-fatal scan data.