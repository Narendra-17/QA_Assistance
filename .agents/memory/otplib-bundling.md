---
name: otplib + qrcode esbuild bundling
description: How to correctly import otplib and qrcode in the api-server esbuild bundle
---

Both `otplib` and `qrcode` are CommonJS-only packages that esbuild cannot resolve named ESM exports from.

**Rule:** These packages must be:
1. Added to the `external` array in `artifacts/api-server/build.mjs`
2. Loaded at runtime using `createRequire` in the source file

**How to apply:**
```ts
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
interface OtplibAuthenticator {
  generateSecret(length?: number): string;
  keyuri(accountName: string, service: string, secret: string): string;
  verify(opts: { token: string; secret: string }): boolean;
}
const { authenticator } = _require("otplib") as { authenticator: OtplibAuthenticator };
const QRCode = _require("qrcode") as { toDataURL(text: string): Promise<string> };
```

**Why:** esbuild (ESM format) cannot find named exports in CJS packages whose `dist/index.js` does not use proper ES module re-export syntax. The `globalThis.require` banner in build.mjs does NOT help with bundled imports — only externalized packages can be require()'d at runtime.
