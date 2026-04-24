/**
 * Software Composition Analysis (SCA) scanner.
 * Parses dependency manifests and queries the OSV.dev vulnerability database.
 *
 * Design:
 *  • Uses the OSV.dev batch query API (free, no auth, open-source data)
 *  • Supports npm (package.json), Python (requirements.txt), Go (go.mod),
 *    Ruby (Gemfile.lock), Rust (Cargo.toml), Java (pom.xml), PHP (composer.json)
 *  • All HTTP calls are bounded by a 20-second timeout
 *  • Never stores or logs dependency versions to avoid leaking project internals
 */

import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DependencyEntry {
  name: string;
  version: string;
  ecosystem: string;
}

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    ranges?: Array<{
      type: string;
      events?: Array<{ introduced?: string; fixed?: string }>;
    }>;
    versions?: string[];
  }>;
  references?: Array<{ url: string; type: string }>;
  database_specific?: { severity?: string };
}

interface OsvQueryResult {
  vulns?: OsvVulnerability[];
}

export interface VulnerableDependency {
  name: string;
  version: string;
  ecosystem: string;
  severity: "critical" | "high" | "medium" | "low";
  vulnerabilities: Array<{
    id: string;
    summary: string;
    fixedIn?: string;
    cvssScore?: string;
    referenceUrl?: string;
  }>;
}

// ─── Ecosystem parsers ────────────────────────────────────────────────────────

/** Strip pre-release and build metadata — OSV needs clean semver */
function cleanVersion(v: string): string {
  return v.replace(/^\^|~|>=?|<=?|\s/g, "").split("-")[0].split("+")[0];
}

function parseNpmPackageJson(content: string): DependencyEntry[] {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps: DependencyEntry[] = [];
    for (const section of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
      if (!section) continue;
      for (const [name, rawVersion] of Object.entries(section)) {
        const version = cleanVersion(String(rawVersion));
        if (version && version !== "*" && version !== "latest") {
          deps.push({ name, version, ecosystem: "npm" });
        }
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function parsePythonRequirements(content: string): DependencyEntry[] {
  const deps: DependencyEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    // name==1.2.3 or name>=1.0.0
    const match = line.match(/^([A-Za-z0-9_\-\.]+)\s*(?:==|===|~=|>=|<=|!=)\s*([0-9][^\s,;]+)/);
    if (match) {
      deps.push({ name: match[1], version: cleanVersion(match[2]), ecosystem: "PyPI" });
    }
  }
  return deps;
}

function parseGoMod(content: string): DependencyEntry[] {
  const deps: DependencyEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    // Match "require module/path v1.2.3" or lines inside require block
    const match = line.match(/^([A-Za-z0-9_\-\.\/]+)\s+v([0-9][^\s]+)/);
    if (match && !line.startsWith("//") && !line.startsWith("module") && !line.startsWith("go ")) {
      deps.push({ name: match[1], version: match[2], ecosystem: "Go" });
    }
  }
  return deps;
}

function parseGemfileLock(content: string): DependencyEntry[] {
  const deps: DependencyEntry[] = [];
  let inSpecs = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine;
    if (line.includes("    specs:")) { inSpecs = true; continue; }
    if (inSpecs && /^[A-Z]/.test(line)) { inSpecs = false; }
    if (inSpecs) {
      const match = line.match(/^    {4}([A-Za-z0-9_\-]+)\s+\(([^)]+)\)/);
      if (match) deps.push({ name: match[1], version: cleanVersion(match[2]), ecosystem: "RubyGems" });
    }
  }
  return deps;
}

function parseCargoToml(content: string): DependencyEntry[] {
  const deps: DependencyEntry[] = [];
  // [dependencies] section
  const depSection = content.match(/\[(?:dependencies|dev-dependencies|build-dependencies)\]([\s\S]*?)(?=\[|$)/g) ?? [];
  for (const section of depSection) {
    for (const rawLine of section.split("\n")) {
      const line = rawLine.trim();
      // crate-name = "1.2.3" or crate-name = { version = "1.2.3" }
      const simple = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*"([0-9^~>=][^"]+)"/);
      const complex = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
      const m = simple ?? complex;
      if (m) deps.push({ name: m[1], version: cleanVersion(m[2]), ecosystem: "crates.io" });
    }
  }
  return deps;
}

