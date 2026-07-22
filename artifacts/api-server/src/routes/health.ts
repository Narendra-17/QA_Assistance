import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// Server start time for uptime calculation
const SERVER_START = Date.now();

router.get("/healthz", async (_req, res) => {
  const checks: Record<string, unknown> = {
    status: "ok",
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    timestamp: new Date().toISOString(),
  };

  // ── Database connectivity ──────────────────────────────────────────────────
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    checks.status = "degraded";
  }
  checks.database = dbOk ? "ok" : "unreachable";

  // ── AI API reachability (lightweight model list call, no tokens used) ──────
  let aiOk = false;
  const aiKillSwitch = process.env.DISABLE_AI === "true";
  if (aiKillSwitch) {
    checks.ai = "disabled (kill switch active)";
  } else {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI timeout")), 5_000)
      );
      await Promise.race([openai.models.list(), timeout]);
      aiOk = true;
    } catch {
      checks.status = "degraded";
    }
    checks.ai = aiOk ? "ok" : "unreachable";
  }

  const httpStatus = checks.status === "ok" ? 200 : 503;

  try {
    const data = HealthCheckResponse.parse({ status: String(checks.status) });
    res.status(httpStatus).json({ ...data, ...checks });
  } catch {
    res.status(httpStatus).json(checks);
  }
});

export default router;
