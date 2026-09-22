import { lookup, resolveCname } from "dns/promises";
import tls from "tls";

export interface DastProbeIssue {
  title: string;
  description: string;
  evidence: string;
  severity: "critical" | "high" | "medium" | "low";
  possibleCause: string;
  suggestedFix: string;
  codeSnippet: null;
  filePath: null;
  lineNumber: null;
  detectionMethod: "dast-probe";
  confidence: "confirmed";
  owasp: string;
  effortLevel: "low" | "medium" | "high";
  effortNote: string;
}

const PROBE_PATHS = [
  "/.env", "/.git/config", "/admin", "/phpinfo.php", "/server-status",
  "/actuator/health", "/swagger.json", "/openapi.json",
];
const NEVER_FLAG_PATHS = new Set([
  "/.well-known/security.txt",
  "/.well-known/change-password",
  "/.well-known/openid-configuration",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/manifest.json",
]);
const REDIRECT_KEYS = ["redirect", "next", "return", "url", "goto"];

type SensitivePathClassification = {
  title: string;
  description: string;
  severity: DastProbeIssue["severity"];
  possibleCause: string;
  suggestedFix: string;
  owasp: string;
  effortLevel: DastProbeIssue["effortLevel"];
  effortNote: string;
} | null;

export function classifySensitivePathResponse(
  pathname: string,
  status: number,
  contentType: string | null,
): SensitivePathClassification {
  if (NEVER_FLAG_PATHS.has(pathname) || status === 403 || status === 404) return null;

  const evidence = `HTTP ${status}`;
  if (pathname === "/admin" && [301, 302, 308].includes(status)) {
    return {
      title: `Admin path redirects — panel may exist (${evidence})`,
      description: `The /admin path returned ${evidence}, indicating that the server redirects requests instead of directly granting access. This may be a login redirect to an administrative panel.`,
      severity: "low",
      possibleCause: "An administrative panel is reachable at the public origin but redirects unauthenticated requests.",
      suggestedFix: "Confirm the panel requires authentication and restrict administrative access where appropriate.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "low",
      effortNote: "Verify authentication and administrative access controls.",
    };
  }

  if (status !== 200) return null;

  if (pathname === "/.env") {
    return {
      title: `Sensitive file exposed at /.env (${evidence})`,
      description: `The /.env path returned ${evidence}, indicating that production configuration and secrets may be publicly accessible.`,
      severity: "critical",
      possibleCause: "Environment configuration is located inside the public web root or is not denied at the edge.",
      suggestedFix: "Remove the file from the public web root, deny the path, and rotate any disclosed secrets.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "low",
      effortNote: "Remove the exposed file, block the path, and rotate disclosed secrets.",
    };
  }

  if (pathname === "/.git/config") {
    return {
      title: `Git metadata exposed at /.git/config (${evidence})`,
      description: `The /.git/config path returned ${evidence}, indicating that repository metadata may be publicly accessible and usable to reconstruct source history.`,
      severity: "high",
      possibleCause: "The repository metadata directory is inside the public web root or is not denied at the edge.",
      suggestedFix: "Remove repository metadata from the deployed web root and deny /.git paths at the edge.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "low",
      effortNote: "Remove repository metadata and block the path.",
    };
  }

  if (pathname === "/admin") {
    return {
      title: `Admin panel accessible at /admin (${evidence})`,
      description: `The /admin path returned ${evidence}, indicating the admin interface is publicly accessible without redirecting to authentication.`,
      severity: "medium",
      possibleCause: "Administrative functionality is exposed at a public route without a confirmed authentication boundary.",
      suggestedFix: "Require authentication and authorization before serving the administrative interface.",
      owasp: "A01:2021-Broken Access Control",
      effortLevel: "medium",
      effortNote: "Enforce authentication and authorization at the administrative route.",
    };
  }

  const highPaths = new Set(["/phpinfo.php", "/server-status", "/actuator/health"]);
  if (highPaths.has(pathname)) {
    return {
      title: `Sensitive path exposed at ${pathname} (${evidence})`,
      description: `The ${pathname} path returned ${evidence}, indicating that a sensitive diagnostic, status, or administrative resource is publicly accessible.`,
      severity: "high",
      possibleCause: "A diagnostic or administrative resource is reachable from the public origin.",
      suggestedFix: "Remove the resource from the public web root or require authentication and deny the path at the edge.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "low",
      effortNote: "Restrict the exposed path and review any disclosed information.",
    };
  }

  if (pathname === "/swagger.json" || pathname === "/openapi.json") {
    return {
      title: `API documentation exposed at ${pathname} (${evidence})`,
      description: `The ${pathname} path returned ${evidence}, indicating that API documentation is publicly discoverable. This is informational unless the documentation reveals sensitive operations.`,
      severity: "low",
      possibleCause: "API documentation is served from a public route.",
      suggestedFix: "Decide whether public API documentation is intended; otherwise restrict it or remove sensitive details.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "low",
      effortNote: "Review whether the documentation should be public.",
    };
  }

  void contentType;
  return null;
}

