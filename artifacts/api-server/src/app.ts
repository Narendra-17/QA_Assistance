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
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
  }),
);

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
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Enforce JSON content-type on mutation endpoints ───────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const ct = req.headers["content-type"] ?? "";
    // Allow multipart (file upload) and JSON; reject everything else
    if (ct && !ct.includes("application/json") && !ct.includes("multipart/form-data")) {
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

// ── Authentication ────────────────────────────────────────────────────────────
app.use(authMiddleware);

// ── Per-route rate limits ─────────────────────────────────────────────────────
app.use("/api/qa/runs", analysisLimiter);
app.use("/api/qa/sast", analysisLimiter);

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
