# Workspace

## Overview

AI-powered QA Assistant web app. Users log in, submit app URLs or upload source files, and receive AI-generated security reports with bug severities, root causes, and fix suggestions.

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
- **Auth**: Replit Auth (OIDC with PKCE)
- **AI**: OpenAI (GPT-4o) via Replit AI Integrations
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Framer Motion
- **File upload**: multer (in-memory, multipart/form-data)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API (auth, QA routes, SAST)
│   └── qa-assistant/       # React + Vite frontend (premium dark theme)
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

- **Theme**: Deep space dark (#0D0F1A background)
- **Fonts**: Syne (display, bold) + Inter (body) + JetBrains Mono (code)
- **Colors**: Electric violet (#8B5CF6) + Cyan (#06B6D4) accent
- **UI**: Glassmorphism cards, animated blobs, dot-grid backgrounds, framer-motion transitions

## DB Schema

- `sessions` — Replit Auth sessions
- `users` — Authenticated users
- `qa_runs` — QA/SAST test runs (url|sast type, status, report JSONB)

## API Routes

- `GET /api/auth/user` — Current auth state
- `GET /api/login` + `GET /api/callback` + `GET /api/logout` — OIDC flow
- `GET /api/qa/runs` — List user's QA runs
- `POST /api/qa/runs` — Create URL test run (async AI analysis)
- `GET /api/qa/runs/:id` — Get run with report
- `DELETE /api/qa/runs/:id` — Delete run
- `GET /api/qa/stats` — Aggregate stats (scores, issue counts, run types)
- `POST /api/qa/sast` — Upload source files, create SAST scan (multipart/form-data)

## Features

### Live URL Testing
- Submit any HTTP/HTTPS URL
- AI analyzes: security headers, HTML structure, forms, accessibility, SEO
- Report: summary, scored issues, recommendations

### SAST (Static Code Analysis)
- Upload up to 30 source files (5MB each) via drag-and-drop or file picker
- Supports: .ts .js .py .java .go .php .cs .rs .html .vue .env .json .yaml .sql etc.
- AI detects: SQL injection, XSS, hardcoded secrets, CSRF, IDOR, weak crypto, and 20+ more
- Report includes: code snippets, file paths, root causes, fix examples

### Reports
- Quality score (0-100) with letter grade gauge
- Issues sorted by severity (critical/high/medium/low)
- Expandable issue cards with cause + fix + code snippet
- Strategic recommendations panel
- Copy report as markdown to clipboard
- Export as JSON file
- Real-time polling for in-progress analyses

### Dashboard
- Stats: total runs, avg score, critical issues, URL vs SAST breakdown
- Filter by test type
- Color-coded score display
- Delete runs

## Frontend Pages

- `/` — Landing page (unauthenticated) or Dashboard (authenticated redirect)
- `/` (authenticated) — Dashboard with stats + run history
- `/new` — New URL test form
- `/sast` — New SAST scan (file upload)
- `/runs/:id` — Detailed report page

## Important Notes

- After running codegen (`pnpm --filter @workspace/api-spec run codegen`), rebuild TypeScript declarations for libs: `cd lib/api-client-react && npx tsc -b --force` and `cd lib/replit-auth-web && npx tsc -b --force`
- DB push: `pnpm --filter @workspace/db run push-force`
- The `multer` v2 + `@types/multer` v1 combination is intentional (types are compatible)
- AI uses `@workspace/integrations-openai-ai-server` (pre-configured OpenAI client)
- Zod v3 syntax throughout the API server (`z.string().url()` not `z.url()`)
