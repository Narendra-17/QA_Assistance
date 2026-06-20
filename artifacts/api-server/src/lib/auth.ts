import crypto from "crypto";
import bcrypt from "bcryptjs";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";
import { isValidSessionId } from "./security";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export const BCRYPT_ROUNDS = 12;

export interface SessionData {
  user: AuthUser;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

// Sessions expire in 7 days; refresh the expiry when more than 1 day has elapsed
// since the last implicit refresh (i.e. when there are fewer than 6 days left).
const SESSION_REFRESH_THRESHOLD_MS = 6 * 24 * 60 * 60 * 1000;

export async function getSession(sid: string): Promise<SessionData | null> {
  // Reject malformed session IDs before hitting the database
  if (!isValidSessionId(sid)) return null;

  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  // Sliding window: extend TTL if the session will expire within 6 days
  const remaining = row.expire.getTime() - Date.now();
  if (remaining < SESSION_REFRESH_THRESHOLD_MS) {
    // Fire-and-forget — never block the request for a TTL refresh
    db.update(sessionsTable)
      .set({ expire: new Date(Date.now() + SESSION_TTL) })
      .where(eq(sessionsTable.sid, sid))
      .catch(() => {});
  }

  return row.sess as unknown as SessionData;
}

export async function updateSession(sid: string, data: SessionData): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const candidate = authHeader.slice(7);
    // Only treat it as a session ID if it matches the 64-char hex format.
    // API key tokens (qak_...) are handled separately by apiKeyAuth middleware.
    return isValidSessionId(candidate) ? candidate : undefined;
  }
  const cookieVal = req.cookies?.[SESSION_COOKIE];
  return typeof cookieVal === "string" && isValidSessionId(cookieVal) ? cookieVal : undefined;
}

// ── MFA temporary sessions ────────────────────────────────────────────────────
// Stores pre-auth sessions for users with MFA enabled.
// After successful password verification the server issues a short-lived (5-min)
// mfaToken; the client must then supply a valid TOTP code to upgrade it into a
// full session.  These entries live only in memory and are never persisted.

interface MfaPendingEntry {
  sessionData: SessionData;
  expires: number;
}

const mfaPending = new Map<string, MfaPendingEntry>();

// Prune expired entries every 5 minutes to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of mfaPending) {
    if (entry.expires < now) mfaPending.delete(key);
  }
}, 5 * 60 * 1000);

export function createMfaToken(sessionData: SessionData): string {
  const token = crypto.randomBytes(32).toString("hex");
  mfaPending.set(token, { sessionData, expires: Date.now() + 5 * 60 * 1000 });
  return token;
}

export function consumeMfaToken(token: string): SessionData | null {
  const entry = mfaPending.get(token);
  if (!entry || entry.expires < Date.now()) {
    mfaPending.delete(token);
    return null;
  }
  mfaPending.delete(token);
  return entry.sessionData;
}
