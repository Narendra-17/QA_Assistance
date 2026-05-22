import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { logSecurityEvent } from "./lib/security";

const app: Express = express();

app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    // Content Security Policy — tight but functional for an API
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Prevent MIME-type sniffing
    noSniff: true,
    // Disable X-Powered-By (hide Express fingerprint)
    hidePoweredBy: true,
    // Strict Transport Security — 1 year
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    // Prevent framing (clickjacking)
    frameguard: { action: "deny" },
    // Stop browsers sending referrer to cross-origin destinations
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Block old IE content-sniffing exploits
    ieNoOpen: true,
    // Disable XSS filter (modern browsers ignore it, and it can introduce bugs)
    xssFilter: false,
    // Restrict cross-origin window access (prevents cross-origin script attacks)
    crossOriginOpenerPolicy: { policy: "same-origin" },
    // CORP: same-origin for API — resources cannot be loaded by cross-origin pages
    // without CORS approval.  This is safe because the frontend uses fetch/XHR
    // (governed by CORS, not CORP) rather than no-cors subresource loads.
    crossOriginResourcePolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: false,
    originAgentCluster: false,
  }),
);

// ── Permissions-Policy — restrict powerful browser features ───────────────────
// Helmet 8 does not set this header by default; add it explicitly.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  next();
});

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow only requests that originate from the same Replit deployment domain.
// Covers the dev proxy (*.replit.dev / *.worf.replit.dev) and the production
// deployment domain (*.replit.app).  Falls back to rejecting unknown origins.
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost(:\d+)?|.*\.replit\.dev|.*\.replit\.app|.*\.worf\.replit\.dev)$/;

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Allow same-origin requests (no Origin header) and known Replit domains
      if (!origin || ALLOWED_ORIGIN_RE.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" is not allowed`));
      }
    },
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
// NOTE: express.urlencoded is intentionally NOT registered — the app is a
// JSON-only API and URL-encoded bodies would be unused attack surface.

// ── Enforce Content-Type on mutation endpoints ────────────────────────────────
// Reject any POST/PUT/PATCH that does not declare an acceptable content type.
// Checking `ct &&` (old approach) accidentally allowed requests with a missing
// Content-Type header to bypass this check — fixed by always evaluating.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const ct = req.headers["content-type"] ?? "";
    const isJson = ct.includes("application/json");
    const isMultipart = ct.includes("multipart/form-data");
    if (!isJson && !isMultipart) {
      return void res.status(415).json({ error: "Unsupported Media Type" });
    }
  }
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent("RATE_LIMITED", req, "global limiter");
    res.status(429).json({ error: "Too many requests. Please wait a moment." });
  },
});

// Tighter limit on AI analysis endpoints (expensive & abuse-prone)
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent("RATE_LIMITED", req, "analysis limiter");
    res.status(429).json({
      error: "Analysis rate limit reached. Up to 10 runs per minute are allowed.",
    });
  },
});

app.use(globalLimiter);

// ── Auth endpoint rate limiting — protect register/login from brute-force ─────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent("RATE_LIMITED", req, "auth limiter");
    res.status(429).json({ error: "Too many attempts. Please wait 15 minutes." });
  },
});
app.post("/api/auth/register", authLimiter);
app.post("/api/auth/login", authLimiter);

// ── Authentication ────────────────────────────────────────────────────────────
app.use(authMiddleware);

// ── Per-route rate limits — ONLY expensive AI write operations ────────────────
// IMPORTANT: Do NOT use app.use() here — that would rate-limit GET reads too,
// including the report page's 3-second polling loop which would hit 10/min
// in under 30 seconds.  Use app.post() to scope to write operations only.
//
//   POST /api/qa/runs              → URL scan (calls GPT-4o)
//   POST /api/qa/sast              → SAST scan (calls GPT-4o)
//   POST /api/qa/runs/:id/generate-fix → AI code fix (calls GPT-4o)
//
const fixLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent("RATE_LIMITED", req, "fix generator limiter");
    res.status(429).json({ error: "Fix generation rate limit reached. Up to 20 per minute." });
  },
});
app.post("/api/qa/runs", analysisLimiter);
app.post("/api/qa/sast", analysisLimiter);
app.post("/api/qa/runs/:id/generate-fix", fixLimiter);
app.patch("/api/auth/profile", authLimiter);
app.patch("/api/auth/password", authLimiter);

// ── Prevent API responses from being cached ───────────────────────────────────
// API responses may contain sensitive user data.  Ensure no intermediate proxy
// or browser cache stores them.  Applied only to /api/* to avoid interfering
// with static assets served by other middleware if any are added later.
// Vary: Cookie ensures that even a misconfigured shared cache never serves one
// user's session-scoped response to a different user.
app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Cookie");
  next();
});

// ── Public share-link rate limiter ────────────────────────────────────────────
// The /api/qa/share/:token endpoint is fully unauthenticated and therefore
// needs its own tighter limit so automated token-scanning is impractical.
// UUID tokens are 128-bit random so enumeration is computationally infeasible,
// but the limiter provides defence-in-depth at zero cost.
const shareLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: "Too many requests. Please wait a moment." });
  },
});
app.get("/api/qa/share/:token", shareLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
// Must be defined last — catches anything thrown by route handlers.
// Ensures no stack traces or raw error messages leak to the client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err }, "Unhandled error");

  // CORS errors — return 403 rather than 500
  if (msg.startsWith("CORS:")) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  res.status(500).json({ error: "Internal server error" });
});

export default app;
