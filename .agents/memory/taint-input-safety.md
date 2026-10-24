---
name: Uploaded-code analysis safety
description: Security boundary for source-code parsing and AI-assisted SAST.
---

SAST uploads are untrusted input. Never execute uploaded source code. Parse it with language parsers only, and remove lines containing detected secrets before sending code to an external AI provider.

**Why:** the user explicitly required that uploaded code never be executed and detected secret values never be sent to third parties.

**How to apply:** When adding a language or analysis stage, use a non-executing parser and preserve the secret-line redaction step before any AI prompt is constructed.
