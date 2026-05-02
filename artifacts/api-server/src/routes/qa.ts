import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qaRunsTable, shareTokensTable, issueStatusesTable } from "@workspace/db/schema";
import { eq, and, desc, gt } from "drizzle-orm";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import path from "path";
import {
  assertSafeUrl,
  sanitizeAndLimit,
  sanitizeFilename,
  isBinaryBuffer,
  isValidUuid,
  safeErrorMessage,
  SecurityError,
  logSecurityEvent,
} from "../lib/security";
import { detectSecrets, secretsToIssues } from "../lib/secrets-detector";
import { scanDependencies, scaToIssues } from "../lib/sca-scanner";
import { apiKeyAuth } from "../lib/api-key-auth";
import { buildSarif } from "../lib/sarif";

const router = Router();

// Allow either session auth OR API key auth
function isAuthed(req: Request): boolean {
  return !!(req.isAuthenticated?.() || req.user);
}

// Apply API key auth middleware so Bearer qak_... tokens populate req.user
router.use(apiKeyAuth);

// ─── Upload config ───────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 30, fieldSize: 1 * 1024 * 1024 },
});

// ─── Allowed file types ──────────────────────────────────────────────────────

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts",
  ".py", ".pyw", ".pyi",
  ".java", ".kt", ".kts", ".groovy", ".scala", ".clj", ".cljs",
  ".cs", ".vb", ".fs", ".fsx", ".csx",
  ".go", ".rs", ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh",
  ".rb", ".rake", ".php", ".phtml", ".pl", ".pm", ".lua",
  ".swift", ".m", ".mm", ".dart",
  ".hs", ".lhs", ".ex", ".exs", ".erl", ".hrl", ".r",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".psd1", ".bat", ".cmd",
  ".html", ".htm", ".vue", ".svelte",
  ".css", ".scss", ".sass", ".less",
  ".twig", ".ejs", ".hbs", ".mustache", ".pug", ".jade", ".jinja", ".j2",
  ".xml", ".xsl", ".xslt", ".svg",
  ".json", ".jsonc", ".json5",
  ".yaml", ".yml",
  ".toml",
  ".ini", ".cfg", ".conf", ".config", ".properties",
  ".env", ".env.example", ".env.local", ".env.production",
  ".sql", ".prisma", ".graphql", ".gql",
  ".tf", ".tfvars", ".hcl", ".bicep",
  ".gradle", ".lock", ".mod", ".sum",
  ".gemspec", ".podspec",
  ".md", ".mdx",
  ".proto", ".thrift", ".zig",
]);

const CODE_BASENAMES = new Set([
  "dockerfile", "containerfile",
  "makefile", "gnumakefile", "rakefile", "gemfile", "podfile",
  "vagrantfile", "jenkinsfile", "fastfile", "brewfile",
  "cmakelists.txt", "build.gradle", "pom.xml", "build.sbt",
  "requirements.txt", "requirements-dev.txt", "pipfile", "pyproject.toml",
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "cargo.toml", "cargo.lock", "gemfile.lock",
  "go.mod", "go.sum",
  "composer.json", "composer.lock",
  ".npmrc", ".nvmrc", ".yarnrc", ".yarnrc.yml",
  ".babelrc", ".eslintrc", ".prettierrc", ".stylelintrc",
  ".editorconfig", ".gitignore", ".dockerignore",
  ".htaccess", "nginx.conf",
  "serverless.yml", "serverless.yaml",
  "docker-compose.yml", "docker-compose.yaml",
]);

function isCodeFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename).toLowerCase();
  const bareBase = base.startsWith(".") ? base.slice(1) : base;
  return CODE_EXTS.has(ext) || CODE_BASENAMES.has(base) || CODE_BASENAMES.has(bareBase);
}

// ─── Recalculate score including deterministic findings ───────────────────────

function recalculateScore(issues: Array<{ severity: string }>): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "critical") score -= 25;
    else if (issue.severity === "high") score -= 12;
    else if (issue.severity === "medium") score -= 5;
    else if (issue.severity === "low") score -= 2;
  }
  return Math.max(0, score);
}

