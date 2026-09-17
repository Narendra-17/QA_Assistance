import path from "path";

export interface DeterministicSastIssue {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  possibleCause: string;
  suggestedFix: string;
  codeSnippet: string;
  filePath: string;
  lineNumber: number;
  detectionMethod: "deterministic-sast";
  confidence: "confirmed";
  owasp: string;
  effortLevel: "low" | "medium" | "high";
  effortNote: string;
}

type MatchRule = {
  pattern: RegExp;
  title: string;
  description: string;
  severity: DeterministicSastIssue["severity"];
  possibleCause: string;
  suggestedFix: string;
  owasp: string;
  effortLevel: DeterministicSastIssue["effortLevel"];
  effortNote: string;
};

const rules: MatchRule[] = [
  {
    pattern: /\b(?:eval|new\s+Function|vm\.runInThisContext)\s*\(\s*(?!["'`])/i,
    title: "Dynamic code execution with variable input",
    description: "Untrusted or variable input is passed to a dynamic code execution primitive.",
    severity: "critical",
    possibleCause: "Dynamic evaluation is being used without proving that the argument is a fixed literal.",
    suggestedFix: "Remove dynamic evaluation and use a typed parser or an allowlisted dispatch table.",
    owasp: "A03:2021-Injection",
    effortLevel: "medium",
    effortNote: "Replace the dynamic execution path with explicit parsing or dispatch.",
  },
  {
    pattern: /\bMath\.random\s*\(\s*\)/i,
    title: "Math.random used for security-sensitive value",
    description: "Math.random is not cryptographically secure and must not generate security-sensitive values.",
    severity: "high",
    possibleCause: "A predictable PRNG is used in a token, session, password, OTP, or CSRF context.",
    suggestedFix: "Use crypto.randomBytes, crypto.randomUUID, or the platform's secure random API.",
    owasp: "A02:2021-Cryptographic Failures",
    effortLevel: "low",
    effortNote: "Replace the random source at the token generation call.",
  },
  {
    pattern: /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/i,
    title: "Command injection through interpolated shell command",
    description: "A template literal containing a variable is passed to a shell execution function.",
    severity: "critical",
    possibleCause: "User-controlled or variable input can alter the command executed by the shell.",
    suggestedFix: "Use execFile with a fixed executable and an argument array; validate every argument.",
    owasp: "A03:2021-Injection",
    effortLevel: "medium",
    effortNote: "Remove shell interpolation and pass validated arguments separately.",
  },
  {
    pattern: /\bjwt\.verify\s*\([^)]*\)(?![^;{]*algorithms\s*:)/i,
    title: "JWT verification does not pin allowed algorithms",
    description: "jwt.verify is called without an explicit algorithms allowlist.",
    severity: "high",
    possibleCause: "The verifier may accept an algorithm that the application did not intend to trust.",
    suggestedFix: 'Pass an explicit option such as { algorithms: ["RS256"] } and validate the expected issuer and audience.',
    owasp: "A07:2021-Identification and Authentication Failures",
    effortLevel: "low",
    effortNote: "Add the expected algorithm and issuer/audience options to jwt.verify.",
  },
  {
    pattern: /\b(?:md5|sha1|sha256)\s*\([^)]*(?:password|passwd|pwd)/i,
    title: "Weak hash applied directly to password",
    description: "A general-purpose hash is applied directly to a password value.",
    severity: "critical",
    possibleCause: "Password storage or comparison lacks a slow password hashing function.",
    suggestedFix: "Use Argon2id, scrypt, bcrypt, or PBKDF2 with a unique salt and suitable work factor.",
    owasp: "A02:2021-Cryptographic Failures",
    effortLevel: "medium",
    effortNote: "Migrate password storage and verification to a password hashing function.",
  },
  {
    pattern: /(?:\.innerHTML\s*=|document\.write\s*\()\s*(?!["'`])/i,
    title: "Unsanitized DOM HTML assignment",
    description: "A variable is written into HTML-rendering DOM API without a literal-only value.",
    severity: "high",
    possibleCause: "Untrusted content can become executable markup in a browser.",
    suggestedFix: "Use textContent or a trusted sanitizer with a restrictive allowlist.",
    owasp: "A03:2021-Injection",
    effortLevel: "low",
    effortNote: "Replace HTML assignment with textContent or sanitize before rendering.",
  },
  {
    pattern: /\bpickle\.loads\s*\(|\byaml\.load\s*\(\s*(?![^)]*Loader\s*:\s*yaml\.SafeLoader)/i,
    title: "Unsafe deserialization of untrusted data",
    description: "A deserializer capable of constructing executable objects receives input without a safe loader.",
    severity: "critical",
    possibleCause: "Untrusted serialized data is being loaded with an unsafe deserialization API.",
    suggestedFix: "Use yaml.safe_load or a data-only serialization format with an explicit schema.",
    owasp: "A08:2021-Software and Data Integrity Failures",
    effortLevel: "medium",
    effortNote: "Replace the unsafe loader and validate the resulting data shape.",
  },
  {
    pattern: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`\n]*\$\{/i,
    title: "SQL statement built with interpolated variable",
    description: "A SQL statement is assembled with template interpolation instead of parameters.",
    severity: "critical",
    possibleCause: "Input can change the SQL syntax executed by the database.",
    suggestedFix: "Use parameterized queries or the ORM's bound query API.",
    owasp: "A03:2021-Injection",
    effortLevel: "medium",
    effortNote: "Convert the interpolated SQL to a parameterized query.",
  },
];

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export function scanDeterministicSast(files: Array<{ name: string; content: string }>): DeterministicSastIssue[] {
  const findings: DeterministicSastIssue[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (const rule of rules) {
        if (!rule.pattern.test(line)) continue;
        rule.pattern.lastIndex = 0;
        findings.push({
          title: `${rule.title} in ${path.basename(file.name)}`,
          description: `${rule.description} Exact source evidence is shown below.`,
          severity: rule.severity,
          possibleCause: rule.possibleCause,
          suggestedFix: rule.suggestedFix,
          codeSnippet: line.trim().slice(0, 800),
          filePath: file.name,
          lineNumber: lineIndex + 1,
          detectionMethod: "deterministic-sast",
          confidence: "confirmed",
          owasp: rule.owasp,
          effortLevel: rule.effortLevel,
          effortNote: rule.effortNote,
        });
      }
    }
  }
  return findings;
}

export function redactDeterministicLines(
  files: Array<{ name: string; content: string }>,
  findings: DeterministicSastIssue[],
): Array<{ name: string; content: string }> {
  const linesByFile = new Map<string, Set<number>>();
  for (const finding of findings) {
    const lines = linesByFile.get(finding.filePath) ?? new Set<number>();
    lines.add(finding.lineNumber);
    linesByFile.set(finding.filePath, lines);
  }
  return files.map(file => {
    const lines = linesByFile.get(file.name);
    if (!lines) return file;
    return {
      ...file,
      content: file.content
        .split(/\r?\n/)
        .map((line, index) => lines.has(index + 1)
          ? `// [deterministic finding removed from AI pass: line ${index + 1}]`
          : line)
        .join("\n"),
    };
  });
}

export interface SastFileGroup {
  files: Array<{ name: string; content: string }>;
  relationships: string[];
}

function importTargets(content: string): string[] {
  const targets: string[] = [];
  for (const match of content.matchAll(/(?:import[\s\S]*?\sfrom\s*|require\s*\(|import\s*\()\s*["']([^"']+)["']/g)) {
    targets.push(match[1]);
  }
  return targets;
}

function stem(name: string): string {
  return name.replace(/\\/g, "/").replace(/\.[^/.]+$/, "").split("/").pop()?.toLowerCase() ?? "";
}

export function buildDependencyGroups(files: Array<{ name: string; content: string }>): SastFileGroup[] {
  const byStem = new Map<string, Array<{ name: string; content: string }>>();
  for (const file of files) {
    const key = stem(file.name);
    const matches = byStem.get(key) ?? [];
    matches.push(file);
    byStem.set(key, matches);
  }
  const groups: SastFileGroup[] = [];
  const consumed = new Set<string>();
  for (const file of files) {
    if (consumed.has(file.name)) continue;
    const related = new Set<string>([file.name]);
    const relationships: string[] = [];
    for (const target of importTargets(file.content)) {
      const targetStem = stem(target);
      const dependency = [...byStem.entries()]
        .find(([key]) => key === targetStem || target.endsWith(`/${key}`))?.[1]?.[0];
      if (dependency && dependency.name !== file.name && related.size < 3) {
        related.add(dependency.name);
        relationships.push(`${file.name} imports ${dependency.name}`);
      }
    }
    const groupFiles = files.filter(candidate => related.has(candidate.name));
    groupFiles.forEach(candidate => consumed.add(candidate.name));
    groups.push({ files: groupFiles, relationships });
  }
  return groups;
}