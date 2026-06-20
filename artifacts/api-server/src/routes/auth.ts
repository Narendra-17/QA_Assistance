import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  createMfaToken,
  consumeMfaToken,
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
import { createRequire } from "node:module";
import { sendPasswordResetEmail } from "../lib/mailer";

// otplib and qrcode are CJS-only packages; load them via require() at runtime.
const _require = createRequire(import.meta.url);
interface OtplibAuthenticator {
  generateSecret(length?: number): string;
  keyuri(accountName: string, service: string, secret: string): string;
  verify(opts: { token: string; secret: string }): boolean;
}
const { authenticator } = _require("otplib") as { authenticator: OtplibAuthenticator };
const QRCode = _require("qrcode") as { toDataURL(text: string): Promise<string> };

const router: IRouter = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

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

  // If MFA is enabled, issue a short-lived MFA token instead of a full session
  if (user.mfaEnabled && user.mfaSecret) {
    const mfaToken = createMfaToken(sessionData);
    res.json({ requiresMfa: true, mfaToken });
    return;
  }

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

// ── Forgot password ────────────────────────────────────────────────────────────

const ForgotPasswordBody = z.object({
  email: z.string().email().max(255).trim().toLowerCase(),
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    // Always respond success to prevent email enumeration
    res.json({ success: true });
    return;
  }

  const { email } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  // Always respond success whether user exists or not
  if (!user) {
    res.json({ success: true });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.update(usersTable)
    .set({ passwordResetToken: token, passwordResetExpires: expires })
    .where(eq(usersTable.id, user.id));

  logSecurityEvent("AUTH_SUCCESS", req, `password reset requested for ${email}`);

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.get("host") ?? "localhost";
  const resetUrl = `${proto}://${host}/reset-password?token=${token}`;

  const emailSent = await sendPasswordResetEmail(email, resetUrl);

  if (!emailSent) {
    // In development, surface the reset URL so the feature can be tested
    if (process.env.NODE_ENV !== "production") {
      res.json({ success: true, _devResetUrl: resetUrl, _devNote: "Email not configured; use this URL to test password reset" });
      return;
    }
  }

  res.json({ success: true });
});

// ── Reset password ─────────────────────────────────────────────────────────────

const ResetPasswordBody = z.object({
  token: z.string().min(64).max(64),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128)
    .regex(PASSWORD_RE, "Password must contain uppercase, lowercase, and a number or special character"),
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const { token, newPassword } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordResetToken, token));

  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    logSecurityEvent("AUTH_FAILED", req, "invalid or expired password reset token");
    res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const newHash = await hashPassword(newPassword);

  await db.update(usersTable)
    .set({ passwordHash: newHash, passwordResetToken: null, passwordResetExpires: null })
    .where(eq(usersTable.id, user.id));

  // Invalidate all existing sessions for this user by rotating their session data
  logSecurityEvent("AUTH_SUCCESS", req, `password reset completed for user ${user.id}`);
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

// ── MFA: status ───────────────────────────────────────────────────────────────

router.get("/auth/mfa/status", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [user] = await db.select({ mfaEnabled: usersTable.mfaEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));

  res.json({ mfaEnabled: user?.mfaEnabled ?? false });
});

// ── MFA: setup — generate secret + QR code ───────────────────────────────────

router.post("/auth/mfa/setup", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.mfaEnabled) {
    res.status(400).json({ error: "MFA is already enabled" });
    return;
  }

  const secret = authenticator.generateSecret(20);
  const otpAuthUrl = authenticator.keyuri(user.email ?? "user", "QA Assistant", secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

  // Persist the pending secret (not yet active — mfaEnabled stays false)
  await db.update(usersTable)
    .set({ mfaSecret: secret })
    .where(eq(usersTable.id, user.id));

  res.json({ secret, qrCodeDataUrl });
});

// ── MFA: enable — verify TOTP code and activate ───────────────────────────────

router.post("/auth/mfa/enable", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = z.object({ code: z.string().min(6).max(8) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Verification code is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));

  if (!user?.mfaSecret) {
    res.status(400).json({ error: "MFA setup not initiated — call /auth/mfa/setup first" });
    return;
  }

  const isValid = authenticator.verify({ token: parsed.data.code, secret: user.mfaSecret });
  if (!isValid) {
    logSecurityEvent("AUTH_FAILED", req, `invalid MFA setup code for user ${user.id}`);
    res.status(400).json({ error: "Invalid verification code. Please check your authenticator app and try again." });
    return;
  }

  // Generate 8 one-time backup codes (8 chars each, uppercase hex)
  const backupCodes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase(),
  );

  await db.update(usersTable)
    .set({ mfaEnabled: true, mfaBackupCodes: JSON.stringify(backupCodes) })
    .where(eq(usersTable.id, user.id));

  logSecurityEvent("AUTH_SUCCESS", req, `MFA enabled for user ${user.id}`);
  res.json({ success: true, backupCodes });
});

// ── MFA: disable — requires current password ──────────────────────────────────

router.post("/auth/mfa/disable", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = z.object({ password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Current password is required to disable MFA" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));

  if (!user?.passwordHash) {
    res.status(400).json({ error: "Cannot disable MFA for this account" });
    return;
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    logSecurityEvent("AUTH_FAILED", req, `wrong password on MFA disable attempt for user ${user.id}`);
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  await db.update(usersTable)
    .set({ mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null })
    .where(eq(usersTable.id, user.id));

  logSecurityEvent("AUTH_SUCCESS", req, `MFA disabled for user ${user.id}`);
  res.json({ success: true });
});

// ── MFA: verify during login ──────────────────────────────────────────────────

router.post("/auth/mfa/verify", async (req: Request, res: Response) => {
  const parsed = z.object({
    mfaToken: z.string().min(1).max(128),
    code: z.string().min(1).max(16),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "MFA token and code are required" });
    return;
  }

  const { mfaToken, code } = parsed.data;

  const sessionData = consumeMfaToken(mfaToken);
  if (!sessionData) {
    res.status(401).json({ error: "MFA session expired. Please log in again." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, sessionData.user.id));

  if (!user?.mfaSecret || !user.mfaEnabled) {
    res.status(400).json({ error: "MFA is not configured for this account" });
    return;
  }

  // Verify TOTP code
  const isValidTotp = authenticator.verify({ token: code, secret: user.mfaSecret });

  if (!isValidTotp) {
    // Check backup codes
    const backupCodes: string[] = user.mfaBackupCodes ? (JSON.parse(user.mfaBackupCodes) as string[]) : [];
    const normalizedCode = code.toUpperCase().replace(/[^A-F0-9]/g, "");
    const backupIndex = backupCodes.indexOf(normalizedCode);

    if (backupIndex === -1) {
      logSecurityEvent("AUTH_FAILED", req, `invalid MFA code for user ${user.id}`);
      res.status(401).json({ error: "Invalid authentication code" });
      return;
    }

    // Consume the backup code — each code is one-time use
    backupCodes.splice(backupIndex, 1);
    await db.update(usersTable)
      .set({ mfaBackupCodes: JSON.stringify(backupCodes) })
      .where(eq(usersTable.id, user.id));
  }

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  logSecurityEvent("AUTH_SUCCESS", req, `MFA verified, session created for user ${user.id}`);
  res.json({ user: sessionData.user });
});

export default router;