// ─── Analysis helpers ────────────────────────────────────────────────────────

async function analyzeUrl(
  appUrl: string,
  appDescription: string,
): Promise<Record<string, unknown>> {
  let pageContent = "";
  const securityHeaders: Record<string, string | null> = {
    "strict-transport-security": null,
    "content-security-policy": null,
    "x-content-type-options": null,
    "x-frame-options": null,
    "x-xss-protection": null,
    "referrer-policy": null,
    "permissions-policy": null,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(appUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "QAAssistant/1.0 (security-scanner)" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    for (const h of Object.keys(securityHeaders)) {
      securityHeaders[h] = resp.headers.get(h);
    }

    const html = await resp.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "N/A";
    const headings = [...html.matchAll(/<h[1-3][^>]*>([^<]+)<\/h/gi)].slice(0, 10).map(m => m[1]);
    const forms = (html.match(/<form/gi) ?? []).length;
    const links = (html.match(/<a\s+[^>]*href/gi) ?? []).length;
    const inputs = (html.match(/<input/gi) ?? []).length;
    const scripts = (html.match(/<script/gi) ?? []).length;
    const metaTags = [...html.matchAll(/<meta[^>]+>/gi)].slice(0, 5).map(m => m[0].slice(0, 200));

    pageContent = JSON.stringify({
      url: appUrl, statusCode: resp.status,
      isHttps: appUrl.startsWith("https://"),
      title, headings, formCount: forms, linkCount: links,
      inputCount: inputs, scriptCount: scripts, securityHeaders, metaTags,
    });
  } catch (err) {
    const fetchError = err instanceof Error ? err.message : String(err);
    pageContent = JSON.stringify({ url: appUrl, fetchError, securityHeaders });
  }

  const prompt = `You are a senior QA engineer and security auditor. Produce a comprehensive quality report for this web application.

Application URL: ${appUrl}
Developer description: ${appDescription}
Page data: ${pageContent}

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary",
  "issues": [
    {
      "title": "Issue title",
      "description": "Detailed description",
      "severity": "critical|high|medium|low",
      "possibleCause": "Root cause analysis",
      "suggestedFix": "Actionable fix",
      "codeSnippet": null,
      "filePath": null,
      "lineNumber": null
    }
  ],
  "overallScore": <0-100>,
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "testType": "url"
}

Rules: If fetch failed, base analysis on URL and description. Score = 100 - (critical×25 + high×12 + medium×5 + low×2), min 0. Include 4-10 issues covering security, performance, accessibility, UX, SEO. Sort by severity desc.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 4096,
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;
}

async function analyzeCode(
  files: Array<{ name: string; content: string }>,
  projectName: string,
  description: string,
): Promise<Record<string, unknown>> {
  // ── Phase 1: Deterministic pre-scan (secrets + SCA) ──────────────────────
  const [secretFindings, scaFindings] = await Promise.all([
    Promise.resolve(detectSecrets(files)),
    scanDependencies(files),
  ]);

  const deterministicIssues = [
    ...secretsToIssues(secretFindings),
    ...scaToIssues(scaFindings),
  ];

  // ── Phase 2: AI analysis ──────────────────────────────────────────────────
  const filesSummary = files
    .slice(0, 25)
    .map(f => `### ${f.name}\n\`\`\`\n${f.content.slice(0, 2500)}\n\`\`\``)
    .join("\n\n");

  const fileTypes = [...new Set(files.map(f =>
    path.extname(f.name).toLowerCase() || f.name.toLowerCase()
  ))].join(", ");

  // Tell the AI which secrets/deps were already found so it doesn't repeat them
  const alreadyFound = deterministicIssues.length > 0
    ? `\n\nNOTE: The following issues have ALREADY been detected by deterministic analysis — do NOT duplicate them:\n${deterministicIssues.map(i => `• ${i.title}`).join("\n")}`
    : "";

  const prompt = `You are a senior security engineer and code auditor performing SAST. Analyze ALL provided files for security vulnerabilities, misconfigurations, and best-practice violations — adapting checks to the file types present.

Project: ${projectName}
Description: ${description}
Files analyzed: ${files.length} (${fileTypes})
${alreadyFound}

${filesSummary}

ANALYSIS RULES BY FILE TYPE:
- Source code: SQL injection, XSS, insecure deserialization, broken auth, CSRF, path traversal, command injection, prototype pollution, insecure crypto, missing input validation, debug code, open redirects, IDOR, race conditions
- Shell scripts: command injection, unquoted variables, unsafe eval/exec, privilege escalation, sensitive data in arguments
- Templates: XSS via unescaped output, CSRF token absence, clickjacking, mixed content
- CSS: CSS injection, data exfiltration
- Config & environment: debug mode in production, overly permissive CORS, insecure defaults
- IaC (.tf/.hcl/.bicep): permissive IAM, public storage, unencrypted stores, open security groups, no MFA
- Kubernetes/Docker: privileged containers, running as root, exposed ports, no resource limits, secrets in env vars, latest tag, no read-only filesystem
- Build/CI files: command injection in steps, insecure artifact storage, missing SAST steps
- Database files: unparameterized queries, unencrypted PII, over-privileged roles

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary",
  "issues": [
    {
      "title": "Vulnerability title",
      "description": "Detailed explanation",
      "severity": "critical|high|medium|low",
      "possibleCause": "Root cause",
      "suggestedFix": "Concrete actionable fix with code example where relevant",
      "codeSnippet": "Relevant vulnerable snippet (or null)",
      "filePath": "path/to/file.ext or null",
      "lineNumber": null,
      "detectionMethod": "ai"
    }
  ],
  "overallScore": 0,
  "recommendations": ["Strategic recommendation 1"],
  "testType": "sast"
}

Return 4-12 NEW issues only (not already listed above). Set overallScore to 0 — it will be recalculated. Sort by severity descending.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 4096,
  });

  const aiResult = JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;

  // ── Phase 3: Merge and recalculate score ──────────────────────────────────
  const aiIssues = (aiResult.issues as Array<Record<string, unknown>>) ?? [];
  const allIssues = [...deterministicIssues, ...aiIssues];
  const score = recalculateScore(allIssues as Array<{ severity: string }>);

  return {
    ...aiResult,
    issues: allIssues,
    overallScore: score,
    deterministicFindings: {
      secretsFound: secretFindings.length,
      vulnerableDepsFound: scaFindings.length,
    },
  };
}

// ─── Input validation schemas ─────────────────────────────────────────────────

const urlRunSchema = z.object({
  appUrl: z.string().url("Enter a valid URL starting with https://"),
  appDescription: z.string().min(10).max(2000),
});

const sastSchema = z.object({
  projectName: z.string().min(1).max(100),
  description: z.string().min(5).max(2000),
});

const shareSchema = z.object({
  expiresInHours: z.number().int().min(1).max(720).default(168), // 1h – 30 days, default 7 days
});

const issueStatusSchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved", "wont_fix"]),
  note: z.string().max(500).optional(),
});

// ─── Runs ─────────────────────────────────────────────────────────────────────

router.get("/runs", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, "GET /runs");
    return void res.status(401).json({ error: "Authentication required" });
  }
  const userId = (req.user as { id: string }).id;
  try {
    const runs = await db
      .select({
        id: qaRunsTable.id, userId: qaRunsTable.userId, runType: qaRunsTable.runType,
        appUrl: qaRunsTable.appUrl, appDescription: qaRunsTable.appDescription,
        projectName: qaRunsTable.projectName, status: qaRunsTable.status,
        errorMessage: qaRunsTable.errorMessage, createdAt: qaRunsTable.createdAt,
        updatedAt: qaRunsTable.updatedAt,
      })
      .from(qaRunsTable)
      .where(eq(qaRunsTable.userId, userId))
      .orderBy(desc(qaRunsTable.createdAt));
    res.json({ runs });
  } catch {
    res.status(500).json({ error: "Failed to fetch runs" });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, "GET /stats");
    return void res.status(401).json({ error: "Authentication required" });
  }
  const userId = (req.user as { id: string }).id;
  try {
    const runs = await db
      .select({ id: qaRunsTable.id, runType: qaRunsTable.runType, status: qaRunsTable.status, report: qaRunsTable.report })
      .from(qaRunsTable)
      .where(eq(qaRunsTable.userId, userId));

    const completed = runs.filter(r => r.status === "completed");
    let totalScore = 0, criticalIssues = 0, highIssues = 0;
    for (const r of completed) {
      const report = r.report as Record<string, unknown> | null;
      if (report) {
        totalScore += Number(report.overallScore ?? 0);
        const issues = (report.issues as Array<{ severity: string }>) ?? [];
        criticalIssues += issues.filter(i => i.severity === "critical").length;
        highIssues += issues.filter(i => i.severity === "high").length;
      }
    }

    res.json({
      totalRuns: runs.length,
      completedRuns: completed.length,
      failedRuns: runs.filter(r => r.status === "failed").length,
      averageScore: completed.length > 0 ? Math.round(totalScore / completed.length) : 0,
      criticalIssues, highIssues,
      urlRuns: runs.filter(r => r.runType === "url").length,
      sastRuns: runs.filter(r => r.runType === "sast").length,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.post("/runs", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, "POST /runs");
    return void res.status(401).json({ error: "Authentication required" });
  }
  const userId = (req.user as { id: string }).id;

  const parsed = urlRunSchema.safeParse(req.body);
  if (!parsed.success) {
    logSecurityEvent("INPUT_REJECTED", req, `Validation: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  let appUrl: string, appDescription: string;
  try {
    appDescription = sanitizeAndLimit(parsed.data.appDescription, 2000, "appDescription");
    await assertSafeUrl(parsed.data.appUrl);
    appUrl = parsed.data.appUrl;
  } catch (err) {
    if (err instanceof SecurityError) {
      logSecurityEvent("SSRF_BLOCKED", req, `URL: ${parsed.data.appUrl} — ${err.message}`);
      return void res.status(400).json({ error: err.message });
    }
    return void res.status(500).json({ error: "Failed to validate URL" });
  }

  try {
    const [run] = await db
      .insert(qaRunsTable)
      .values({ userId, runType: "url", appUrl, appDescription, status: "running" })
      .returning();
    res.status(201).json(run);

    analyzeUrl(appUrl, appDescription)
      .then(report =>
        db.update(qaRunsTable).set({ status: "completed", report }).where(eq(qaRunsTable.id, run.id)),
      )
      .catch(async (err) => {
        const msg = safeErrorMessage(err, "analyzeUrl");
        await db.update(qaRunsTable).set({ status: "failed", errorMessage: msg }).where(eq(qaRunsTable.id, run.id));
      });
  } catch {
    res.status(500).json({ error: "Failed to create run" });
  }
});

