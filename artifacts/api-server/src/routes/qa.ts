import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qaRunsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import OpenAI from "openai";
import multer from "multer";
import path from "path";

const router = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 30 },
});

// ─── helpers ────────────────────────────────────────────────────────────────

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".java", ".kt", ".cs", ".go", ".rb", ".php",
  ".c", ".cpp", ".h", ".hpp", ".rs",
  ".html", ".vue", ".svelte",
  ".env", ".env.example", ".json", ".yaml", ".yml",
  ".toml", ".sh", ".bash", ".sql", ".graphql",
]);

function isCodeFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename).toLowerCase();
  return CODE_EXTS.has(ext) || base === "dockerfile" || base === ".env";
}

async function analyzeUrl(appUrl: string, appDescription: string): Promise<Record<string, unknown>> {
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
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(appUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "QAAssistant/1.0" },
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
    const hasHttps = appUrl.startsWith("https://");

    pageContent = JSON.stringify({
      url: appUrl,
      statusCode: resp.status,
      isHttps: hasHttps,
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
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;
}

async function analyzeCode(files: Array<{ name: string; content: string }>, projectName: string, description: string): Promise<Record<string, unknown>> {
  const filesSummary = files
    .slice(0, 25)
    .map(f => `### ${f.name}\n\`\`\`\n${f.content.slice(0, 2500)}\n\`\`\``)
    .join("\n\n");

  const prompt = `You are a senior security engineer performing Static Application Security Testing (SAST). Analyze the source code for security vulnerabilities, code quality issues, and best-practice violations.

Project: ${projectName}
Description: ${description}
Files analyzed: ${files.length}

${filesSummary}

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary of security posture",
  "issues": [
    {
      "title": "Vulnerability title",
      "description": "Detailed explanation",
      "severity": "critical|high|medium|low",
      "possibleCause": "Root cause or anti-pattern",
      "suggestedFix": "Concrete fix with example code snippet",
      "codeSnippet": "Relevant vulnerable code (or null)",
      "filePath": "path/to/file.ext or null",
      "lineNumber": null
    }
  ],
  "overallScore": <0-100>,
  "recommendations": ["Strategic recommendation 1"],
  "testType": "sast"
}

Check for: SQL injection, XSS, hardcoded secrets/API keys, insecure deps, CSRF, path traversal, insecure deserialization, broken auth, sensitive data exposure, XXE, IDOR, open redirect, command injection, weak crypto, missing input validation, debug code in prod, missing rate limiting, insecure CORS, prototype pollution. Score = 100 - (critical×25 + high×12 + medium×5 + low×2), min 0. Sort by severity desc.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;
}

// ─── routes ─────────────────────────────────────────────────────────────────

router.get("/runs", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const userId = (req.user as { id: string }).id;
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
});

router.get("/stats", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const userId = (req.user as { id: string }).id;
  const runs = await db.select().from(qaRunsTable).where(eq(qaRunsTable.userId, userId));

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
});

router.post("/runs", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const userId = (req.user as { id: string }).id;

  const parsed = z.object({ appUrl: z.url(), appDescription: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid request" });

  const { appUrl, appDescription } = parsed.data;
  const [run] = await db.insert(qaRunsTable).values({ userId, runType: "url", appUrl, appDescription, status: "running" }).returning();
  res.status(201).json(run);

  analyzeUrl(appUrl, appDescription)
    .then(report => db.update(qaRunsTable).set({ status: "completed", report }).where(eq(qaRunsTable.id, run.id)))
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      await db.update(qaRunsTable).set({ status: "failed", errorMessage: msg }).where(eq(qaRunsTable.id, run.id));
    });
});

router.post("/sast", upload.array("files", 30), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const userId = (req.user as { id: string }).id;

  const parsed = z.object({ projectName: z.string().min(1), description: z.string().min(5) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid request" });

  const { projectName, description } = parsed.data;
  const uploadedFiles = req.files as Express.Multer.File[];
  if (!uploadedFiles?.length) return void res.status(400).json({ error: "No files uploaded" });

  const codeFiles = uploadedFiles
    .filter(f => isCodeFile(f.originalname))
    .map(f => ({ name: f.originalname, content: f.buffer.toString("utf-8").replace(/\0/g, "") }))
    .filter(f => f.content.length > 0);

  if (!codeFiles.length) return void res.status(400).json({ error: "No readable code files found. Please upload source code files." });

  const [run] = await db.insert(qaRunsTable).values({ userId, runType: "sast", projectName, appDescription: description, status: "running" }).returning();
  res.status(201).json(run);

  analyzeCode(codeFiles, projectName, description)
    .then(report => db.update(qaRunsTable).set({ status: "completed", report }).where(eq(qaRunsTable.id, run.id)))
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      await db.update(qaRunsTable).set({ status: "failed", errorMessage: msg }).where(eq(qaRunsTable.id, run.id));
    });
});

router.get("/runs/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const userId = (req.user as { id: string }).id;
  const [run] = await db.select().from(qaRunsTable).where(and(eq(qaRunsTable.id, req.params.id), eq(qaRunsTable.userId, userId)));
  if (!run) return void res.status(404).json({ error: "Not found" });
  res.json(run);
});

router.delete("/runs/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return void res.status(401).json({ error: "Unauthorized" });
  const userId = (req.user as { id: string }).id;
  const [deleted] = await db.delete(qaRunsTable).where(and(eq(qaRunsTable.id, req.params.id), eq(qaRunsTable.userId, userId))).returning();
  if (!deleted) return void res.status(404).json({ error: "Not found" });
  res.json({ success: true as const });
});

export default router;
