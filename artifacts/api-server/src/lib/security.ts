/**
 * Security utility library
 * Centralises all security-critical logic so it can be tested and audited separately.
 */

import { logger } from "./logger";

// ─── SSRF protection ────────────────────────────────────────────────────────

/**
 * Ranges that must never be reached by the URL-analysis feature.
 * Covers loopback, link-local, private RFC-1918 space, and cloud metadata services.
 */
const BLOCKED_IP_PATTERNS = [
  // Loopback
  /^127\./,
  /^::1$/,
  /^localhost$/i,
  // Link-local / metadata services (AWS, GCP, Azure)
  /^169\.254\./,
  /^fe80:/i,
  // Private RFC-1918
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  // Unique local (IPv6 private)
  /^fc00:/i,
  /^fd/i,
  // Multicast
  /^224\./,
  /^ff/i,
  // Unspecified / broadcast
  /^0\.0\.0\.0$/,
  /^255\.255\.255\.255$/,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * Resolves a URL's hostname using the DNS built into Node and checks every
 * returned address against the block-list.  Throws if the URL is unsafe.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SecurityError("Invalid URL format.", "INVALID_URL");
  }

  // Only allow http and https
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SecurityError(
      `Protocol "${parsed.protocol}" is not allowed.`,
      "DISALLOWED_PROTOCOL",
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

  // Block by hostname first (fast path, no DNS needed)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SecurityError("Requests to internal services are not allowed.", "SSRF_BLOCKED");
  }
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new SecurityError("Requests to private/internal addresses are not allowed.", "SSRF_BLOCKED");
    }
  }

  // Resolve and re-check the actual IPs to defeat DNS rebinding
  try {
    const { Resolver } = await import("dns/promises");
    const resolver = new Resolver();
    // Try A records first, then AAAA
    let addresses: string[] = [];
    try { addresses = await resolver.resolve4(hostname); } catch { /* NXDOMAIN or no A record */ }
    try {
      const v6 = await resolver.resolve6(hostname);
      addresses = [...addresses, ...v6];
    } catch { /* ignore */ }

    if (addresses.length === 0) {
      throw new SecurityError("Could not resolve hostname.", "DNS_RESOLUTION_FAILED");
    }

    for (const addr of addresses) {
      for (const pattern of BLOCKED_IP_PATTERNS) {
        if (pattern.test(addr)) {
          throw new SecurityError(
            "Requests to private/internal addresses are not allowed.",
            "SSRF_BLOCKED",
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof SecurityError) throw err;
    // If DNS resolution itself fails entirely, block the request
    throw new SecurityError("Failed to verify the target host is safe.", "DNS_ERROR");
  }

  return parsed;
}

// ─── Input sanitization ─────────────────────────────────────────────────────

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Strips null bytes and non-printable control characters from a string.
 * Leaves newlines (\n), carriage returns (\r) and tabs (\t) intact.
 */
export function sanitizeString(value: string): string {
  return value.replace(CONTROL_CHAR_RE, "").trim();
}

/**
 * Enforces a maximum string length after sanitisation.
 * Throws if the value exceeds the limit.
 */
export function sanitizeAndLimit(value: string, maxLen: number, fieldName: string): string {
  const clean = sanitizeString(value);
  if (clean.length > maxLen) {
    throw new SecurityError(
      `"${fieldName}" must be at most ${maxLen} characters.`,
      "INPUT_TOO_LONG",
    );
  }
  return clean;
}

// ─── File validation ─────────────────────────────────────────────────────────

/** Magic bytes that indicate binary / executable content we should never analyse. */
const BINARY_MAGIC = [
  [0x7f, 0x45, 0x4c, 0x46],          // ELF
  [0x4d, 0x5a],                       // PE/DOS (MZ)
  [0xca, 0xfe, 0xba, 0xbe],          // Java class
  [0x25, 0x50, 0x44, 0x46],          // PDF
  [0x50, 0x4b, 0x03, 0x04],          // ZIP (including JAR/DOCX)
  [0x1f, 0x8b],                       // GZIP
  [0x42, 0x5a, 0x68],                // BZIP2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a],   // XZ
  [0x89, 0x50, 0x4e, 0x47],         // PNG
  [0xff, 0xd8, 0xff],                 // JPEG
  [0x47, 0x49, 0x46],                 // GIF
  [0x49, 0x49, 0x2a, 0x00],         // TIFF (little-endian)
  [0x4d, 0x4d, 0x00, 0x2a],         // TIFF (big-endian)
];

/**
 * Returns true if the buffer starts with any known binary magic bytes
 * or contains a high density of null bytes (≥5% of first 512 bytes).
 */
export function isBinaryBuffer(buf: Buffer): boolean {
  const probe = buf.subarray(0, 8);

  for (const magic of BINARY_MAGIC) {
    if (magic.every((byte, i) => probe[i] === byte)) return true;
  }

  // Null-byte density check
  const sample = buf.subarray(0, Math.min(512, buf.length));
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) nullCount++;
  }
  return nullCount / sample.length >= 0.05;
}

