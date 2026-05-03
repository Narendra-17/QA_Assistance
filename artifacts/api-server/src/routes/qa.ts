import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { qaRunsTable, shareTokensTable, issueStatusesTable } from "@workspace/db/schema";
import { eq, and, desc, gt, asc, count } from "drizzle-orm";
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

// ─── Per-user limits ──────────────────────────────────────────────────────────
const MAX_RUNS_PER_USER = 500;
// Cap individual file content sent to the AI: limits prompt-injection surface
// and prevents context-window overflow (~5k tokens per file at ~4 chars/token)
const MAX_FILE_CHARS = 20_000;

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

// ─── DAST header grader ───────────────────────────────────────────────────────

interface HeaderGrade {
  value: string | null;
  grade: "secure" | "weak" | "absent";
  note: string;
}

function gradeSecurityHeaders(headers: Record<string, string | null>): Record<string, HeaderGrade> {
  const g = (value: string | null, grade: HeaderGrade["grade"], note: string): HeaderGrade =>
    ({ value, grade, note });

  const csp = headers["content-security-policy"];
  const hsts = headers["strict-transport-security"];
  const xcto = headers["x-content-type-options"];
  const xfo = headers["x-frame-options"];
  const rp = headers["referrer-policy"];
  const pp = headers["permissions-policy"];

  return {
    "Content-Security-Policy": csp == null
      ? g(null, "absent", "Header not present — no CSP enforced")
      : /unsafe-inline|unsafe-eval|unsafe-hashes/i.test(csp)
        ? g(csp.slice(0, 200), "weak", "CSP present but contains unsafe directives (unsafe-inline/unsafe-eval)")
        : g(csp.slice(0, 200), "secure", "CSP is present with no unsafe directives"),

    "Strict-Transport-Security": hsts == null
      ? g(null, "absent", "HSTS not set — browser may allow HTTP downgrade")
      : /max-age=0/i.test(hsts)
        ? g(hsts, "weak", "HSTS present but max-age=0 effectively disables it")
        : /max-age=(\d+)/.test(hsts) && parseInt(hsts.match(/max-age=(\d+)/i)?.[1] ?? "0") < 2592000
          ? g(hsts, "weak", "HSTS max-age is under 30 days (recommended ≥ 1 year)")
          : g(hsts, "secure", "HSTS present with sufficient max-age"),

    "X-Content-Type-Options": xcto == null
      ? g(null, "absent", "Header absent — browser MIME sniffing is enabled")
      : xcto.toLowerCase().trim() === "nosniff"
        ? g(xcto, "secure", "Correctly set to nosniff")
        : g(xcto, "weak", `Present but value is '${xcto}' instead of 'nosniff'`),

    "X-Frame-Options": xfo == null
      ? g(null, "absent", "Clickjacking protection absent (no X-Frame-Options or CSP frame-ancestors)")
      : /^(DENY|SAMEORIGIN)$/i.test(xfo.trim())
        ? g(xfo, "secure", "Correctly restricts framing")
        : g(xfo, "weak", `Value '${xfo}' is not a standard directive`),

    "Referrer-Policy": rp == null
      ? g(null, "absent", "No Referrer-Policy — browser default may leak URLs")
      : /no-referrer|strict-origin/i.test(rp)
        ? g(rp, "secure", "Restrictive referrer policy in place")
        : g(rp, "weak", `Policy '${rp}' may leak URL data to third parties`),

    "Permissions-Policy": pp == null
      ? g(null, "absent", "No Permissions-Policy — browser features unrestricted")
      : g(pp.slice(0, 150), "secure", "Permissions-Policy is present"),
  };
}