function issue(data: Omit<DastProbeIssue, "codeSnippet" | "filePath" | "lineNumber" | "detectionMethod" | "confidence">): DastProbeIssue {
  return {
    ...data,
    codeSnippet: null,
    filePath: null,
    lineNumber: null,
    detectionMethod: "dast-probe",
    confidence: "confirmed",
  };
}

async function request(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": "QAAssistant/1.0 (security-scanner)", ...(init?.headers ?? {}) },
    });
  } catch {
    return null;
  }
}

async function tlsSummary(url: URL): Promise<DastProbeIssue | null> {
  if (url.protocol !== "https:") return null;
  return new Promise(resolve => {
    const socket = tls.connect({ host: url.hostname, port: 443, servername: url.hostname, rejectUnauthorized: false });
    const timer = setTimeout(() => { socket.destroy(); resolve(null); }, 5_000);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const certificate = socket.getPeerCertificate();
      socket.end();
      const validTo = certificate.valid_to ? Date.parse(certificate.valid_to) : NaN;
      const days = Number.isFinite(validTo) ? Math.ceil((validTo - Date.now()) / 86_400_000) : null;
      if (days !== null && days < 30) {
        resolve(issue({
          title: "TLS certificate expires soon",
          description: `The target certificate expires in ${Math.max(days, 0)} days.`,
          evidence: `certificate.valid_to=${certificate.valid_to}`,
          severity: days <= 7 ? "high" : "medium",
          possibleCause: "Certificate renewal is not scheduled early enough.",
          suggestedFix: "Renew the certificate before expiry and monitor certificate lifetime.",
          owasp: "A02:2021-Cryptographic Failures",
          effortLevel: "low",
          effortNote: "Renew the certificate and add expiry monitoring.",
        }));
      } else resolve(null);
    });
    socket.once("error", () => { clearTimeout(timer); resolve(null); });
  });
}