function parseComposerJson(content: string): DependencyEntry[] {
  try {
    const pkg = JSON.parse(content) as {
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
    };
    const deps: DependencyEntry[] = [];
    for (const section of [pkg.require, pkg["require-dev"]]) {
      if (!section) continue;
      for (const [name, rawVersion] of Object.entries(section)) {
        if (name === "php") continue;
        const version = cleanVersion(String(rawVersion));
        if (version) deps.push({ name, version, ecosystem: "Packagist" });
      }
    }
    return deps;
  } catch {
    return [];
  }
}

function parsePomXml(content: string): DependencyEntry[] {
  const deps: DependencyEntry[] = [];
  const depBlocks = [...content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  for (const block of depBlocks) {
    const groupId = block[1].match(/<groupId>([^<]+)<\/groupId>/)?.[1];
    const artifactId = block[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
    const version = block[1].match(/<version>([^<${}]+)<\/version>/)?.[1];
    if (groupId && artifactId && version && !version.startsWith("${")) {
      deps.push({
        name: `${groupId}:${artifactId}`,
        version: cleanVersion(version),
        ecosystem: "Maven",
      });
    }
  }
  return deps;
}

// ─── Dependency extraction from files ────────────────────────────────────────

export function extractDependencies(
  files: Array<{ name: string; content: string }>,
): DependencyEntry[] {
  const all: DependencyEntry[] = [];

  for (const file of files) {
    const base = file.name.toLowerCase().replace(/.*[/\\]/, "");
    let parsed: DependencyEntry[] = [];

    if (base === "package.json") parsed = parseNpmPackageJson(file.content);
    else if (base === "requirements.txt" || base === "requirements-dev.txt") parsed = parsePythonRequirements(file.content);
    else if (base === "go.mod") parsed = parseGoMod(file.content);
    else if (base === "gemfile.lock") parsed = parseGemfileLock(file.content);
    else if (base === "cargo.toml") parsed = parseCargoToml(file.content);
    else if (base === "composer.json") parsed = parseComposerJson(file.content);
    else if (base === "pom.xml") parsed = parsePomXml(file.content);

    all.push(...parsed);
  }

  // Deduplicate by name+ecosystem
  const seen = new Set<string>();
  return all.filter(d => {
    const key = `${d.ecosystem}:${d.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── OSV.dev batch query ──────────────────────────────────────────────────────

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_BATCH_SIZE = 1000; // OSV limit per request
const REQUEST_TIMEOUT_MS = 20_000;

function mapOsvSeverity(vuln: OsvVulnerability): "critical" | "high" | "medium" | "low" {
  // Try database_specific.severity first
  const ds = vuln.database_specific?.severity?.toLowerCase();
  if (ds === "critical") return "critical";
  if (ds === "high") return "high";
  if (ds === "moderate" || ds === "medium") return "medium";
  if (ds === "low") return "low";

  // Try CVSS score
  for (const sev of vuln.severity ?? []) {
    if (sev.type === "CVSS_V3" || sev.type === "CVSS_V2") {
      const score = parseFloat(sev.score);
      if (score >= 9.0) return "critical";
      if (score >= 7.0) return "high";
      if (score >= 4.0) return "medium";
      return "low";
    }
  }

  return "medium"; // default if unknown
}

function getFixedVersion(vuln: OsvVulnerability): string | undefined {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) return event.fixed;
      }
    }
    if (affected.versions?.length) {
      // Return the last version in the list as a potential safe version hint
      return affected.versions[affected.versions.length - 1];
    }
  }
  return undefined;
}

async function queryOsvBatch(deps: DependencyEntry[]): Promise<OsvQueryResult[]> {
  const queries = deps.map(d => ({
    version: d.version,
    package: { name: d.name, ecosystem: d.ecosystem },
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(OSV_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "QAAssistant/1.0 SCA-Scanner" },
      body: JSON.stringify({ queries }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "OSV.dev API returned non-200");
      return [];
    }

    const data = (await resp.json()) as { results: OsvQueryResult[] };
    return data.results ?? [];
  } catch (err) {
    logger.warn({ err }, "OSV.dev query failed");
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public function ──────────────────────────────────────────────────────────

/**
 * Scan uploaded files for vulnerable dependencies.
 * Parses manifests, queries OSV.dev, and returns actionable findings.
 */
export async function scanDependencies(
  files: Array<{ name: string; content: string }>,
): Promise<VulnerableDependency[]> {
  const deps = extractDependencies(files);
  if (deps.length === 0) return [];

  const vulnerable: VulnerableDependency[] = [];

  // Process in batches to respect OSV limits
  for (let i = 0; i < deps.length; i += OSV_BATCH_SIZE) {
    const batch = deps.slice(i, i + OSV_BATCH_SIZE);
    const results = await queryOsvBatch(batch);

    for (let j = 0; j < batch.length; j++) {
      const dep = batch[j];
      const result = results[j];
      if (!result?.vulns?.length) continue;

      const vulns = result.vulns.map(v => ({
        id: v.id,
        summary: v.summary ?? v.details?.slice(0, 200) ?? "No description",
        fixedIn: getFixedVersion(v),
        cvssScore: v.severity?.find(s => s.type.startsWith("CVSS"))?.score,
        referenceUrl: v.references?.find(r => r.type === "WEB" || r.type === "FIX")?.url,
      }));

      // Overall severity = worst of individual vuln severities
      const severities = result.vulns.map(v => mapOsvSeverity(v));
      const worstSeverity = severities.includes("critical") ? "critical"
        : severities.includes("high") ? "high"
        : severities.includes("medium") ? "medium"
        : "low";

      vulnerable.push({
        name: dep.name,
        version: dep.version,
        ecosystem: dep.ecosystem,
        severity: worstSeverity,
        vulnerabilities: vulns,
      });
    }
  }

  return vulnerable.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });
}

/**
 * Convert SCA findings to report issue format.
 */
export function scaToIssues(findings: VulnerableDependency[]): Array<{
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
  return findings.map(dep => {
    const vulnList = dep.vulnerabilities
      .slice(0, 5)
      .map(v => `• ${v.id}: ${v.summary}${v.cvssScore ? ` (CVSS: ${v.cvssScore})` : ""}${v.fixedIn ? ` — fixed in ${v.fixedIn}` : ""}`)
      .join("\n");

    const fixedVersions = [...new Set(dep.vulnerabilities.map(v => v.fixedIn).filter(Boolean))];
    const fixSuggestion = fixedVersions.length > 0
      ? `Update \`${dep.name}\` from \`${dep.version}\` to at least \`${fixedVersions[0]}\` or the latest stable release.`
      : `Update \`${dep.name}\` from \`${dep.version}\` to the latest stable release. Check the changelog for breaking changes.`;

    const refs = dep.vulnerabilities
      .flatMap(v => v.referenceUrl ? [v.referenceUrl] : [])
      .slice(0, 2);

    return {
      title: `Vulnerable Dependency: ${dep.name}@${dep.version}`,
      description: `${dep.name} (${dep.ecosystem}) version ${dep.version} has ${dep.vulnerabilities.length} known vulnerability${dep.vulnerabilities.length > 1 ? "ies" : "y"}:\n${vulnList}${refs.length ? `\n\nReferences: ${refs.join(", ")}` : ""}`,
      severity: dep.severity,
      possibleCause: `The project uses an outdated version of \`${dep.name}\` that contains a known security vulnerability. This is a supply chain risk — the vulnerable code runs as part of your application.`,
      suggestedFix: fixSuggestion,
      codeSnippet: null,
      filePath: null,
      lineNumber: null,
      detectionMethod: "sca-osv",
    };
  });
}
