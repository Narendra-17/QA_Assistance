/**
 * Deterministic secrets detector.
 * Runs BEFORE the AI prompt so critical credential leaks are never missed.
 *
 * Design principles:
 *  • High-precision regex patterns — prefer false negatives over noisy false positives.
 *  • Shannon entropy analysis for generic high-entropy strings in assignment contexts.
 *  • Redacts actual credential values before returning — we never log or store secrets.
 *  • Results carry file/line context so the developer knows exactly where to fix.
 */

import path from "path";

// ─── Pattern definitions ──────────────────────────────────────────────────────

interface SecretPattern {
  id: string;
  label: string;           // Human-readable name
  regex: RegExp;
  severity: "critical" | "high";
  description: string;
  fix: string;
  /** Which capture group index (1-based) holds the actual secret. 0 = full match. */
  valueGroup?: number;
}

const PATTERNS: SecretPattern[] = [
  // ── Cloud providers ───────────────────────────────────────────────────────
  {
    id: "aws-access-key",
    label: "AWS Access Key ID",
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    severity: "critical",
    description: "An AWS Access Key ID was found in source code. If committed, attackers can use it to access your AWS account.",
    fix: "Remove immediately. Rotate the key in the AWS IAM console. Store it in environment variables or AWS Secrets Manager, never in code.",
    valueGroup: 1,
  },
  {
    id: "aws-secret-key",
    label: "AWS Secret Access Key",
    regex: /(?:aws_secret(?:_access)?_key|AWS_SECRET(?:_ACCESS)?_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+]{40})["']?/gi,
    severity: "critical",
    description: "An AWS Secret Access Key was found in source code or configuration.",
    fix: "Remove immediately. Rotate in the AWS IAM console. Use environment variables or AWS Secrets Manager.",
    valueGroup: 1,
  },
  {
    id: "gcp-api-key",
    label: "Google Cloud API Key",
    regex: /\b(AIza[0-9A-Za-z_\-]{35})\b/g,
    severity: "critical",
    description: "A Google Cloud / Firebase API key was found in source code.",
    fix: "Rotate the key in the Google Cloud Console. Restrict the key to specific APIs and referrers. Store it server-side.",
    valueGroup: 1,
  },
  {
    id: "gcp-oauth-client",
    label: "Google OAuth Client ID",
    regex: /\b([0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com)\b/g,
    severity: "high",
    description: "A Google OAuth Client ID was found. While not itself a secret, it can be used for OAuth flow abuse.",
    fix: "Restrict authorized origins and redirect URIs in the Google Cloud Console.",
    valueGroup: 1,
  },
  {
    id: "azure-connection-string",
    label: "Azure Connection String",
    regex: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=([A-Za-z0-9+/=]{88});/g,
    severity: "critical",
    description: "An Azure Storage account connection string with key was found.",
    fix: "Remove immediately. Rotate the storage account key in Azure Portal. Use Managed Identity or Azure Key Vault.",
    valueGroup: 1,
  },

  // ── Version control platforms ─────────────────────────────────────────────
  {
    id: "github-pat",
    label: "GitHub Personal Access Token",
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    severity: "critical",
    description: "A GitHub Personal Access Token (PAT) was found. This grants repository and potentially account access.",
    fix: "Revoke the token immediately at github.com/settings/tokens. Use GitHub Actions secrets for CI/CD.",
    valueGroup: 1,
  },
  {
    id: "gitlab-pat",
    label: "GitLab Personal Access Token",
    regex: /\b(glpat-[0-9A-Za-z_\-]{20,})\b/g,
    severity: "critical",
    description: "A GitLab Personal Access Token was found in source code.",
    fix: "Revoke at gitlab.com/-/profile/personal_access_tokens. Use CI/CD variables for pipeline secrets.",
    valueGroup: 1,
  },

  // ── Payment providers ─────────────────────────────────────────────────────
  {
    id: "stripe-secret-key",
    label: "Stripe Secret API Key",
    regex: /\b(sk_live_[0-9A-Za-z]{24,})\b/g,
    severity: "critical",
    description: "A Stripe live secret key was found. This allows full API access including charges and refunds.",
    fix: "Roll the key immediately in the Stripe Dashboard. Use environment variables server-side only.",
    valueGroup: 1,
  },
  {
    id: "stripe-restricted-key",
    label: "Stripe Restricted Key (live)",
    regex: /\b(rk_live_[0-9A-Za-z]{24,})\b/g,
    severity: "high",
    description: "A Stripe live restricted key was found in source code.",
    fix: "Roll the key in the Stripe Dashboard. Store in server-side environment variables.",
    valueGroup: 1,
  },

  // ── Communication platforms ───────────────────────────────────────────────
  {
    id: "sendgrid-key",
    label: "SendGrid API Key",
    regex: /\b(SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43})\b/g,
    severity: "critical",
    description: "A SendGrid API key was found. This allows sending emails from your account.",
    fix: "Revoke at app.sendgrid.com/settings/api_keys. Store in environment variables.",
    valueGroup: 1,
  },
  {
    id: "slack-token",
    label: "Slack Token",
    regex: /\b(xox[baprs]-[0-9A-Za-z\-]{10,})\b/g,
    severity: "critical",
    description: "A Slack API token was found. This can expose workspace messages and user data.",
    fix: "Revoke at api.slack.com/apps. Use environment variables or Slack's secret management.",
    valueGroup: 1,
  },
  {
    id: "twilio-sid",
    label: "Twilio Account SID",
    regex: /\b(AC[a-zA-Z0-9]{32})\b/g,
    severity: "high",
    description: "A Twilio Account SID was found. Combined with an auth token this gives full API access.",
    fix: "Store in environment variables. Ensure auth token is also not exposed.",
    valueGroup: 1,
  },
  {
    id: "twilio-auth-token",
    label: "Twilio Auth Token",
    regex: /(?:twilio_auth_token|TWILIO_AUTH_TOKEN|authToken)\s*[=:]\s*["']?([a-f0-9]{32})["']?/gi,
    severity: "critical",
    description: "A Twilio Auth Token was found. This gives full access to your Twilio account.",
    fix: "Roll immediately in the Twilio Console. Store in environment variables only.",
    valueGroup: 1,
  },

  // ── Private keys / certificates ───────────────────────────────────────────
  {
    id: "private-key",
    label: "Private Key (PEM)",
    regex: /-{3,}BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-{3,}/g,
    severity: "critical",
    description: "A PEM-encoded private key was found in source code. This could be an SSH key, TLS certificate, or signing key.",
    fix: "Remove immediately. Revoke/rotate the key. Use a secrets manager (HashiCorp Vault, AWS Secrets Manager) for key storage.",
  },
  {
    id: "jwt-secret",
    label: "JWT / Bearer Token",
    regex: /\b(eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})\b/g,
    severity: "high",
    description: "A JSON Web Token (JWT) was found hardcoded in source code. This may be a long-lived token or signing example.",
    fix: "Do not hardcode JWTs. Validate tokens at runtime. Ensure JWTs are short-lived and properly signed.",
    valueGroup: 1,
  },

  // ── Database connection strings ───────────────────────────────────────────
  {
    id: "database-url",
    label: "Database URL with Credentials",
    regex: /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^:@\s"']+:[^@\s"']{3,}@[^\s"']+)/gi,
    severity: "critical",
    description: "A database connection URL with embedded credentials was found. This exposes the database server, username, and password.",
    fix: "Move to DATABASE_URL environment variable. Never commit connection strings with passwords.",
    valueGroup: 1,
  },

  // ── Generic credential assignments ───────────────────────────────────────
  {
    id: "hardcoded-password",
    label: "Hardcoded Password or Secret",
    regex: /(?:^|[^a-zA-Z])(?:password|passwd|pwd|secret|api_key|apiKey|auth_token|authToken|access_token|accessToken|client_secret|clientSecret)\s*[:=]\s*["']([^"'\s]{8,})["']/gim,
    severity: "high",
    description: "A hardcoded credential or secret value was found in an assignment statement.",
    fix: "Replace with an environment variable reference. Use a .env file (excluded from git) or a secrets manager.",
    valueGroup: 1,
  },

  // ── Miscellaneous platform keys ───────────────────────────────────────────
  {
    id: "npmrc-authtoken",
    label: "NPM Auth Token in .npmrc",
    regex: /_authToken\s*=\s*([A-Za-z0-9_\-]{36,})/g,
    severity: "critical",
    description: "An NPM authentication token was found in a .npmrc file. This allows publishing packages to your npm account.",
    fix: "Remove the token. Use `npm login` which stores tokens in the user-level ~/.npmrc. Never commit .npmrc with auth tokens.",
    valueGroup: 1,
  },
  {
    id: "heroku-api-key",
    label: "Heroku API Key",
    regex: /\b([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\b(?=.*heroku)/gi,
    severity: "high",
    description: "A Heroku API key (UUID format) was found near a Heroku reference.",
    fix: "Regenerate your Heroku API key at dashboard.heroku.com/account. Store in environment variables.",
    valueGroup: 1,
  },
  {
    id: "mailchimp-key",
    label: "Mailchimp API Key",
    regex: /\b([A-Za-z0-9]{32}-us[0-9]{1,2})\b/g,
    severity: "high",
    description: "A Mailchimp API key was found. This allows access to mailing lists and audience data.",
    fix: "Revoke at account.mailchimp.com/account/api. Store in environment variables.",
    valueGroup: 1,
  },
  {
    id: "shopify-secret",
    label: "Shopify API Secret",
    regex: /(?:shopify_api_secret|SHOPIFY_API_SECRET)\s*[=:]\s*["']?([a-f0-9]{32})["']?/gi,
    severity: "critical",
    description: "A Shopify API secret was found. This is used to sign webhook payloads and validate OAuth flows.",
    fix: "Rotate in the Shopify Partner Dashboard. Store in server-side environment variables.",
    valueGroup: 1,
  },
];

// ─── Shannon entropy analysis ─────────────────────────────────────────────────

const ENTROPY_MIN_LENGTH = 20;
const ENTROPY_HIGH_THRESHOLD = 4.5;   // bits per character — high entropy typical of secrets
const ENTROPY_CHARSET_RE = /^[A-Za-z0-9+/=_\-]+$/;  // base64-like or hex-like characters

/** Compute Shannon entropy (bits/char) of a string. */
function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const c of s) freq[c] = (freq[c] ?? 0) + 1;
  const len = s.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ─── Entropy false-positive allowlist ────────────────────────────────────────

/** UUID v4 pattern — high entropy but not a secret */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Lock-file basenames — they legitimately contain many high-entropy hashes */
const LOCKFILE_BASENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pnpm-lock.yml",
  "cargo.lock", "gemfile.lock", "poetry.lock", "composer.lock", "go.sum",
  "pipfile.lock", "shrinkwrap.json",
]);