/**
 * Sanitises an uploaded filename:
 * - Strips path separators to prevent directory traversal
 * - Strips null bytes
 * - Limits length to 200 characters
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/\0/g, "")           // null bytes
    .replace(/[/\\]/g, "_")      // path separators
    .replace(/\.\./g, "_")       // parent directory references
    .slice(0, 200)
    .trim();
}

// ─── UUID validation ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ─── Session ID validation ────────────────────────────────────────────────────

/**
 * Sessions are generated with crypto.randomBytes(32).toString("hex") which
 * produces exactly 64 lowercase hex characters.  Validate this format before
 * any DB lookup to prevent wasted queries on junk input.
 */
const SESSION_ID_RE = /^[0-9a-f]{64}$/i;

export function isValidSessionId(sid: string): boolean {
  return typeof sid === "string" && SESSION_ID_RE.test(sid);
}

// ─── Error helpers ───────────────────────────────────────────────────────────

export class SecurityError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SecurityError";
    this.code = code;
  }
}

/**
 * Returns a safe error message that never leaks internal detail.
 * Internal errors are logged server-side and replaced with a generic message.
 */
export function safeErrorMessage(err: unknown, context: string): string {
  if (err instanceof SecurityError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ context, message: msg }, "Internal error");
  return "An unexpected error occurred. Please try again.";
}

// ─── Security audit logging ──────────────────────────────────────────────────

export type SecurityEvent =
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "AUTH_FAILED"
  | "AUTH_SUCCESS"
  | "LOGIN_LOCKED"
  | "SSRF_BLOCKED"
  | "INPUT_REJECTED"
  | "FILE_REJECTED"
  | "RATE_LIMITED"
  | "INVALID_PARAM";

// ─── Account-level brute-force protection ────────────────────────────────────
//
// Tracks failed login attempts per normalised email address in memory.
// Complements the IP-based rate limiter: even with multiple IPs an attacker
// cannot exceed MAX_ACCOUNT_FAILURES attempts against a single account within
// the lockout window.
//
// Trade-off: in-memory only, so resets on server restart.  For this
// application that is an acceptable trade-off; a production system with
// horizontal scaling would use Redis.

const MAX_ACCOUNT_FAILURES = 10;
const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_TRACKER_ENTRIES = 10_000;

interface FailureRecord {
  count: number;
  firstAttempt: number;
}

const loginFailureTracker = new Map<string, FailureRecord>();

/** Remove stale entries to prevent unbounded memory growth. */
function pruneLoginTracker(): void {
  if (loginFailureTracker.size < MAX_TRACKER_ENTRIES) return;
  const cutoff = Date.now() - ACCOUNT_LOCKOUT_WINDOW_MS;
  for (const [key, rec] of loginFailureTracker) {
    if (rec.firstAttempt < cutoff) loginFailureTracker.delete(key);
  }
}

/**
 * Returns true if a login attempt for this email is currently permitted.
 * Automatically expires the record once the lockout window passes.
 */
export function isLoginAllowed(email: string): boolean {
  pruneLoginTracker();
  const rec = loginFailureTracker.get(email);
  if (!rec) return true;
  if (Date.now() - rec.firstAttempt > ACCOUNT_LOCKOUT_WINDOW_MS) {
    loginFailureTracker.delete(email);
    return true;
  }
  return rec.count < MAX_ACCOUNT_FAILURES;
}

/**
 * Increments the failure counter for this email after a bad credential attempt.
 * Call ONLY after confirming that the credentials were wrong.
 */
export function recordLoginFailure(email: string): void {
  pruneLoginTracker();
  const rec = loginFailureTracker.get(email);
  if (!rec) {
    loginFailureTracker.set(email, { count: 1, firstAttempt: Date.now() });
  } else {
    rec.count++;
  }
}

/**
 * Clears the failure counter for this email after a successful login,
 * so a legitimate user is never locked out by their own past mistakes.
 */
export function clearLoginFailures(email: string): void {
  loginFailureTracker.delete(email);
}

export function logSecurityEvent(
  event: SecurityEvent,
  req: { ip?: string; method?: string; url?: string; user?: { id?: string } },
  detail?: string,
) {
  logger.warn(
    {
      securityEvent: event,
      ip: req.ip,
      method: req.method,
      path: req.url,
      userId: req.user?.id,
      detail,
    },
    `Security event: ${event}`,
  );
}
