import { useGetQaRun } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import {
  ArrowLeft, AlertTriangle, ShieldAlert, Info, Bug, CheckCircle2,
  Copy, Download, RefreshCw, Globe, FileCode2, Loader2, XCircle,
  TrendingUp, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";

interface Issue {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  possibleCause: string;
  suggestedFix: string;
  codeSnippet?: string | null;
  filePath?: string | null;
  lineNumber?: number | null;
}

interface Report {
  summary: string;
  issues: Issue[];
  overallScore: number;
  recommendations: string[];
  testType?: "url" | "sast";
}

interface RunData {
  id: string;
  appUrl?: string | null;
  projectName?: string | null;
  appDescription?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  runType: "url" | "sast";
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  report?: Report | null;
}

const SEV_CONFIG = {
  critical: { label: "Critical", color: "#EF4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", icon: ShieldAlert },
  high: { label: "High", color: "#F97316", bg: "rgba(249,115,22,0.08)", border: "rgba(249,115,22,0.2)", icon: AlertTriangle },
  medium: { label: "Medium", color: "#F59E0B", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", icon: Bug },
  low: { label: "Low", color: "#06B6D4", bg: "rgba(6,182,212,0.08)", border: "rgba(6,182,212,0.2)", icon: Info },
};

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : score >= 40 ? "#F97316" : "#EF4444";
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 8px ${color}80)`, transition: "stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display font-black text-3xl text-white">{score}</span>
          <span className="text-xs text-zinc-500 font-medium">/100</span>
        </div>
      </div>
      <div className="font-display font-bold text-xl" style={{ color }}>Grade {grade}</div>
    </div>
  );
}

function SeverityCount({ issues }: { issues: Issue[] }) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });
  return (
    <div className="grid grid-cols-4 gap-3">
      {(Object.entries(SEV_CONFIG) as [keyof typeof SEV_CONFIG, typeof SEV_CONFIG[keyof typeof SEV_CONFIG]][]).map(([key, cfg]) => (
        <div key={key} className="text-center p-3 rounded-xl border" style={{ background: cfg.bg, borderColor: cfg.border }}>
          <div className="text-2xl font-display font-bold" style={{ color: cfg.color }}>{counts[key]}</div>
          <div className="text-xs mt-0.5" style={{ color: cfg.color }}>{cfg.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [filterSev, setFilterSev] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run, isLoading } = (useGetQaRun as any)(id!, {
    query: { refetchInterval: pollingEnabled ? 3000 : false },
  }) as { data: RunData | undefined; isLoading: boolean };

  useEffect(() => {
    if (run?.status === "completed" || run?.status === "failed") {
      setPollingEnabled(false);
    }
  }, [run?.status]);

  const report = run?.report as Report | null | undefined;
  const issues = (report?.issues ?? []).filter(i =>
    filterSev === "all" || i.severity === filterSev
  );

  const copyReport = useCallback(() => {
    if (!report) return;
    const text = [
      `# QA Report — ${run?.appUrl ?? run?.projectName}`,
      `Score: ${report.overallScore}/100`,
      `\n## Summary\n${report.summary}`,
      `\n## Issues (${report.issues.length})`,
      ...report.issues.map(i => `\n### [${i.severity.toUpperCase()}] ${i.title}\n${i.description}\nFix: ${i.suggestedFix}`),
      `\n## Recommendations`,
      ...report.recommendations.map((r, i) => `${i + 1}. ${r}`),
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Report copied to clipboard");
  }, [report, run]);

  const downloadReport = useCallback(() => {
    if (!report || !run) return;
    const blob = new Blob([JSON.stringify({ run, report }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qa-report-${run.id.slice(0, 8)}.json`;
    a.click();
    toast.success("Report downloaded");
  }, [report, run]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        </div>
        <p className="text-zinc-400">Loading report…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <XCircle className="w-12 h-12 text-red-400" />
        <p className="text-zinc-400">Run not found.</p>
        <Button asChild variant="outline" className="border-white/10"><Link href="/">← Back</Link></Button>
      </div>
    );
  }

  const isRunning = run.status === "pending" || run.status === "running";
  const isUrl = run.runType === "url";

  return (
    <div className="max-w-5xl mx-auto w-full space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" className="text-zinc-500 hover:text-white pl-0 mb-3 -ml-1">
            <Link href="/"><ArrowLeft className="w-4 h-4 mr-1" />Back to Dashboard</Link>
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={["w-9 h-9 rounded-xl flex items-center justify-center", isUrl ? "bg-violet-500/15 border border-violet-500/25" : "bg-cyan-500/15 border border-cyan-500/25"].join(" ")}>
              {isUrl ? <Globe className="w-4.5 h-4.5 text-violet-400" /> : <FileCode2 className="w-4.5 h-4.5 text-cyan-400" />}
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-white truncate max-w-lg">
                {run.appUrl ?? run.projectName ?? "Assessment"}
              </h1>
              <p className="text-zinc-500 text-xs mt-0.5">{format(new Date(run.createdAt), "MMMM d, yyyy · h:mm a")} · {isUrl ? "URL Test" : "SAST Scan"}</p>
            </div>
            <StatusBadge status={run.status} />
          </div>
        </div>

        {run.status === "completed" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyReport} className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl">
              <Copy className="w-4 h-4 mr-1.5" />Copy
            </Button>
            <Button variant="outline" onClick={downloadReport} className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl">
              <Download className="w-4 h-4 mr-1.5" />Export JSON
            </Button>
          </div>
        )}
      </motion.div>

      {/* Running state */}
      <AnimatePresence>
        {isRunning && (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="text-center py-20 rounded-2xl border border-violet-500/15 bg-violet-500/5">
            <div className="relative inline-flex mb-4">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              </div>
            </div>
            <h3 className="text-xl font-display font-bold text-white mb-2">Analysis in progress…</h3>
            <p className="text-zinc-400 text-sm">GPT-4o is analyzing your {isUrl ? "application" : "source code"}. This takes about 15–30 seconds.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {run.status === "failed" && (
        <div className="p-6 rounded-2xl border border-red-500/20 bg-red-500/6 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 font-semibold">Analysis failed</p>
            <p className="text-zinc-400 text-sm mt-1">{run.errorMessage ?? "An unknown error occurred."}</p>
          </div>
        </div>
      )}

      {/* Report */}
      {run.status === "completed" && report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Score + Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="flex flex-col items-center justify-center p-7 rounded-2xl border border-white/8 bg-white/3">
              <ScoreGauge score={report.overallScore} />
            </div>
            <div className="md:col-span-2 flex flex-col gap-5 p-7 rounded-2xl border border-white/8 bg-white/3">
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">Executive Summary</h3>
                <p className="text-zinc-300 leading-relaxed text-sm">{report.summary}</p>
              </div>
              <SeverityCount issues={report.issues} />
            </div>
          </div>

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div className="p-6 rounded-2xl border border-white/8 bg-white/3">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Strategic Recommendations</h3>
              </div>
              <ul className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-300">
                    <span className="w-5 h-5 rounded-md bg-emerald-500/12 border border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center shrink-0 mt-0.5 font-semibold">{i + 1}</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Issues filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <BarChart3 className="w-4 h-4 text-zinc-500" />
            <span className="text-sm text-zinc-500 mr-1">Filter:</span>
            {(["all", "critical", "high", "medium", "low"] as const).map((s) => {
              const cfg = s === "all" ? null : SEV_CONFIG[s];
              const count = s === "all" ? report.issues.length : report.issues.filter(i => i.severity === s).length;
              return (
                <button key={s} onClick={() => setFilterSev(s)}
                  className={[
                    "px-3 py-1 rounded-full text-xs font-semibold transition-all border",
                    filterSev === s
                      ? s === "all" ? "bg-violet-600 text-white border-violet-600" : ""
                      : "bg-white/4 text-zinc-400 border-white/8 hover:border-white/16 hover:text-zinc-200",
                  ].join(" ")}
                  style={filterSev === s && cfg ? { background: cfg.bg, color: cfg.color, borderColor: cfg.border } : {}}>
                  {s === "all" ? `All (${count})` : `${s} (${count})`}
                </button>
              );
            })}
          </div>

          {/* Issue cards */}
          <div className="space-y-3">
            {issues.length === 0 && (
              <div className="text-center py-12 rounded-2xl border border-white/8 bg-white/3">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <h3 className="font-semibold text-white mb-1">No {filterSev !== "all" ? filterSev : ""} issues found!</h3>
                <p className="text-zinc-500 text-sm">{filterSev === "all" ? "Perfect score — no issues detected." : "No issues at this severity level."}</p>
              </div>
            )}
            <AnimatePresence>
              {issues.map((issue, i) => {
                const cfg = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.low;
                const Icon = cfg.icon;
                const isExpanded = expandedIssue === i;
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className="rounded-2xl border overflow-hidden transition-all cursor-pointer"
                    style={{ background: `${cfg.bg}60`, borderColor: cfg.border }}
                    onClick={() => setExpandedIssue(isExpanded ? null : i)}>
                    <div className="flex items-start gap-4 p-5">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                        <Icon className="w-4.5 h-4.5" style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-semibold text-white text-sm">{issue.title}</h3>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wide" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                            {cfg.label}
                          </span>
                          {issue.filePath && (
                            <span className="text-[11px] font-mono text-zinc-500 bg-white/5 px-2 py-0.5 rounded-md">{issue.filePath}</span>
                          )}
                        </div>
                        <p className="text-zinc-400 text-sm mt-1.5 leading-relaxed">{issue.description}</p>
                      </div>
                      <div className="text-zinc-600 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t" style={{ borderColor: cfg.border }}>
                          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-xl p-4 bg-white/4 border border-white/8">
                              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1.5">Possible Cause</p>
                              <p className="text-sm text-zinc-300 leading-relaxed">{issue.possibleCause}</p>
                            </div>
                            <div className="rounded-xl p-4 border" style={{ background: `${cfg.bg}80`, borderColor: cfg.border }}>
                              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: cfg.color }}>Suggested Fix</p>
                              <p className="text-sm leading-relaxed" style={{ color: `${cfg.color}CC` }}>{issue.suggestedFix}</p>
                            </div>
                          </div>
                          {issue.codeSnippet && (
                            <div className="px-5 pb-5">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Code Snippet</p>
                                <button onClick={() => { navigator.clipboard.writeText(issue.codeSnippet!); toast.success("Copied"); }}
                                  className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                                  <Copy className="w-3 h-3" />Copy
                                </button>
                              </div>
                              <pre className="code-block text-zinc-300">{issue.codeSnippet}</pre>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </div>
  );
}
