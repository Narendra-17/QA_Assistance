/**
 * SARIF 2.1.0 generator for QA Assistant reports.
 * SARIF is the standard format consumed by GitHub Code Scanning.
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
 */

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Documents/CommitteeSpecifications/2.1.0/sarif-schema-2.1.0.json";

interface Issue {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  possibleCause?: string | null;
  suggestedFix?: string | null;
  filePath?: string | null;
  lineNumber?: number | null;
  detectionMethod?: string | null;
}

type SarifLevel = "error" | "warning" | "note";

function severityToLevel(sev: Issue["severity"]): SarifLevel {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "note";
}

function issueToRuleId(issue: Issue, index: number): string {
  const method = issue.detectionMethod ?? "ai";
  const prefix =
    method === "deterministic" ? "SEC" : method === "sca-osv" ? "SCA" : "QA";
  const sev = issue.severity.slice(0, 3).toUpperCase();
  return `${prefix}-${sev}-${String(index + 1).padStart(3, "0")}`;
}

export function buildSarif(
  issues: Issue[],
  runId: string,
  target: string,
): object {
  const rules = issues.map((issue, i) => ({
    id: issueToRuleId(issue, i),
    name: issue.title.replace(/\s+/g, ""),
    shortDescription: { text: issue.title },
    fullDescription: { text: issue.description },
    help: {
      text: [
        issue.possibleCause ? `Cause: ${issue.possibleCause}` : "",
        issue.suggestedFix ? `Fix: ${issue.suggestedFix}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      markdown: [
        issue.possibleCause ? `**Cause:** ${issue.possibleCause}` : "",
        issue.suggestedFix ? `**Fix:** ${issue.suggestedFix}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    properties: {
      tags: [
        issue.severity,
        issue.detectionMethod ?? "ai",
        "security",
        "qa-assistant",
      ],
      severity: issue.severity,
    },
  }));

  const results = issues.map((issue, i) => {
    const ruleId = issueToRuleId(issue, i);
    const level = severityToLevel(issue.severity);

    const physicalLocation: Record<string, unknown> = {
      artifactLocation: {
        uri: issue.filePath ?? target,
        uriBaseId: "%SRCROOT%",
      },
    };

    if (issue.lineNumber) {
      physicalLocation.region = {
        startLine: issue.lineNumber,
        startColumn: 1,
      };
    }

    return {
      ruleId,
      level,
      message: {
        text: `${issue.title}: ${issue.description}`,
        markdown: `**${issue.title}**\n\n${issue.description}${issue.suggestedFix ? `\n\n> **Fix:** ${issue.suggestedFix}` : ""}`,
      },
      locations: [{ physicalLocation }],
      properties: {
        runId,
        severity: issue.severity,
        detectionMethod: issue.detectionMethod ?? "ai",
      },
    };
  });

  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "QA Assistant",
            version: "1.0.0",
            informationUri: "https://github.com/features/security",
            rules,
          },
        },
        results,
        properties: {
          qaRunId: runId,
          target,
          generatedAt: new Date().toISOString(),
        },
      },
    ],
  };
}
