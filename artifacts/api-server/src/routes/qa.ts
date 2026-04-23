import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qaRunsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
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

const router = Router();

// ─── Upload config ───────────────────────────────────────────────────────────
// Individual file limit: 5 MB
// Total upload limit: 50 MB for 30 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 30, fieldSize: 1 * 1024 * 1024 },
});

// ─── Allowed file types ──────────────────────────────────────────────────────

const CODE_EXTS = new Set([
  // JavaScript / TypeScript ecosystem
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts",

  // Python
  ".py", ".pyw", ".pyi",

  // JVM languages
  ".java", ".kt", ".kts", ".groovy", ".scala", ".clj", ".cljs",

  // .NET / Microsoft
  ".cs", ".vb", ".fs", ".fsx", ".csx",

  // Go, Rust, C family
  ".go", ".rs", ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh",

  // Ruby, PHP, Perl, Lua
  ".rb", ".rake", ".php", ".phtml", ".pl", ".pm", ".lua",

  // Mobile
  ".swift", ".m", ".mm", ".dart",

  // Functional / other
  ".hs", ".lhs", ".ex", ".exs", ".erl", ".hrl", ".r",

  // Shell / scripting
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".psd1", ".bat", ".cmd",

  // Web / templates
  ".html", ".htm", ".vue", ".svelte",
  ".css", ".scss", ".sass", ".less",
  ".twig", ".ejs", ".hbs", ".mustache", ".pug", ".jade", ".jinja", ".j2",

  // Markup & data
  ".xml", ".xsl", ".xslt", ".svg",
  ".json", ".jsonc", ".json5",
  ".yaml", ".yml",
  ".toml",
  ".ini", ".cfg", ".conf", ".config", ".properties",
  ".env", ".env.example", ".env.local", ".env.production",

  // SQL & data
  ".sql", ".prisma", ".graphql", ".gql",

  // Infrastructure as Code
  ".tf", ".tfvars", ".hcl",
  ".bicep",

  // Build & packaging
  ".gradle",
  ".lock", ".mod", ".sum",
  ".gemspec", ".podspec",

  // Other dev files
  ".md", ".mdx",
  ".proto",
  ".thrift",
  ".zig",
]);

/** Named files that carry no extension but are always relevant */
const CODE_BASENAMES = new Set([
  "dockerfile", "containerfile",
  "makefile", "gnumakefile", "rakefile", "gemfile", "podfile",
  "vagrantfile", "jenkinsfile", "fastfile", "brewfile",
  "cmakelists.txt", "build.gradle", "pom.xml", "build.sbt",
  "requirements.txt", "pipfile", "pyproject.toml",
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "cargo.toml", "cargo.lock",
  "go.mod", "go.sum",
  ".npmrc", ".nvmrc", ".yarnrc", ".yarnrc.yml",
  ".babelrc", ".eslintrc", ".prettierrc", ".stylelintrc",
  ".editorconfig", ".gitignore", ".dockerignore",
  ".htaccess", ".nginx.conf", "nginx.conf",
  "serverless.yml", "serverless.yaml",
  "docker-compose.yml", "docker-compose.yaml",
  "kubernetes.yaml", "k8s.yaml",
]);

function isCodeFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename).toLowerCase();
  const bareBase = base.startsWith(".") ? base.slice(1) : base;
  return (
    CODE_EXTS.has(ext) ||
    CODE_BASENAMES.has(base) ||
    CODE_BASENAMES.has(bareBase)
  );
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
      url: appUrl,
      statusCode: resp.status,
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
  const filesSummary = files
    .slice(0, 25)
    .map(f => `### ${f.name}\n\`\`\`\n${f.content.slice(0, 2500)}\n\`\`\``)
    .join("\n\n");

  const fileTypes = [...new Set(files.map(f => path.extname(f.name).toLowerCase() || f.name.toLowerCase()))].join(", ");

  const prompt = `You are a senior security engineer and code auditor performing Static Application Security Testing (SAST). Analyze ALL provided files for security vulnerabilities, misconfigurations, and best-practice violations — adapting your checks to the file types present.

Project: ${projectName}
Description: ${description}
Files analyzed: ${files.length} (${fileTypes})

${filesSummary}

ANALYSIS RULES BY FILE TYPE:
- Source code (.ts/.js/.py/.java/.go/.cs/.rb/.php/.swift/.rs/etc.): SQL injection, XSS, hardcoded credentials, insecure deserialization, broken auth, CSRF, path traversal, command injection, prototype pollution, insecure crypto, missing input validation, debug code left in production, open redirects, IDOR, race conditions
- Shell scripts (.sh/.bash/.zsh/.ps1/.bat/.cmd): Command injection, unquoted variables, unsafe eval/exec, world-writable files, privilege escalation, unsafe use of sudo, sensitive data in arguments, missing error handling
- Markup & templates (.html/.ejs/.hbs/.twig/.pug): XSS via unescaped output, unsafe innerHTML, CSRF token absence, clickjacking, mixed content, insecure resource loading
- CSS/SCSS/LESS (.css/.scss/.sass/.less): CSS injection, data exfiltration via CSS, use of unsafe external fonts/resources
- Config & environment (.env/.ini/.cfg/.properties/.yaml/.yml): Hardcoded secrets/API keys/passwords, debug mode enabled in production, overly permissive CORS, insecure defaults, sensitive data committed
- Infrastructure as Code (.tf/.tfvars/.hcl/.bicep): Exposed cloud credentials, overly permissive IAM policies, public S3 buckets or storage, unencrypted data stores, open security groups (0.0.0.0/0), missing audit logging, no MFA enforcement, privileged containers, host path mounts
- Kubernetes & Docker (*.yaml k8s manifests, Dockerfile, docker-compose.yml): Privileged containers, running as root, exposed ports, no resource limits, hardcoded secrets in env vars, use of latest tag, insecure base images, no read-only root filesystem, no network policies, RBAC misconfigurations
- Build & dependency files (package.json, requirements.txt, Gemfile, pom.xml, go.mod, Cargo.toml, gradle): Known vulnerable dependency versions, dependency confusion attacks, unpinned versions, suspicious packages, overly broad permissions, exposed registry tokens
- Makefile / Rakefile / Jenkinsfile / CI configs: Command injection in build steps, exposed secrets in CI env, insecure artifact storage, missing SAST/DAST steps, insecure remote fetching
- Database (.sql/.prisma): SQL injection patterns, missing parameterized queries, unencrypted PII, over-privileged roles, missing row-level security
- Protocol buffers / Thrift (.proto/.thrift): Missing field validation, overly permissive schemas, sensitive data without encryption annotations

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary of security posture",
  "issues": [
    {
      "title": "Vulnerability title",
      "description": "Detailed explanation",
      "severity": "critical|high|medium|low",
      "possibleCause": "Root cause or anti-pattern",
      "suggestedFix": "Concrete actionable fix with code example where relevant",
      "codeSnippet": "Relevant vulnerable code or config snippet (or null)",
      "filePath": "path/to/file.ext or null",
      "lineNumber": null
    }
  ],
  "overallScore": <0-100>,
  "recommendations": ["Strategic recommendation 1", "Strategic recommendation 2"],
  "testType": "sast"
}

Score = 100 - (critical×25 + high×12 + medium×5 + low×2), minimum 0. Include 4-12 issues. Sort by severity descending.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 4096,
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;
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

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/runs", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
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
  if (!req.isAuthenticated()) {
    logSecurityEvent("AUTH_MISSING", req, "GET /stats");
    return void res.status(401).json({ error: "Authentication required" });
  }
  const userId = (req.user as { id: string }).id;
  try {
    const runs = await db
      .select({
        id: qaRunsTable.id, runType: qaRunsTable.runType,
        status: qaRunsTable.status, report: qaRunsTable.report,
      })
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
  if (!req.isAuthenticated()) {
    logSecurityEvent("AUTH_MISSING", req, "POST /runs");
    return void res.status(401).json({ error: "Authentication required" });
  }
  const userId = (req.user as { id: string }).id;

  // 1. Validate shape
  const parsed = urlRunSchema.safeParse(req.body);
  if (!parsed.success) {
    logSecurityEvent("INPUT_REJECTED", req, `Validation: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  // 2. Sanitise inputs
  let appUrl: string, appDescription: string;
  try {
    appDescription = sanitizeAndLimit(parsed.data.appDescription, 2000, "appDescription");
    // 3. SSRF check — blocks internal IPs, localhost, metadata endpoints
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
  if (!req.isAuthenticated()) {
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
  if (!uploadedFiles?.length) {
    return void res.status(400).json({ error: "No files uploaded" });
  }

  // Check total upload size
  const totalBytes = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > 50 * 1024 * 1024) {
    return void res.status(400).json({ error: "Total upload exceeds 50 MB limit" });
  }

  const rejected: string[] = [];
  const codeFiles = uploadedFiles
    .filter(f => {
      // Sanitise filename and re-check extension
      const safeName = sanitizeFilename(f.originalname);
      if (!isCodeFile(safeName)) {
        rejected.push(safeName);
        return false;
      }
      // Binary content check (magic bytes + null-byte density)
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
  if (!req.isAuthenticated()) {
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
    const [run] = await db
      .select()
      .from(qaRunsTable)
      .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));
    if (!run) return void res.status(404).json({ error: "Not found" });
    res.json(run);
  } catch {
    res.status(500).json({ error: "Failed to fetch run" });
  }
});

router.delete("/runs/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
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
    const [deleted] = await db
      .delete(qaRunsTable)
      .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)))
      .returning();
    if (!deleted) return void res.status(404).json({ error: "Not found" });
    res.json({ success: true as const });
  } catch {
    res.status(500).json({ error: "Failed to delete run" });
  }
});

export default router;
