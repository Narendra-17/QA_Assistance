import { Router, type IRouter, type Request, type Response } from "express";
import { db, qaRunsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { CreateQaRunBody, GetQaRunParams, DeleteQaRunParams } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import https from "https";
import http from "http";

const router: IRouter = Router();

interface QaIssue {
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  possibleCause: string;
  suggestedFix: string;
}

interface QaReport {
  summary: string;
  issues: QaIssue[];
  overallScore: number;
  recommendations: string[];
  screenshotBase64: null;
}

function fetchPageContent(url: string): Promise<{ html: string; statusCode: number; headers: Record<string, string>; error?: string }> {
  return new Promise((resolve) => {
    const timeoutMs = 10000;
    const protocol = url.startsWith("https") ? https : http;

    const req = protocol.get(url, {
      timeout: timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; QA-Assistant/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        resolve({ html: data.slice(0, 50000), statusCode: res.statusCode || 0, headers });
      });
      res.on("error", (e) => resolve({ html: "", statusCode: 0, headers: {}, error: e.message }));
    });

    req.on("error", (e) => resolve({ html: "", statusCode: 0, headers: {}, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ html: "", statusCode: 0, headers: {}, error: "Request timed out after 10s" });
    });
  });
}

function extractPageInfo(html: string, url: string, statusCode: number, headers: Record<string, string>, fetchError?: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "No title found";
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean).slice(0, 5);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean).slice(0, 8);
  const forms = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/gi)].length;
  const inputs = [...html.matchAll(/<input[^>]*>/gi)].length;
  const buttons = [...html.matchAll(/<button[^>]*>/gi)].length;
  const links = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).slice(0, 15);
  const images = [...html.matchAll(/<img[^>]*>/gi)].length;
  const hasJavaScript = html.includes("<script");
  const metaTags = [...html.matchAll(/<meta[^>]*>/gi)].map(m => m[0]).slice(0, 10);
  const consoleErrors: string[] = [];
  const missingAlt = [...html.matchAll(/<img(?![^>]*alt=)[^>]*>/gi)].length;
  const contentLength = html.length;
  const responseTime = statusCode > 0 ? "Available" : "Not measurable";
  const contentType = headers["content-type"] || "unknown";
  const hasViewport = html.includes('name="viewport"') || html.includes("name='viewport'");
  const hasOpenGraph = html.includes('property="og:');
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);

  return {
    url,
    statusCode,
    fetchError,
    title,
    h1s,
    h2s,
    forms,
    inputs,
    buttons,
    links,
    images,
    missingAlt,
    hasJavaScript,
    metaTags,
    contentLength,
    responseTime,
    contentType,
    hasViewport,
    hasOpenGraph,
    bodyText,
    consoleErrors,
  };
}

