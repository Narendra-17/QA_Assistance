---
name: lib/db composite TypeScript rebuild
description: After editing lib/db schema source files, the dist/*.d.ts must be regenerated or tsc --build will report "property doesn't exist" errors in api-server.
---

When `lib/db/src/schema/*.ts` files are modified (adding columns, new tables, etc.), the `lib/db/dist/*.d.ts` files become stale because `lib/db` is a TypeScript composite project (`composite: true`, `emitDeclarationOnly: true`). The api-server consumes these `.d.ts` files via project references.

**Why:** api-server's tsconfig uses `"references": [{"path": "../../lib/db"}]` — TypeScript composite mode reads from `dist/*.d.ts`, not the source, when compiling referencing projects.

**How to apply:** After any schema change in `lib/db/src/schema/`, run:
```
cd /home/runner/workspace/lib/db && npx tsc --build
```
Then re-run `pnpm --filter @workspace/api-server exec tsc --noEmit` to confirm zero errors.

Do this BEFORE restarting the api-server workflow, since esbuild (used by the dev workflow) reads TS source directly and doesn't catch these type errors at runtime — the mismatch is silent until `tsc --noEmit` is run.
