/**
 * API Key authentication middleware.
 * Accepts "Authorization: Bearer qak_<key>" and resolves req.user.
 * Used to allow CI/CD pipelines (GitHub Actions, CLI) to call the API.
 */

import { createHash } from "crypto";
import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db/schema";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const KEY_PREFIX = "qak_";

/** Generate a new API key: prefix + 32 random hex chars */
export function generateApiKey(): string {
  const { randomBytes } = require("crypto");
  return KEY_PREFIX + (randomBytes(32) as Buffer).toString("hex");
}

/** Hash a raw API key for storage */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Express middleware.
 * If the request carries a valid API key header, populates req.user and calls next().
 * If the header looks like an API key but is invalid/expired, responds 401.
 * If no API key header is present, falls through (next()) for session auth to handle.
 */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith(`Bearer ${KEY_PREFIX}`)) {
    next();
    return;
  }

  const rawKey = authHeader.slice(7); // strip "Bearer "
  const hash = hashApiKey(rawKey);

  const [apiKey] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, hash))
    .limit(1);

  if (!apiKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    res.status(401).json({ error: "API key expired" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, apiKey.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "API key user not found" });
    return;
  }

  // Update lastUsedAt fire-and-forget
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, apiKey.id))
    .catch(() => {});

  // Populate req.user for downstream route handlers (same shape as session auth)
  (req as Request & { user: typeof user }).user = user;
  next();
}
