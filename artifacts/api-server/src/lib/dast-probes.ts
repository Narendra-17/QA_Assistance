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
  "/.git/config", "/.env", "/api/v1/users", "/admin", "/phpinfo.php",
  "/server-status", "/actuator/health", "/swagger.json", "/openapi.json",
  "/.well-known/security.txt",
];
const REDIRECT_KEYS = ["redirect", "next", "return", "url", "goto"];

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
    return response && response.status !== 404 ? { pathname, status: response.status, type: response.headers.get("content-type") } : null;
  }))).filter((result): result is { pathname: string; status: number; type: string | null } => result !== null);
  for (const result of pathResults) {
    findings.push(issue({
      title: `Sensitive path exposed: ${result.pathname}`,
      description: `A commonly sensitive path returned HTTP ${result.status} instead of a not-found response.`,
      evidence: `${result.pathname} → ${result.status} (${result.type ?? "unknown content type"})`,
      severity: result.pathname === "/.env" || result.pathname === "/.git/config" ? "critical" : "medium",
      possibleCause: "Administrative, metadata, or configuration content is reachable from the public origin.",
      suggestedFix: "Remove the resource from the public web root and deny the path at the edge.",
      owasp: "A05:2021-Security Misconfiguration",
      effortLevel: "low",
      effortNote: "Restrict the exposed path and rotate any secrets if content was disclosed.",
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