/** Hex hash pattern (SHA-1, SHA-256, MD5 digests) — not secrets, just checksums */
const HEX_HASH_RE = /^[0-9a-f]{32,64}$/i;

/** Base64-encoded short public data — too short to be a real secret */
const SHORT_BASE64_NOISE_RE = /^[A-Za-z0-9+/=]{20,32}$/;

/** Test/example placeholder values that are never real secrets */
const PLACEHOLDER_RE = /^(example|placeholder|your[-_]?(?:key|token|secret|password)|changeme|replace[-_]?me|xxxxxxxx|0{8,}|1{8,}|a{8,}|test[-_]?(?:key|secret)|fake[-_]?(?:key|secret)|demo[-_]?(?:key|secret))/i;

/**
 * Detect high-entropy strings assigned to "key-like" variable names.
 * This catches secrets not covered by specific patterns.
 */
function detectHighEntropySecrets(content: string, filename: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  // Skip lock files — they contain thousands of high-entropy hashes
  const base = filename.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (LOCKFILE_BASENAMES.has(base)) return [];

  // Skip test fixtures and mock data
  if (/(?:__fixtures__|__mocks__|\.test\.|\.spec\.|\/test\/|\/tests\/|\/spec\/)/.test(filename)) return [];

  const lines = content.split("\n");

  const KEY_LIKE_VAR = /(?:key|token|secret|password|passwd|pwd|api_?key|auth|credential|cred|private|passphrase|cert)/i;
  const ASSIGNMENT_RE = /(?:[\w_]+)\s*[:=]\s*["']([A-Za-z0-9+/=_\-]{20,})["']/g;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!KEY_LIKE_VAR.test(line)) continue;

    // Skip commented-out lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    let match: RegExpExecArray | null;
    ASSIGNMENT_RE.lastIndex = 0;
    while ((match = ASSIGNMENT_RE.exec(line)) !== null) {
      const value = match[1];

      // Skip known non-secret patterns
      if (!ENTROPY_CHARSET_RE.test(value)) continue;
      if (value.length < ENTROPY_MIN_LENGTH) continue;
      if (UUID_RE.test(value)) continue;
      if (HEX_HASH_RE.test(value)) continue;
      if (PLACEHOLDER_RE.test(value)) continue;
      // Very short base64-looking strings (20-32 chars) are often hashed IDs, not secrets
      if (SHORT_BASE64_NOISE_RE.test(value) && value.length < 28) continue;

      const entropy = shannonEntropy(value);
      if (entropy >= ENTROPY_HIGH_THRESHOLD) {
        findings.push({
          id: "high-entropy-secret",
          label: "High-Entropy Secret Value",
          severity: "high",
          filePath: filename,
          lineNumber: lineIdx + 1,
          redactedValue: `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`,
          description: `A high-entropy string (Shannon entropy: ${entropy.toFixed(2)} bits/char) assigned to a credential-like variable name was found. This is a strong indicator of a hardcoded secret.`,
          fix: "Replace with an environment variable reference. Use a .env file (never committed) or a secrets manager.",
        });
      }
    }
  }

  return findings;
}

