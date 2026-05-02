/**
 * API Key management routes.
 * All routes require an authenticated session (not API-key auth — keys can't create keys).
 *
 * POST   /api/keys          — create a new API key (returns plaintext once)
 * GET    /api/keys          — list all keys for current user (hashes never returned)
 * DELETE /api/keys/:id      — revoke a key
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { generateApiKey, hashApiKey } from "../lib/api-key-auth";
import { sanitizeAndLimit, isValidUuid } from "../lib/security";

const router = Router();

const CreateKeySchema = z.object({
  name: z.string().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// ─── Require session auth ────────────────────────────────────────────────────

function requireSession(req: Request, res: Response, next: () => void) {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

// ─── POST /api/keys ──────────────────────────────────────────────────────────

router.post("/keys", requireSession, async (req: Request, res: Response) => {
  const parsed = CreateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }

  const userId = (req.user as { id: string }).id;
  const { name, expiresInDays } = parsed.data;

  // Safety: max 20 keys per user
  const existing = await db
    .select({ id: apiKeysTable.id })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId));

  if (existing.length >= 20) {
    res.status(429).json({ error: "Maximum of 20 API keys reached. Revoke some before creating new ones." });
    return;
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12); // "qak_" + 8 chars

  const sanitizedName = sanitizeAndLimit(name, 80, "name");

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [created] = await db
    .insert(apiKeysTable)
    .values({
      userId,
      name: sanitizedName,
      keyHash,
      keyPrefix,
      ...(expiresAt ? { expiresAt } : {}),
    })
    .returning();

  // Return the plaintext key ONCE — it can never be retrieved again
  res.status(201).json({
    id: created.id,
    name: created.name,
    keyPrefix: created.keyPrefix,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
    key: rawKey, // ← plaintext, shown only this one time
  });
});

// ─── GET /api/keys ───────────────────────────────────────────────────────────

router.get("/keys", requireSession, async (req: Request, res: Response) => {
  const userId = (req.user as { id: string }).id;

  const keys = await db
    .select({
      id: apiKeysTable.id,
      name: apiKeysTable.name,
      keyPrefix: apiKeysTable.keyPrefix,
      lastUsedAt: apiKeysTable.lastUsedAt,
      expiresAt: apiKeysTable.expiresAt,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, userId))
    .orderBy(apiKeysTable.createdAt);

  res.json({ keys });
});

// ─── DELETE /api/keys/:id ────────────────────────────────────────────────────

router.delete("/keys/:id", requireSession, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isValidUuid(id)) {
    res.status(400).json({ error: "Invalid key ID" });
    return;
  }

  const userId = (req.user as { id: string }).id;

  const [deleted] = await db
    .delete(apiKeysTable)
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, userId)))
    .returning({ id: apiKeysTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Key not found or not yours" });
    return;
  }

  res.json({ success: true });
});

export default router;