router.post("/sast", upload.array("files", 30), async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, "POST /sast");
    return void res.status(401).json({ error: "Authentication required" });
  }
  const userId = (req.user as { id: string }).id;

  const parsed = sastSchema.safeParse(req.body);
  if (!parsed.success) {
    logSecurityEvent("INPUT_REJECTED", req, `SAST validation: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const projectName = sanitizeAndLimit(parsed.data.projectName, 100, "projectName");
  const description = sanitizeAndLimit(parsed.data.description, 2000, "description");

  const uploadedFiles = req.files as Express.Multer.File[];
  if (!uploadedFiles?.length) return void res.status(400).json({ error: "No files uploaded" });

  const totalBytes = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > 50 * 1024 * 1024) {
    return void res.status(400).json({ error: "Total upload exceeds 50 MB limit" });
  }

  const rejected: string[] = [];
  const codeFiles = uploadedFiles
    .filter(f => {
      const safeName = sanitizeFilename(f.originalname);
      if (!isCodeFile(safeName)) { rejected.push(safeName); return false; }
      if (isBinaryBuffer(f.buffer)) {
        logSecurityEvent("FILE_REJECTED", req, `Binary file rejected: ${safeName}`);
        rejected.push(safeName);
        return false;
      }
      return true;
    })
    .map(f => ({
      name: sanitizeFilename(f.originalname),
      content: f.buffer.toString("utf-8").replace(/\0/g, ""),
    }))
    .filter(f => f.content.trim().length > 0);

  if (!codeFiles.length) {
    return void res.status(400).json({
      error: "No readable source code files found.",
      rejected: rejected.length ? rejected : undefined,
    });
  }

  try {
    const [run] = await db
      .insert(qaRunsTable)
      .values({ userId, runType: "sast", projectName, appDescription: description, status: "running" })
      .returning();
    res.status(201).json(run);

    analyzeCode(codeFiles, projectName, description)
      .then(report =>
        db.update(qaRunsTable).set({ status: "completed", report }).where(eq(qaRunsTable.id, run.id)),
      )
      .catch(async (err) => {
        const msg = safeErrorMessage(err, "analyzeCode");
        await db.update(qaRunsTable).set({ status: "failed", errorMessage: msg }).where(eq(qaRunsTable.id, run.id));
      });
  } catch {
    res.status(500).json({ error: "Failed to create SAST run" });
  }
});

router.get("/runs/:id", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `GET /runs/${req.params.id}`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) {
    logSecurityEvent("INVALID_PARAM", req, `Non-UUID run ID: ${id}`);
    return void res.status(400).json({ error: "Invalid run ID format" });
  }

  const userId = (req.user as { id: string }).id;
  try {
    const [run] = await db.select().from(qaRunsTable)
      .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));
    if (!run) return void res.status(404).json({ error: "Not found" });
    res.json(run);
  } catch {
    res.status(500).json({ error: "Failed to fetch run" });
  }
});

router.delete("/runs/:id", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `DELETE /runs/${req.params.id}`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) {
    logSecurityEvent("INVALID_PARAM", req, `Non-UUID run ID: ${id}`);
    return void res.status(400).json({ error: "Invalid run ID format" });
  }

  const userId = (req.user as { id: string }).id;
  try {
    const [deleted] = await db.delete(qaRunsTable)
      .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)))
      .returning();
    if (!deleted) return void res.status(404).json({ error: "Not found" });
    res.json({ success: true as const });
  } catch {
    res.status(500).json({ error: "Failed to delete run" });
  }
});

// ─── Share tokens ─────────────────────────────────────────────────────────────

router.post("/runs/:id/share", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `POST /runs/${req.params.id}/share`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) {
    logSecurityEvent("INVALID_PARAM", req, `Non-UUID run ID: ${id}`);
    return void res.status(400).json({ error: "Invalid run ID format" });
  }

  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const userId = (req.user as { id: string }).id;

  // Verify the run belongs to this user and is completed
  const [run] = await db.select({ id: qaRunsTable.id, status: qaRunsTable.status })
    .from(qaRunsTable)
    .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));

  if (!run) return void res.status(404).json({ error: "Run not found" });
  if (run.status !== "completed") {
    return void res.status(400).json({ error: "Only completed reports can be shared" });
  }

  const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000);

  try {
    const [shareToken] = await db.insert(shareTokensTable)
      .values({ runId: id, userId, expiresAt })
      .returning();
    res.json({ token: shareToken.token, expiresAt: shareToken.expiresAt });
  } catch {
    res.status(500).json({ error: "Failed to create share link" });
  }
});

// Public endpoint — no auth required, but token must be valid and unexpired
router.get("/share/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!isValidUuid(token)) {
    return void res.status(400).json({ error: "Invalid token format" });
  }

  try {
    const [shareRecord] = await db.select()
      .from(shareTokensTable)
      .where(and(
        eq(shareTokensTable.token, token),
        gt(shareTokensTable.expiresAt, new Date()),
      ));

    if (!shareRecord) return void res.status(404).json({ error: "Share link not found or has expired" });

    const [run] = await db.select().from(qaRunsTable).where(eq(qaRunsTable.id, shareRecord.runId));
    if (!run) return void res.status(404).json({ error: "Report not found" });

    // Return run without userId for privacy
    const { userId: _userId, ...publicRun } = run;
    res.json({ run: publicRun, expiresAt: shareRecord.expiresAt });
  } catch {
    res.status(500).json({ error: "Failed to fetch shared report" });
  }
});

// ─── SARIF export ────────────────────────────────────────────────────────────
// Returns a SARIF 2.1.0 file for GitHub Code Scanning upload.

router.get("/runs/:id/sarif", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `GET /runs/${req.params.id}/sarif`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) return void res.status(400).json({ error: "Invalid run ID format" });

  const userId = (req.user as { id: string }).id;
  const [run] = await db
    .select()
    .from(qaRunsTable)
    .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));

  if (!run) return void res.status(404).json({ error: "Run not found" });
  if (run.status !== "completed" || !run.report) {
    return void res.status(400).json({ error: "Run not completed yet" });
  }

  const report = run.report as { issues?: unknown[] };
  const issues = (report.issues ?? []) as Parameters<typeof buildSarif>[0];
  const target = run.appUrl ?? run.projectName ?? "unknown";
  const sarif = buildSarif(issues, id, target);

  res.setHeader("Content-Type", "application/sarif+json");
  res.setHeader("Content-Disposition", `attachment; filename="qa-${id.slice(0, 8)}.sarif"`);
  res.json(sarif);
});

// ─── Issue lifecycle ──────────────────────────────────────────────────────────

router.get("/runs/:id/issue-statuses", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `GET /runs/${req.params.id}/issue-statuses`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) return void res.status(400).json({ error: "Invalid run ID format" });

  const userId = (req.user as { id: string }).id;
  // Verify ownership
  const [run] = await db.select({ id: qaRunsTable.id })
    .from(qaRunsTable).where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));
  if (!run) return void res.status(404).json({ error: "Not found" });

  try {
    const statuses = await db.select()
      .from(issueStatusesTable)
      .where(and(eq(issueStatusesTable.runId, id), eq(issueStatusesTable.userId, userId)));
    res.json({ statuses });
  } catch {
    res.status(500).json({ error: "Failed to fetch issue statuses" });
  }
});

router.patch("/runs/:id/issues/:index/status", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `PATCH /runs/${req.params.id}/issues/${req.params.index}/status`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) return void res.status(400).json({ error: "Invalid run ID format" });

  const issueIndex = parseInt(String(req.params.index), 10);
  if (isNaN(issueIndex) || issueIndex < 0 || issueIndex > 9999) {
    return void res.status(400).json({ error: "Invalid issue index" });
  }

  const parsed = issueStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const userId = (req.user as { id: string }).id;
  const note = parsed.data.note ? sanitizeAndLimit(parsed.data.note, 500, "note") : null;

  // Verify run ownership
  const [run] = await db.select({ id: qaRunsTable.id })
    .from(qaRunsTable).where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));
  if (!run) return void res.status(404).json({ error: "Run not found" });

  try {
    // Upsert — insert or update if exists
    const existing = await db.select({ id: issueStatusesTable.id })
      .from(issueStatusesTable)
      .where(and(
        eq(issueStatusesTable.runId, id),
        eq(issueStatusesTable.userId, userId),
        eq(issueStatusesTable.issueIndex, issueIndex),
      ));

    let result;
    if (existing.length > 0) {
      [result] = await db.update(issueStatusesTable)
        .set({ status: parsed.data.status, note: note ?? undefined })
        .where(eq(issueStatusesTable.id, existing[0].id))
        .returning();
    } else {
      [result] = await db.insert(issueStatusesTable)
        .values({ runId: id, userId, issueIndex, status: parsed.data.status, note: note ?? undefined })
        .returning();
    }
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to update issue status" });
  }
});

export default router;
