# Workspace

## Overview

AI-powered QA Assistant web app. Users log in, submit app URLs or upload source files, and receive AI-generated security reports with bug severities, root causes, and fix suggestions. Features a premium deep-space UI, CI/CD integration via GitHub Actions, and a full issue lifecycle workflow.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod v3
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)
- **Auth**: Replit Auth (OIDC with PKCE) + API key auth (for CI/CD)
- **AI**: OpenAI (GPT-4o) via Replit AI Integrations
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Framer Motion
- **File upload**: multer (in-memory, multipart/form-data)
- **PDF export**: jsPDF + jspdf-autotable

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API (auth, QA routes, SAST, keys)
│   │   └── src/lib/
│   │       ├── security.ts        # SSRF protection, input sanitization, CSP
│   │       ├── secrets-detector.ts # 20+ regex patterns + entropy analysis
│   │       ├── sca-scanner.ts     # npm/pip/Go/Ruby/Rust manifests → OSV.dev
│   │       ├── api-key-auth.ts    # CI/CD Bearer token middleware
│   │       └── sarif.ts           # SARIF 2.1.0 export for GitHub Code Scanning
│   └── qa-assistant/       # React + Vite frontend (premium dark theme)
│       └── src/pages/
│           ├── dashboard.tsx      # Run history + stats + onboarding
│           ├── new-run.tsx        # URL test + SAST scan forms
│           ├── report.tsx         # Full report (PDF, share, issue lifecycle)
│           ├── shared-report.tsx  # Public read-only share page (no auth)
│           └── integrations.tsx   # CI/CD page (API keys + GitHub Action YAML)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── replit-auth-web/    # Browser auth hook (useAuth)
│   ├── integrations-openai-ai-server/  # Pre-configured OpenAI client
│   └── integrations-openai-ai-react/   # OpenAI React hooks
└── scripts/                # Utility scripts
```

## Design

- **Theme**: Deep space dark (`hsl(230,25%,5%)` background)
- **Fonts**: Syne (display, bold) + Inter (body) + JetBrains Mono (code)
- **Colors**: Electric violet (`#8B5CF6`) + Cyan (`#06B6D4`) accent
- **UI**: Glassmorphism cards, animated blobs, dot-grid backgrounds, framer-motion transitions

## DB Schema

- `sessions` — Replit Auth sessions
- `users` — Authenticated users
- `qa_runs` — QA/SAST test runs (url|sast type, status, report JSONB)
- `share_tokens` — Time-limited public read-only share links (UUID token, expiresAt)
- `issue_statuses` — Per-issue lifecycle: open | acknowledged | resolved | wont_fix
- `api_keys` — CI/CD API keys (SHA-256 hashed, keyPrefix for display, optional expiry)

## API Routes

### Auth
- `GET  /api/auth/user` — Current auth state
- `GET  /api/login` + `GET /api/callback` + `GET /api/logout` — OIDC flow

### QA runs (session auth OR Bearer API key)
- `GET  /api/qa/runs` — List user's QA runs
- `POST /api/qa/runs` — Create URL test run (async AI analysis)
- `GET  /api/qa/runs/:id` — Get run with report
- `DELETE /api/qa/runs/:id` — Delete run
- `GET  /api/qa/stats` — Aggregate stats (scores, issue counts, run types)
- `POST /api/qa/sast` — Upload source files, create SAST scan (multipart/form-data)
- `GET  /api/qa/runs/:id/sarif` — SARIF 2.1.0 export for GitHub Code Scanning

### Share
- `POST /api/qa/runs/:id/share` — Create time-limited share token
- `GET  /api/qa/share/:token` — Public read-only report (no auth required)

### Issue lifecycle
- `GET  /api/qa/runs/:id/issue-statuses` — Get per-issue status
- `PATCH /api/qa/runs/:id/issues/:index/status` — Update issue status

### API Key management (session auth only)
- `POST   /api/keys` — Create API key (returns plaintext once; body: name, expiresInDays?)
- `GET    /api/keys` — List keys (prefix shown, hash never returned)
- `DELETE /api/keys/:id` — Revoke key

## Features

### Live URL Testing (DAST)
- Submit any HTTP/HTTPS URL with SSRF protection
- AI analyzes: security headers, HTML structure, forms, accessibility, SEO
- Report: summary, scored issues (0-100), recommendations

### SAST (Static Code Analysis)
- Upload up to 30 source files (5MB each) via drag-and-drop or file picker
- Supports 60+ extensions: .ts .js .py .java .go .php .cs .rs .html .vue .env .json .yaml .sql etc.
- Deterministic pre-scan: secrets (20+ patterns + entropy) + SCA (OSV.dev CVE lookup)
- AI detects: SQL injection, XSS, hardcoded secrets, CSRF, IDOR, weak crypto, and 20+ more
- Deterministic findings are flagged separately as 100% accurate (not AI-generated)

### Reports
- Quality score (0-100) with animated gauge and letter grade
- Issues sorted by severity (critical/high/medium/low) with filter buttons
- Expandable issue cards: root cause + fix + code snippet + jargon tooltips
- Issue lifecycle: open → acknowledged → resolved → won't fix (persisted in DB)
- Strategic recommendations panel
- Export: Copy markdown | JSON | PDF (jsPDF, styled A4) | SARIF
- Share: Time-limited read-only public links (24h / 7d / 30d) — no login required

### Dashboard
- First-run onboarding with feature cards (empty state)
- Stats: total runs, avg score, critical issues, URL vs SAST breakdown
- Filter by test type + full-text search
- Color-coded score display, delete runs

### CI/CD Integration
- API key management UI (create, list, revoke; max 20 per user)
- Keys are SHA-256 hashed — plaintext shown once on creation
- GitHub Action YAML template (copy-paste ready, with SARIF upload to Code Scanning)
- curl/CLI examples for manual integration
- API key auth works on all SAST/URL run endpoints

## Frontend Pages

- `/` (unauthenticated) — Landing page
- `/` (authenticated) — Dashboard with stats + run history
- `/new` — New URL test form
- `/sast` — New SAST scan (file upload)
- `/runs/:id` — Detailed report page
- `/integrations` — CI/CD integrations (API keys + GitHub Action)
- `/share/:token` — Public shared report (no auth required)

## Security Architecture

- **SSRF**: DNS-resolution check + private IP blocklist before any URL fetch
- **Input sanitization**: All user strings trimmed, length-limited, control-char stripped
- **File safety**: Extension allowlist + binary buffer detection
- **CSP**: Strict headers on all responses
- **CORS**: Locked to Replit preview domains
- **UUID validation**: All `:id` params validated before DB queries
- **API keys**: Bearer token format `qak_<64hex>`, SHA-256 hashed at rest
- **Rate limiting**: 10 req/min on analysis endpoints, 120 req/min global
- **Security audit log**: All SSRF, auth, and input-rejection events logged

## Important Notes

- After running codegen (`pnpm --filter @workspace/api-spec run codegen`), rebuild TypeScript declarations for libs: `cd lib/api-client-react && npx tsc -b --force` and `cd lib/replit-auth-web && npx tsc -b --force`
- DB push: `pnpm --filter @workspace/db run push-force`
- The `multer` v2 + `@types/multer` v1 combination is intentional (types are compatible)
- AI uses `@workspace/integrations-openai-ai-server` (pre-configured OpenAI client)
- Zod v3 syntax throughout the API server (`z.string().url()` not `z.url()`)
- Express 5: `req.params.id` is `string | string[]` — always cast with `String()`
- `isAuthed(req)` helper in qa.ts checks both session auth and API key auth