// ─── Public types & function ──────────────────────────────────────────────────

export interface SecretFinding {
  id: string;
  label: string;
  severity: "critical" | "high";
  filePath: string;
  lineNumber?: number;
  /** Partially redacted value — safe to log/display */
  redactedValue?: string;
  description: string;
  fix: string;
}

/**
 * Scan an array of source files for secrets.
 * Returns findings with severity, location, and partially-redacted values.
 * The actual secret value is NEVER returned — only a redacted preview.
 */
export function detectSecrets(
  files: Array<{ name: string; content: string }>,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  // Files that are inherently expected to contain references — skip
  const SKIP_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".example"]);

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    // Skip documentation and example files (high false-positive rate)
    if (SKIP_EXTENSIONS.has(ext) && !file.name.includes(".env")) continue;
    // Skip test fixtures that are clearly fake
    if (file.name.includes("__fixtures__") || file.name.includes("__mocks__")) continue;

    const lines = file.content.split("\n");

    // ── Pattern-based detection ─────────────────────────────────────────────
    for (const pattern of PATTERNS) {
      // Build a deduplicated flag string: always include g+m, preserve i if present
      const baseFlags = pattern.regex.flags.replace(/[gm]/g, "");
      const flags = `${baseFlags}gm`.split("").filter((c, i, a) => a.indexOf(c) === i).join("");
      const re = new RegExp(pattern.regex.source, flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        // Find the line number
        const linesBefore = file.content.slice(0, match.index).split("\n");
        const lineNumber = linesBefore.length;

        // Redact the value — only show first/last 4 chars
        const rawValue = pattern.valueGroup ? (match[pattern.valueGroup] ?? match[0]) : match[0];
        const redactedValue = rawValue.length > 8
          ? `${rawValue.slice(0, 4)}${"*".repeat(Math.min(rawValue.length - 8, 24))}${rawValue.slice(-4)}`
          : "****";

        // Deduplicate: same pattern + same file + same line
        const dedupeKey = `${pattern.id}:${file.name}:${lineNumber}`;
        if (findings.some(f => `${f.id}:${f.filePath}:${f.lineNumber}` === dedupeKey)) continue;

        findings.push({
          id: pattern.id,
          label: pattern.label,
          severity: pattern.severity,
          filePath: file.name,
          lineNumber,
          redactedValue,
          description: pattern.description,
          fix: pattern.fix,
        });

        // Context line for display
        const contextLine = lines[lineNumber - 1]?.trim().slice(0, 120);
        void contextLine; // included in filePath/lineNumber display
      }
    }

    // ── Entropy-based detection ─────────────────────────────────────────────
    const entropyFindings = detectHighEntropySecrets(file.content, file.name);
    findings.push(...entropyFindings);
  }

  // Sort: critical first, then by file name, then by line number
  return findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return (a.lineNumber ?? 0) - (b.lineNumber ?? 0);
  });
}

/**
 * Convert secrets findings to report issue format.
 * Used to prepend deterministic findings before the AI-generated issues.
 */
export function secretsToIssues(findings: SecretFinding[]): Array<{
  title: string;
  description: string;
  severity: string;
  possibleCause: string;
  suggestedFix: string;
  codeSnippet: string | null;
  filePath: string | null;
  lineNumber: number | null;
  detectionMethod: string;
}> {
  return findings.map(f => ({
    title: `Hardcoded Secret Detected: ${f.label}`,
    description: f.description + (f.redactedValue ? ` (Detected value: \`${f.redactedValue}\`)` : ""),
    severity: f.severity,
    possibleCause: "Credentials were committed to source code instead of being loaded from environment variables or a secrets manager. This is a systemic issue — once a secret is in git history, it is considered permanently compromised even after deletion.",
    suggestedFix: f.fix,
    codeSnippet: null,
    filePath: f.filePath,
    lineNumber: f.lineNumber ?? null,
    detectionMethod: "deterministic",
  }));
}
