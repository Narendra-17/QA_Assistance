# Workspace

## Overview

AI-powered QA Assistant web app. Users log in, submit app URLs with descriptions, and receive AI-generated QA reports with bug severities and fix suggestions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Replit Auth (OIDC with PKCE)
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (auth, QA routes)
│   └── qa-assistant/       # React + Vite frontend (dark techy theme)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── replit-auth-web/    # Browser auth hook (useAuth)
│   ├── integrations-openai-ai-server/  # OpenAI server SDK
│   └── integrations-openai-ai-react/   # OpenAI React hooks
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## DB Schema

- `sessions` — Replit Auth sessions
- `users` — Authenticated users
- `qa_runs` — QA test runs (URL, description, status, report JSON)

## API Routes

- `GET /api/auth/user` — Current auth state
- `GET /api/login` — OIDC login redirect
- `GET /api/callback` — OIDC callback
- `GET /api/logout` — OIDC logout
- `GET /api/qa/runs` — List user's QA runs
- `POST /api/qa/runs` — Create new QA run (triggers AI analysis async)
- `GET /api/qa/runs/:id` — Get QA run with report
- `DELETE /api/qa/runs/:id` — Delete QA run

## QA Analysis Flow

1. User submits app URL + description
2. Backend fetches page HTML (HTTP/HTTPS)
3. Page structure extracted (title, headings, forms, links, images, security headers)
4. AI (gpt-5.2) analyzes and generates structured QA report
5. Report stored in DB with issues (severity: low/medium/high/critical), score, recommendations

## Frontend Pages

- `/` — Landing page (login prompt when unauthenticated)
- `/dashboard` — List of all QA runs with status badges
- `/new` — Form to create new QA test run
- `/runs/:id` — Detailed QA report view with score gauge

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json`. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
DB push: `pnpm --filter @workspace/db run push`
