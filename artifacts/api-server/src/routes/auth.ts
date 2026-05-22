import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  createSession,
  deleteSession,
  getSession,
  getSessionId,
  hashPassword,
  updateSession,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import {
  logSecurityEvent,
  isLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
} from "../lib/security";

const router: IRouter = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * Password strength rules (NIST SP 800-63B aligned):
 *  • Minimum 12 characters
 *  • Maximum 128 characters (bcrypt input limit safety)
 *  • Must contain at least one uppercase letter, one lowercase letter,
 *    and one digit or special character.
 * Length alone is the strongest predictor of resistance to brute-force,
 * so we prioritise length over arbitrary complexity theatre.
 */
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]).{12,128}$/;

const RegisterBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80).trim(),
  email: z.string().email("Invalid email address").max(255).trim().toLowerCase(),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(
      PASSWORD_RE,
      "Password must contain uppercase, lowercase, and a number or special character",
    ),
});

const LoginBody = z.object({
  email: z.string().email().max(255).trim().toLowerCase(),
  password: z.string().min(1).max(128),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

// Stable dummy hash used for constant-time comparison when user is not found
const DUMMY_HASH = "$2b$12$WcMjfXAvYVQ5UKiJfHMmqODMLCqCBbHvhWG6Z3YhK1X2e/MfF0YVa";

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const { name, email, password } = parsed.data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const parts = name.trim().split(/\s+/);
  const firstName = parts[0] ?? name;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(usersTable)
    .values({ email, firstName, lastName, passwordHash })
    .returning();

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    },
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.status(201).json({ user: sessionData.user });
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const { email, password } = parsed.data;

  // Account-level lockout check — complements the IP-based rate limiter.
  // An attacker using multiple IPs can still be blocked per-account.
  if (!isLoginAllowed(email)) {
    logSecurityEvent("LOGIN_LOCKED", req, `account locked: ${email}`);
    res.status(429).json({ error: "Too many failed attempts for this account. Please wait 15 minutes." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  // Always run bcrypt to prevent timing-based user enumeration
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(password, hash);

  if (!user || !valid || !user.passwordHash) {
    recordLoginFailure(email);
    logSecurityEvent("AUTH_FAILED", req, `failed login for ${email}`);
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  // Clear failure counter so legitimate users are never locked out by past mistakes
  clearLoginFailures(email);
  logSecurityEvent("AUTH_SUCCESS", req, `user ${user.id}`);

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    },
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionData.user });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

// ── Profile update ─────────────────────────────────────────────────────────────

const ProfileBody = z.object({
  firstName: z.string().min(1, "First name is required").max(80).trim(),
  lastName: z.string().max(80).trim().nullable().optional(),
});

router.patch("/auth/profile", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const { firstName, lastName } = parsed.data;

  await db
    .update(usersTable)
    .set({ firstName, lastName: lastName ?? null })
    .where(eq(usersTable.id, req.user.id));

  const sid = getSessionId(req);
  if (sid) {
    const session = await getSession(sid);
    if (session) {
      session.user.firstName = firstName;
      session.user.lastName = lastName ?? null;
      await updateSession(sid, session);
    }
  }

  res.json({ success: true, firstName, lastName: lastName ?? null });
});

// ── Password change ────────────────────────────────────────────────────────────

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128)
    .regex(
      PASSWORD_RE,
      "Password must contain uppercase, lowercase, and a number or special character",
    ),
});

router.patch("/auth/password", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = PasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));

  if (!user?.passwordHash) {
    res.status(400).json({ error: "Cannot change password for this account" });
    return;
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    logSecurityEvent("AUTH_FAILED", req, `wrong current password for user ${req.user.id}`);
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash })
    .where(eq(usersTable.id, req.user.id));

  logSecurityEvent("AUTH_SUCCESS", req, `password changed for user ${req.user.id}`);
  res.json({ success: true });
});

export default router;