export async function runDastProbes(appUrl: string, html: string): Promise<DastProbeIssue[]> {
  const target = new URL(appUrl);
  const findings: DastProbeIssue[] = [];
  const params = new URLSearchParams(target.search);
  const links = [...html.matchAll(/(?:href|action)=["']([^"']+)["']/gi)]
    .map(match => { try { return new URL(match[1], appUrl); } catch { return null; } })
    .filter((url): url is URL => !!url && url.origin === target.origin);

  for (const key of params.keys()) {
    const probeUrl = new URL(target);
    probeUrl.searchParams.set(key, "<script>qaxss</script>");
    const response = await request(probeUrl.toString());
    const body = response ? await response.text().catch(() => "") : "";
    if (body.includes("qaxss")) {
      findings.push(issue({
        title: `Reflected XSS in ${key} parameter`,
        description: `The value supplied to ${key} was reflected without HTML encoding.`,
        evidence: `${probeUrl.search} contains unencoded qaxss`,
        severity: "high",
        possibleCause: "Request parameters are rendered into HTML without contextual output encoding.",
        suggestedFix: "Encode output for the HTML context and add a restrictive Content-Security-Policy.",
        owasp: "A03:2021-Injection",
        effortLevel: "medium",
        effortNote: "Encode the reflected parameter at the rendering boundary.",
      }));
    }
  }

  const redirectCandidates = [...params.keys(), ...links.flatMap(link => [...link.searchParams.keys()])]
    .filter(key => REDIRECT_KEYS.includes(key.toLowerCase()));
  for (const key of new Set(redirectCandidates)) {
    const probeUrl = new URL(target);
    probeUrl.searchParams.set(key, "https://evil-attacker-qat.example.com");
    const response = await request(probeUrl.toString());
    const location = response?.headers.get("location") ?? "";
    if (/^https:\/\/evil-attacker-qat\.example\.com/i.test(location)) {
      findings.push(issue({
        title: `Open redirect through ${key} parameter`,
        description: "The target redirects to an attacker-controlled external origin.",
        evidence: `Location: ${location}`,
        severity: "high",
        possibleCause: "Redirect destinations are accepted without an allowlist or same-origin check.",
        suggestedFix: "Allow only relative paths or an explicit allowlist of trusted origins.",
        owasp: "A01:2021-Broken Access Control",
        effortLevel: "low",
        effortNote: "Validate redirect destinations before responding.",
      }));
    }
  }

  const pathResults = (await Promise.all(PROBE_PATHS.map(async pathname => {
    const response = await request(new URL(pathname, target.origin).toString());
    return response
      ? { pathname, status: response.status, type: response.headers.get("content-type") }
      : null;
  }))).filter((result): result is { pathname: string; status: number; type: string | null } => result !== null);
  for (const result of pathResults) {
    const classification = classifySensitivePathResponse(result.pathname, result.status, result.type);
    if (!classification) continue;
    findings.push(issue({
      ...classification,
      evidence: `GET ${result.pathname} → HTTP ${result.status}`,
    }));
  }

  const corsOrigins = ["https://evil-attacker.example.com", "null"];
  for (const origin of corsOrigins) {
    const response = await request(appUrl, { headers: { Origin: origin } });
    const allowOrigin = response?.headers.get("access-control-allow-origin");
    const credentials = response?.headers.get("access-control-allow-credentials");
    if (allowOrigin === origin && credentials?.toLowerCase() === "true") {
      findings.push(issue({
        title: "CORS reflects an attacker origin with credentials",
        description: "The server allows an untrusted origin to make credentialed cross-origin requests.",
        evidence: `Origin: ${origin}; Access-Control-Allow-Origin: ${allowOrigin}; Access-Control-Allow-Credentials: true`,
        severity: "critical",
        possibleCause: "The CORS allowlist reflects arbitrary origins while allowing cookies or authorization credentials.",
        suggestedFix: "Use a strict origin allowlist and never combine wildcard/reflected origins with credentials.",
        owasp: "A05:2021-Security Misconfiguration",
        effortLevel: "medium",
        effortNote: "Replace reflective CORS logic with a fixed allowlist.",
      }));
    }
  }
  const preflight = await request(appUrl, {
    method: "OPTIONS",
    headers: { Origin: "https://evil-attacker.example.com", "Access-Control-Request-Method": "POST" },
  });
  if (preflight?.headers.get("access-control-allow-origin") === "https://evil-attacker.example.com"
    && preflight.headers.get("access-control-allow-credentials")?.toLowerCase() === "true") {
    findings.push(issue({
      title: "Credentialed CORS preflight accepts attacker origin",
      description: "The preflight response explicitly authorizes credentialed POST requests from an attacker origin.",
      evidence: "OPTIONS preflight reflected the attacker origin with credentials enabled.",
      severity: "critical",
      possibleCause: "The CORS preflight handler trusts arbitrary Origin values.",
      suggestedFix: "Reject untrusted origins before setting CORS response headers.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "medium",
      effortNote: "Harden the CORS preflight allowlist.",
    }));
  }

  const tlsFinding = await tlsSummary(target);
  if (tlsFinding) findings.push(tlsFinding);

  try {
    const addresses = await lookup(target.hostname);
    const cname = await resolveCname(target.hostname).catch(() => []);
    const thirdParty = /github\.io|herokuapp\.com|netlify\.app|vercel\.app|amazonaws\.com/i.test(cname.join(" "));
    if (thirdParty && addresses.address) {
      findings.push(issue({
        title: "Third-party CNAME requires takeover review",
        description: "The hostname points to a third-party hosting service and should be checked for an unclaimed resource.",
        evidence: `CNAME: ${cname.join(", ")}; address: ${addresses.address}`,
        severity: "medium",
        possibleCause: "A DNS alias may outlive the third-party resource it targets.",
        suggestedFix: "Claim the referenced resource or remove the stale DNS record.",
        owasp: "A05:2021-Security Misconfiguration",
        effortLevel: "low",
        effortNote: "Verify ownership of the third-party resource and DNS record.",
      }));
    }
  } catch { /* DNS metadata is non-fatal */ }

  return findings;
}