async function runQaAnalysis(runId: string, appUrl: string, appDescription: string) {
  await db.update(qaRunsTable).set({ status: "running" }).where(eq(qaRunsTable.id, runId));

  try {
    const { html, statusCode, headers, error: fetchError } = await fetchPageContent(appUrl);
    const pageInfo = extractPageInfo(html, appUrl, statusCode, headers, fetchError);

    const systemPrompt = `You are an expert QA engineer who analyzes web applications. 
Your job is to analyze the provided page data and generate a comprehensive QA report.
You must respond ONLY with a valid JSON object matching this exact structure:
{
  "summary": "string - overall assessment of the application",
  "issues": [
    {
      "title": "string",
      "description": "string - detailed description of the issue",
      "severity": "low" | "medium" | "high" | "critical",
      "possibleCause": "string",
      "suggestedFix": "string"
    }
  ],
  "overallScore": number (0-100),
  "recommendations": ["string"]
}
Be thorough and identify real issues. Score 0-100 where 100 is perfect. Consider: accessibility, SEO, performance indicators, UI completeness, security headers, and how well the app matches the described functionality.`;

    const userPrompt = `Analyze this web application for QA issues.

User's description of expected functionality:
${appDescription}

Page Analysis Results:
- URL: ${pageInfo.url}
- HTTP Status Code: ${pageInfo.statusCode || "Failed to connect"}
- Fetch Error: ${pageInfo.fetchError || "None"}
- Content Type: ${pageInfo.contentType}
- Page Title: ${pageInfo.title}
- H1 Tags: ${pageInfo.h1s.join(", ") || "None found"}
- H2 Tags: ${pageInfo.h2s.join(", ") || "None found"}
- Forms: ${pageInfo.forms}
- Input Fields: ${pageInfo.inputs}
- Buttons: ${pageInfo.buttons}
- Images: ${pageInfo.images} (${pageInfo.missingAlt} missing alt text)
- Internal/External Links: ${pageInfo.links.slice(0, 8).join(", ")}
- Has JavaScript: ${pageInfo.hasJavaScript}
- Has Viewport Meta: ${pageInfo.hasViewport}
- Has Open Graph Tags: ${pageInfo.hasOpenGraph}
- Content Length: ${pageInfo.contentLength} bytes
- Security Headers Present: ${Object.keys(pageInfo.headers).filter(h => ["x-frame-options","x-content-type-options","strict-transport-security","content-security-policy"].includes(h.toLowerCase())).join(", ") || "None detected"}
- Meta Tags: ${pageInfo.metaTags.join("; ")}
- Page Text Sample: ${pageInfo.bodyText.slice(0, 1500)}

Identify issues based on:
1. Whether the app appears to match the described functionality
2. Accessibility issues (missing alt text, viewport meta, etc.)
3. SEO issues (missing title, meta description, OG tags)
4. Security concerns (missing security headers)
5. Performance indicators (page size, javascript usage)
6. UI/UX completeness (expected forms/buttons based on description)
7. Connectivity/availability issues
8. Any other quality concerns

Generate between 3-12 issues. Be specific and actionable.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse AI response as JSON");

    const report: QaReport = JSON.parse(jsonMatch[0]);
    report.screenshotBase64 = null;

    report.overallScore = Math.max(0, Math.min(100, Math.round(report.overallScore)));

    await db.update(qaRunsTable).set({
      status: "completed",
      report: report as unknown as Record<string, unknown>,
    }).where(eq(qaRunsTable.id, runId));

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await db.update(qaRunsTable).set({
      status: "failed",
      errorMessage: errorMsg,
    }).where(eq(qaRunsTable.id, runId));
  }
}

router.get("/qa/runs", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const runs = await db
    .select()
    .from(qaRunsTable)
    .where(eq(qaRunsTable.userId, req.user.id))
    .orderBy(desc(qaRunsTable.createdAt));

  res.json({ runs });
});

router.post("/qa/runs", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateQaRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }

  const { appUrl, appDescription } = parsed.data;

  const [run] = await db.insert(qaRunsTable).values({
    userId: req.user.id,
    appUrl,
    appDescription,
    status: "pending",
  }).returning();

  res.status(201).json(run);

  runQaAnalysis(run.id, appUrl, appDescription).catch((err) => {
    req.log.error({ err }, "QA analysis failed");
  });
});

router.get("/qa/runs/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = GetQaRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(qaRunsTable)
    .where(and(eq(qaRunsTable.id, parsed.data.id), eq(qaRunsTable.userId, req.user.id)));

  if (!run) {
    res.status(404).json({ error: "QA run not found" });
    return;
  }

  res.json({ ...run, report: run.report ?? null });
});

router.delete("/qa/runs/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = DeleteQaRunParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }

  const [run] = await db
    .select()
    .from(qaRunsTable)
    .where(and(eq(qaRunsTable.id, parsed.data.id), eq(qaRunsTable.userId, req.user.id)));

  if (!run) {
    res.status(404).json({ error: "QA run not found" });
    return;
  }

  await db.delete(qaRunsTable).where(eq(qaRunsTable.id, parsed.data.id));
  res.json({ success: true });
});

export default router;