async function analyzeUrl(
  appUrl: string,
  appDescription: string,
): Promise<Record<string, unknown>> {
  const isHttps = appUrl.startsWith("https://");
  const rawHeaders: Record<string, string | null> = {
    "strict-transport-security": null,
    "content-security-policy": null,
    "x-content-type-options": null,
    "x-frame-options": null,
    "x-xss-protection": null,
    "referrer-policy": null,
    "permissions-policy": null,
    "access-control-allow-origin": null,
    "x-powered-by": null,
    "server": null,
    "cache-control": null,
  };

  let pageData: Record<string, unknown> = { url: appUrl, fetchError: "Fetch not attempted" };

  try {
    // ── Parallel: main fetch + optional HTTP→HTTPS redirect check + CORS probe ──
    const mainController = new AbortController();
    const mainTimer = setTimeout(() => mainController.abort(), 15_000);
    const startTime = Date.now();
    const resp = await fetch(appUrl, {
      signal: mainController.signal,
      headers: { "User-Agent": "QAAssistant/1.0 (security-scanner)" },
      redirect: "follow",
    });
    const responseTimeMs = Date.now() - startTime;
    clearTimeout(mainTimer);

    for (const h of Object.keys(rawHeaders)) {
      rawHeaders[h] = resp.headers.get(h);
    }

    // ── CORS probe: does server reflect arbitrary Origin? ─────────────────
    let corsProbe: { reflectsArbitraryOrigin: boolean; allowOrigin: string | null; allowCredentials: string | null } | null = null;
    try {
      const corsCtrl = new AbortController();
      const corsTimer = setTimeout(() => corsCtrl.abort(), 6_000);
      const corsResp = await fetch(appUrl, {
        signal: corsCtrl.signal,
        headers: {
          "User-Agent": "QAAssistant/1.0 (security-scanner)",
          "Origin": "https://evil-attacker.example.com",
        },
      });
      clearTimeout(corsTimer);
      const allowOrigin = corsResp.headers.get("access-control-allow-origin");
      const allowCredentials = corsResp.headers.get("access-control-allow-credentials");
      corsProbe = {
        reflectsArbitraryOrigin: allowOrigin === "*" || allowOrigin === "https://evil-attacker.example.com",
        allowOrigin,
        allowCredentials,
      };
    } catch { /* non-fatal */ }

    // ── HTTP→HTTPS redirect check ─────────────────────────────────────────
    let httpToHttpsRedirect: "yes" | "no" | "n/a" = "n/a";
    if (isHttps) {
      try {
        const httpUrl = appUrl.replace(/^https:\/\//, "http://");
        const rCtrl = new AbortController();
        const rTimer = setTimeout(() => rCtrl.abort(), 5_000);
        const rResp = await fetch(httpUrl, { signal: rCtrl.signal, redirect: "manual",
          headers: { "User-Agent": "QAAssistant/1.0 (security-scanner)" } });
        clearTimeout(rTimer);
        const location = rResp.headers.get("location") ?? "";
        httpToHttpsRedirect = (rResp.status >= 301 && rResp.status <= 308 && location.startsWith("https://"))
          ? "yes" : "no";
      } catch { httpToHttpsRedirect = "no"; }
    }

    const html = await resp.text();

    // ── Cookie analysis ───────────────────────────────────────────────────
    const rawSetCookies: string[] = [];
    resp.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") rawSetCookies.push(value);
    });
    const cookies = rawSetCookies.slice(0, 10).map(c => ({
      nameHint: c.split("=")[0].trim().slice(0, 30),
      httpOnly: /;\s*httponly/i.test(c),
      secure: /;\s*secure/i.test(c),
      sameSite: /samesite=(strict|lax|none)/i.exec(c)?.[1]?.toLowerCase() ?? "not-set",
    }));

    // ── HTML intelligence ─────────────────────────────────────────────────
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "N/A";
    const formTags = [...html.matchAll(/<form[^>]*>/gi)].slice(0, 5);
    const forms = formTags.map(m => ({
      tag: m[0].slice(0, 150),
      method: /method=["']?(get|post)/i.exec(m[0])?.[1]?.toLowerCase() ?? "not-set",
      hasAction: /action=/i.test(m[0]),
    }));
    const inputTypes = [...html.matchAll(/<input[^>]+type=["']?(\w+)/gi)].map(m => m[1].toLowerCase());
    const hasPasswordInput = inputTypes.includes("password");
    const inlineScripts = (html.match(/<script(?:[^>](?!src=))*>/gi) ?? []).length;
    const externalScripts = (html.match(/<script[^>]+src=/gi) ?? []).length;
    const mixedContentRefs = isHttps
      ? (html.match(/(?:src|href|action)=["']http:\/\//gi) ?? []).length
      : 0;
    const hasCsrfToken = /<(?:input|meta)[^>]+(?:csrf|_token|authenticity_token)[^>]*>/i.test(html);
    const metaTags = [...html.matchAll(/<meta[^>]+>/gi)].slice(0, 6).map(m => m[0].slice(0, 200));

    // ── Graded header analysis ────────────────────────────────────────────
    const headerGrades = gradeSecurityHeaders(rawHeaders);

    // ── Server fingerprint ────────────────────────────────────────────────
    const serverFingerprint = rawHeaders["server"] ?? null;
    const poweredBy = rawHeaders["x-powered-by"] ?? null;

    pageData = {
      url: appUrl,
      statusCode: resp.status,
      isHttps,
      httpToHttpsRedirect,
      responseTimeMs,
      title,
      headerGrades,
      serverFingerprint,
      poweredBy,
      corsProbe,
      cookies: cookies.length > 0 ? cookies : "none observed",
      forms: { count: forms.length, details: forms },
      inputs: { count: inputTypes.length, types: [...new Set(inputTypes)] },
      hasPasswordInput,
      hasCsrfToken,
      scripts: { inline: inlineScripts, external: externalScripts },
      mixedContentRefs,
      metaTags,
    };
  } catch (err) {
    pageData = {
      url: appUrl,
      fetchError: err instanceof Error ? err.message : String(err),
      isHttps,
    };
  }

  const prompt = `You are a senior application security engineer performing DAST (Dynamic Application Security Testing). Your ONLY job is to report issues that are DIRECTLY CONFIRMED by the measured scan data below — not theoretical, not inferred.

Application URL: ${appUrl}
Developer description: ${appDescription}

Measured scan data (real HTTP response values):
${JSON.stringify(pageData, null, 2)}

════════════ STRICT RULES — VIOLATIONS MAKE THE REPORT WORTHLESS ════════════
1. EVIDENCE IS MANDATORY: Every issue MUST include an "evidence" field quoting the exact measured value from the scan data (e.g., "Strict-Transport-Security: absent", "CORS allowOrigin: *", "cookie 'session' missing Secure flag").
2. NO SERVER-SIDE INFERENCE: You CANNOT see server-side code. Do NOT report SQL injection, XSS, CSRF (unless CSRF token absence is directly confirmed in a form), command injection, path traversal, or any code-level vulnerability — these require code access you do not have.
3. SEVERITY CAPS:
   - "critical": Only for CONFIRMED exploitable misconfigurations (e.g., CORS reflects arbitrary origin WITH credentials=true, cookies missing both Secure and HttpOnly on an HTTPS login page)
   - "high": Confirmed bypass of a key security control (missing HSTS on HTTPS app, session cookie missing HttpOnly)
   - "medium": Absent security header or sub-optimal configuration that increases attack surface
   - "low": Informational / best-practice gap with low direct exploitability
4. DO NOT DUPLICATE: One finding per root cause. Do not report "missing X-Frame-Options" AND "missing CSP frame-ancestors" as two separate issues — pick the relevant one.
5. REPORT ONLY REAL FINDINGS: If a header is present and well-configured, say nothing about it. Do not invent issues to fill a quota. Returning 2 real issues is better than 8 invented ones.
6. If fetch failed: Note the failure in the summary. Report only what can be observed from the URL structure (HTTP vs HTTPS, domain) — nothing else.
════════════════════════════════════════════════════════════════════════════

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary citing only confirmed findings",
  "attackChain": "4-6 sentence narrative from attacker perspective using ONLY confirmed weaknesses. Do not invent server-side vulnerabilities.",
  "issues": [
    {
      "title": "Precise title naming the exact misconfiguration",
      "description": "What is wrong and why it matters. Reference the measured value.",
      "evidence": "The exact value observed (e.g., 'Content-Security-Policy: absent', 'Access-Control-Allow-Origin: *')",
      "severity": "critical|high|medium|low",
      "possibleCause": "Root cause",
      "suggestedFix": "Specific, actionable fix with example header/config value",
      "codeSnippet": null,
      "filePath": null,
      "lineNumber": null,
      "owasp": "A05:2021-Security Misconfiguration",
      "effortLevel": "low",
      "effortNote": "One response header change"
    }
  ],
  "overallScore": <0-100>,
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "testType": "url"
}

Score formula: 100 − (critical×20 + high×10 + medium×5 + low×2), minimum 0.
OWASP: A01:2021-Broken Access Control | A02:2021-Cryptographic Failures | A03:2021-Injection | A04:2021-Insecure Design | A05:2021-Security Misconfiguration | A06:2021-Vulnerable Components | A07:2021-Identification and Authentication Failures | A08:2021-Software and Data Integrity Failures | A09:2021-Security Logging and Monitoring Failures | A10:2021-Server-Side Request Forgery
effortLevel: "low" (<2 h), "medium" (half-day–2 days), "high" (multi-day/architectural)
Sort by severity descending. Maximum 8 issues.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 4096,
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;
}

// ─── SAST tech-stack detector ─────────────────────────────────────────────────

function detectTechStack(files: Array<{ name: string; content: string }>): string {
  const names = files.map(f => f.name.toLowerCase());
  const tags: string[] = [];

  if (names.some(n => n.endsWith("package.json"))) tags.push("Node.js/JavaScript");
  if (names.some(n => n.endsWith(".ts") || n.endsWith(".tsx"))) tags.push("TypeScript");
  if (names.some(n => n.endsWith(".py") || n.includes("requirements.txt"))) tags.push("Python");
  if (names.some(n => n.endsWith(".java") || n.includes("pom.xml"))) tags.push("Java");
  if (names.some(n => n.endsWith(".go") || n.includes("go.mod"))) tags.push("Go");
  if (names.some(n => n.endsWith(".php"))) tags.push("PHP");
  if (names.some(n => n.endsWith(".rb") || n.includes("gemfile"))) tags.push("Ruby");
  if (names.some(n => n.endsWith(".rs") || n.includes("cargo.toml"))) tags.push("Rust");
  if (names.some(n => n.endsWith(".tf") || n.endsWith(".hcl"))) tags.push("Terraform/IaC");
  if (names.some(n => n.includes("dockerfile") || n.includes("docker-compose"))) tags.push("Docker");
  if (names.some(n => n.endsWith(".yaml") && (n.includes("k8s") || n.includes("kubernetes") || n.includes("deploy")))) tags.push("Kubernetes");
  if (names.some(n => n.endsWith(".env") || n.endsWith(".env.local") || n.endsWith(".env.production"))) tags.push("environment config files");
  if (names.some(n => n.endsWith(".sql"))) tags.push("SQL");

  const allContent = files.map(f => f.content).join(" ");
  if (/express|fastify|koa|hapi/i.test(allContent)) tags.push("Express/Node HTTP server");
  if (/django|flask|fastapi/i.test(allContent)) tags.push("Python web framework");
  if (/react|vue|angular|svelte/i.test(allContent)) tags.push("Frontend framework (client-side)");
  if (/jwt|jsonwebtoken|pyjwt/i.test(allContent)) tags.push("JWT auth");
  if (/knex|sequelize|typeorm|prisma|drizzle/i.test(allContent)) tags.push("ORM/Query builder");
  if (/mysql|postgres|mongodb|redis|sqlite/i.test(allContent)) tags.push("Database access");

  return tags.length > 0 ? tags.join(", ") : "Unknown/Mixed";
}

// ─── SAST false-positive filter ───────────────────────────────────────────────

interface RawIssue {
  title?: unknown;
  description?: unknown;
  severity?: unknown;
  confidence?: unknown;
  codeSnippet?: unknown;
  filePath?: unknown;
  lineNumber?: unknown;
  detectionMethod?: unknown;
  owasp?: unknown;
  effortLevel?: unknown;
  effortNote?: unknown;
  possibleCause?: unknown;
  suggestedFix?: unknown;
  exploitScenario?: unknown;
  [key: string]: unknown;
}

/**
 * Post-processing filter: removes or downgrades AI findings that lack sufficient
 * evidence, are pure speculation, or duplicate existing issues.
 */
function filterSastIssues(rawIssues: RawIssue[], deterministicTitles: Set<string>): RawIssue[] {
  const seen = new Set<string>();
  const filtered: RawIssue[] = [];

  for (const issue of rawIssues) {
    const title = String(issue.title ?? "").trim();
    const confidence = String(issue.confidence ?? "confirmed").toLowerCase();
    const severity = String(issue.severity ?? "low").toLowerCase();
    const snippet = issue.codeSnippet;
    const exploitScenario = String(issue.exploitScenario ?? "").trim();

    // Drop duplicates by title similarity (normalize title for comparison)
    const titleKey = title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (seen.has(titleKey)) continue;
    seen.add(titleKey);

    // Drop if title overlaps with a deterministic finding
    const overlapsDeteministic = [...deterministicTitles].some(dt =>
      dt.toLowerCase().includes(titleKey.slice(0, 20)) ||
      titleKey.includes(dt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20))
    );
    if (overlapsDeteministic) continue;

    // Theoretical findings (confidence === "theoretical") with no code snippet
    // are downgraded to low — they add noise at high/critical
    if (confidence === "theoretical" && !snippet) {
      if (severity === "critical" || severity === "high") {
        issue.severity = "medium";
        issue.description = `[Theoretical — no specific vulnerable code identified] ${String(issue.description ?? "")}`;
      }
    }

    // Critical or high findings MUST have a code snippet OR an exploit scenario
    // If neither is present, downgrade to medium
    if ((severity === "critical" || severity === "high") && !snippet && !exploitScenario) {
      issue.severity = "medium";
      issue.description = `[Downgraded: no specific vulnerable code or exploit path provided] ${String(issue.description ?? "")}`;
    }

    filtered.push(issue);
  }

  return filtered;
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
  const deterministicTitles = new Set(deterministicIssues.map(i => i.title));

  // ── Phase 2: AI analysis ──────────────────────────────────────────────────
  // Use up to 5,000 chars per file (vs previous 2,500) to reduce context-truncation
  // false positives. Prioritize source code files over config/lock files.
  const prioritized = [
    ...files.filter(f => {
      const ext = path.extname(f.name).toLowerCase();
      return [".ts",".tsx",".js",".jsx",".py",".java",".go",".php",".rb",".rs",".cs",".c",".cpp",".sh"].includes(ext);
    }),
    ...files.filter(f => {
      const ext = path.extname(f.name).toLowerCase();
      return ![".ts",".tsx",".js",".jsx",".py",".java",".go",".php",".rb",".rs",".cs",".c",".cpp",".sh"].includes(ext);
    }),
  ];

  const filesSummary = prioritized
    .slice(0, 25)
    .map(f => `### ${f.name}\n\`\`\`\n${f.content.slice(0, 5000)}\n\`\`\``)
    .join("\n\n");

  const fileTypes = [...new Set(files.map(f =>
    path.extname(f.name).toLowerCase() || path.basename(f.name).toLowerCase()
  ))].join(", ");

  const techStack = detectTechStack(files);

  const alreadyFound = deterministicIssues.length > 0
    ? `\nALREADY DETECTED by deterministic scanners — do NOT repeat these:\n${deterministicIssues.map(i => `• ${i.title}`).join("\n")}\n`
    : "";

  const prompt = `You are a senior application security engineer performing SAST (Static Application Security Testing). Your goal is PRECISION over volume — a report with 3 real vulnerabilities is vastly better than one with 10 speculative findings.

Project: ${projectName}
Description: ${description}
Tech stack detected: ${techStack}
Files analyzed: ${files.length} (${fileTypes})
${alreadyFound}

${filesSummary}

════════════ STRICT ACCURACY RULES ════════════
1. CITE THE CODE: Every finding MUST include a "codeSnippet" with the actual vulnerable line(s). If you cannot point to a specific line in the provided code that is vulnerable, do NOT report the issue.
2. EXPLOIT REQUIRED: Every critical/high finding MUST include an "exploitScenario" — a concrete 1-2 sentence description of exactly how an attacker would exploit this specific code. Generic exploit descriptions are not acceptable.
3. CONFIDENCE FIELD (required):
   - "confirmed" — vulnerable code is clearly visible in the provided snippet
   - "probable" — pattern strongly suggests a vulnerability but full context is missing
   - "theoretical" — the pattern could be vulnerable depending on code not provided
4. SEVERITY RULES:
   - "critical": Directly exploitable with high impact (RCE, SQLi with raw string concat, auth bypass). Must be "confirmed" confidence.
   - "high": Clear vulnerability, exploitable with moderate effort. Must be "confirmed" or "probable".
   - "medium": Real weakness, exploitability depends on configuration or context. Any confidence level.
   - "low": Best-practice gap, defense-in-depth suggestion.
5. NO MINIMUM COUNT: Do NOT pad the report. If only 2 real issues exist, return 2. Return 0 if the code is clean.
6. NO DUPLICATE CLASSES: Report a class of vulnerability once (e.g., if multiple files have unparameterized queries, report the worst instance and note it appears in multiple files — don't create one issue per file).
7. CONTEXT AWARENESS: Consider the full file before flagging. If you see a dangerous function call, check if there is input validation or sanitization earlier in the same file before reporting it.
════════════════════════════════════════════════

Vulnerability checklist by file type (only report if directly observed in the code):
- Server-side source: SQL injection (raw string concat with user input), command injection (child_process/exec with user input), path traversal (fs operations with user-controlled paths), insecure deserialization, SSRF, XXE, broken auth patterns, missing authorization checks, insecure crypto (MD5/SHA1 for passwords, weak IV, hardcoded keys)
- Client-side/templates: Unescaped user-controlled values rendered as HTML (innerHTML, dangerouslySetInnerHTML), open redirects with user-controlled URLs
- Config: debug/development mode in production builds, overly permissive CORS (allow all origins), insecure defaults
- IaC: public S3 buckets, wildcard IAM permissions, unencrypted storage, exposed management ports
- Docker/K8s: running as root, privileged containers, secrets in environment variables, no resource limits
- CI/CD: user-controlled data in shell run steps (script injection), insecure artifact handling

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary. Be honest if the codebase is mostly clean.",
  "attackChain": "4-6 sentence narrative from attacker perspective using only the confirmed vulnerabilities found. If none are critical/high, note the limited attack surface observed.",
  "issues": [
    {
      "title": "Specific vulnerability title naming the function/pattern",
      "description": "Explanation of the vulnerability and why the specific code is dangerous",
      "exploitScenario": "Concrete 1-2 sentence example of how an attacker exploits THIS code",
      "confidence": "confirmed|probable|theoretical",
      "severity": "critical|high|medium|low",
      "possibleCause": "Root cause",
      "suggestedFix": "Concrete fix with corrected code example",
      "codeSnippet": "The exact vulnerable line(s) from the provided files",
      "filePath": "path/to/file.ext",
      "lineNumber": null,
      "detectionMethod": "ai",
      "owasp": "A03:2021-Injection",
      "effortLevel": "medium",
      "effortNote": "Must update all raw query calls in this file"
    }
  ],
  "overallScore": 0,
  "recommendations": ["Strategic recommendation 1"],
  "testType": "sast"
}

OWASP: A01:2021-Broken Access Control | A02:2021-Cryptographic Failures | A03:2021-Injection | A04:2021-Insecure Design | A05:2021-Security Misconfiguration | A06:2021-Vulnerable Components | A07:2021-Identification and Authentication Failures | A08:2021-Software and Data Integrity Failures | A09:2021-Security Logging and Monitoring Failures | A10:2021-Server-Side Request Forgery
effortLevel: "low" (<2 h), "medium" (half-day–2 days), "high" (multi-day/architectural)
Set overallScore to 0 — it will be recalculated server-side. Sort by severity descending.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 4096,
  });

  const aiResult = JSON.parse(completion.choices[0].message.content ?? "{}") as Record<string, unknown>;

  // ── Phase 3: Post-process AI findings to remove false positives ───────────
  const rawAiIssues = (aiResult.issues as RawIssue[]) ?? [];
  const filteredAiIssues = filterSastIssues(rawAiIssues, deterministicTitles);

  // ── Phase 4: Merge and recalculate score ──────────────────────────────────
  const allIssues = [...deterministicIssues, ...filteredAiIssues];
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
    const rawRuns = await db
      .select({
        id: qaRunsTable.id, userId: qaRunsTable.userId, runType: qaRunsTable.runType,
        appUrl: qaRunsTable.appUrl, appDescription: qaRunsTable.appDescription,
        projectName: qaRunsTable.projectName, status: qaRunsTable.status,
        errorMessage: qaRunsTable.errorMessage, createdAt: qaRunsTable.createdAt,
        updatedAt: qaRunsTable.updatedAt, report: qaRunsTable.report,
      })
      .from(qaRunsTable)
      .where(eq(qaRunsTable.userId, userId))
      .orderBy(desc(qaRunsTable.createdAt));

    // Return only a minimal report summary so the dashboard can show scores/severity bars
    // without sending full issue descriptions across the wire.
    const runs = rawRuns.map(r => {
      const rep = r.report as { overallScore?: number; issues?: Array<{ severity: string }> } | null;
      const { report: _rep, ...rest } = r;
      return {
        ...rest,
        report: rep
          ? {
              overallScore: rep.overallScore ?? 0,
              issues: (rep.issues ?? []).map((i: { severity: string; owasp?: string | null }) => ({ severity: i.severity, owasp: i.owasp ?? null })),
            }
          : null,
      };
    });
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
    const [runs, historyRows] = await Promise.all([
      db.select({ id: qaRunsTable.id, runType: qaRunsTable.runType, status: qaRunsTable.status, report: qaRunsTable.report })
        .from(qaRunsTable).where(eq(qaRunsTable.userId, userId)),
      db.select({
        id: qaRunsTable.id, runType: qaRunsTable.runType,
        createdAt: qaRunsTable.createdAt, report: qaRunsTable.report,
        appUrl: qaRunsTable.appUrl, projectName: qaRunsTable.projectName,
      }).from(qaRunsTable)
        .where(and(eq(qaRunsTable.userId, userId), eq(qaRunsTable.status, "completed")))
        .orderBy(asc(qaRunsTable.createdAt))
        .limit(25),
    ]);

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

    const scoreHistory = historyRows.map(r => {
      const rep = r.report as Record<string, unknown> | null;
      let label = "Unknown";
      try { label = r.appUrl ? new URL(r.appUrl).hostname : (r.projectName ?? "Unknown"); } catch { label = r.appUrl ?? r.projectName ?? "Unknown"; }
      return {
        id: r.id,
        score: Number(rep?.overallScore ?? 0),
        runType: r.runType,
        createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
        label,
      };
    });

    // OWASP breakdown across all completed runs
    const owaspMap: Record<string, { count: number; critical: number }> = {};
    for (const r of completed) {
      const rep = r.report as Record<string, unknown> | null;
      if (rep) {
        for (const issue of ((rep.issues ?? []) as Array<{ owasp?: string | null; severity: string }>)) {
          const code = issue.owasp?.match(/^(A\d{2})/)?.[1];
          if (code) {
            if (!owaspMap[code]) owaspMap[code] = { count: 0, critical: 0 };
            owaspMap[code].count++;
            if (issue.severity === "critical" || issue.severity === "high") owaspMap[code].critical++;
          }
        }
      }
    }
    const owaspBreakdown = Object.entries(owaspMap)
      .map(([code, { count, critical }]) => ({ code, count, critical }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      totalRuns: runs.length,
      completedRuns: completed.length,
      failedRuns: runs.filter(r => r.status === "failed").length,
      averageScore: completed.length > 0 ? Math.round(totalScore / completed.length) : 0,
      criticalIssues, highIssues,
      urlRuns: runs.filter(r => r.runType === "url").length,
      sastRuns: runs.filter(r => r.runType === "sast").length,
      scoreHistory,
      owaspBreakdown,
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
    const [{ runCount }] = await db.select({ runCount: count() }).from(qaRunsTable).where(eq(qaRunsTable.userId, userId));
    if (runCount >= MAX_RUNS_PER_USER) {
      return void res.status(429).json({ error: `Scan limit reached (${MAX_RUNS_PER_USER} scans). Delete old runs to continue.` });
    }

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
      // Truncate to MAX_FILE_CHARS to cap prompt-injection surface and prevent
      // AI context-window overflow.  5 MB files would otherwise pass verbatim.
      content: f.buffer.toString("utf-8").replace(/\0/g, "").slice(0, MAX_FILE_CHARS),
    }))
    .filter(f => f.content.trim().length > 0);

  if (!codeFiles.length) {
    return void res.status(400).json({
      error: "No readable source code files found.",
      rejected: rejected.length ? rejected : undefined,
    });
  }

  try {
    const [{ runCount: sastCount }] = await db.select({ runCount: count() }).from(qaRunsTable).where(eq(qaRunsTable.userId, userId));
    if (sastCount >= MAX_RUNS_PER_USER) {
      return void res.status(429).json({ error: `Scan limit reached (${MAX_RUNS_PER_USER} scans). Delete old runs to continue.` });
    }

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

// ─── AI Code Fix Generator ────────────────────────────────────────────────────
// Generates a ready-to-paste, language-specific fix for a single issue.

router.post("/runs/:id/generate-fix", async (req: Request, res: Response) => {
  if (!isAuthed(req)) {
    logSecurityEvent("AUTH_MISSING", req, `POST /runs/${req.params.id}/generate-fix`);
    return void res.status(401).json({ error: "Authentication required" });
  }

  const id = String(req.params.id);
  if (!isValidUuid(id)) return void res.status(400).json({ error: "Invalid run ID format" });

  const { issueIndex } = req.body as { issueIndex: number };
  if (typeof issueIndex !== "number" || issueIndex < 0 || issueIndex > 9999) {
    return void res.status(400).json({ error: "Invalid issue index" });
  }

  const userId = (req.user as { id: string }).id;
  const [run] = await db.select().from(qaRunsTable)
    .where(and(eq(qaRunsTable.id, id), eq(qaRunsTable.userId, userId)));

  if (!run) return void res.status(404).json({ error: "Run not found" });
  if (run.status !== "completed" || !run.report) {
    return void res.status(400).json({ error: "Run not completed" });
  }

  const report = run.report as { issues?: unknown[] };
  const issue = report.issues?.[issueIndex] as Record<string, unknown> | undefined;
  if (!issue) return void res.status(404).json({ error: "Issue not found" });

  const fixController = new AbortController();
  const fixTimeout = setTimeout(() => fixController.abort(), 30_000);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: `You are a senior security engineer. Generate a precise, production-ready code fix for this vulnerability.

Issue: ${String(issue.title ?? "")}
Severity: ${String(issue.severity ?? "")}
Description: ${String(issue.description ?? "")}
Root Cause: ${String(issue.possibleCause ?? "")}
Suggested Fix Direction: ${String(issue.suggestedFix ?? "")}
${issue.filePath ? `File: ${String(issue.filePath)}` : ""}
${issue.codeSnippet ? `Vulnerable code:\n\`\`\`\n${String(issue.codeSnippet)}\n\`\`\`` : ""}
Scan type: ${run.runType === "sast" ? "Source code (SAST)" : "Live URL (DAST)"}
${run.appUrl ? `URL: ${run.appUrl}` : ""}

Generate a complete, ready-to-paste fix. Include imports if needed. Fix the exact vulnerability — don't just add a comment.

Respond with ONLY valid JSON:
{
  "fixCode": "the complete code fix, properly formatted",
  "explanation": "2-3 sentences explaining exactly what was changed and why this eliminates the vulnerability",
  "language": "programming language name (e.g. typescript, python, javascript, yaml, bash)",
  "testSuggestion": "one concrete test/verification step to confirm the fix works"
}`,
      }],
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 1500,
    }, { signal: fixController.signal });

    clearTimeout(fixTimeout);
    const result = JSON.parse(completion.choices[0].message.content ?? "{}");
    res.json(result);
  } catch (err) {
    clearTimeout(fixTimeout);
    if (err instanceof Error && err.name === "AbortError") {
      return void res.status(504).json({ error: "Fix generation timed out. Please try again." });
    }
    res.status(500).json({ error: "Failed to generate fix" });
  }
});

export default router;
