import { useGetQaRun } from "@workspace/api-client-react";
import { useParams, Link, useLocation } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft, AlertTriangle, ShieldAlert, Info, Bug, CheckCircle2,
  Copy, Download, Globe, FileCode2, Loader2, XCircle,
  TrendingUp, BarChart3, RotateCcw, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
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
  critical: { label: "Critical", color: "#EF4444", bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.18)", icon: ShieldAlert, order: 0 },
  high:     { label: "High",     color: "#F97316", bg: "rgba(249,115,22,0.07)", border: "rgba(249,115,22,0.18)", icon: AlertTriangle, order: 1 },
  medium:   { label: "Medium",   color: "#F59E0B", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.18)", icon: Bug, order: 2 },
  low:      { label: "Low",      color: "#06B6D4", bg: "rgba(6,182,212,0.07)",  border: "rgba(6,182,212,0.18)",  icon: Info, order: 3 },
} as const;

type SevKey = keyof typeof SEV_CONFIG;

function ScoreGauge({ score }: { score: number }) {
  const mounted = useRef(false);
  const [animated, setAnimated] = useState(false);
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : score >= 40 ? "#F97316" : "#EF4444";
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = animated ? (score / 100) * circ : 0;

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; requestAnimationFrame(() => setAnimated(true)); }
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="9" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="9"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 10px ${color}70)`, transition: "stroke-dasharray 1.4s cubic-bezier(.4,0,.2,1)" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="font-display font-black text-4xl text-white leading-none">{score}</span>
          <span className="text-[11px] text-zinc-500 font-medium">/100</span>
        </div>
      </div>
      <div className="font-display font-bold text-lg" style={{ color }}>Grade {grade}</div>
    </div>
  );
}

function SeverityBar({ issues }: { issues: Issue[] }) {
  const counts: Record<SevKey, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });
  return (
    <div className="grid grid-cols-4 gap-2">
      {(Object.entries(SEV_CONFIG) as [SevKey, typeof SEV_CONFIG[SevKey]][]).map(([key, cfg]) => (
        <div key={key} className="text-center p-3 rounded-xl border transition-colors"
          style={{ background: cfg.bg, borderColor: cfg.border }}>
          <div className="text-xl font-display font-bold" style={{ color: cfg.color }}>{counts[key]}</div>
          <div className="text-[11px] mt-0.5 font-medium" style={{ color: cfg.color }}>{cfg.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProgressAnalysis({ isUrl }: { isUrl: boolean }) {
  const steps = isUrl
    ? ["Fetching URL", "Parsing HTML", "Checking headers", "AI analysis", "Generating report"]
    : ["Reading files", "Parsing code", "Scanning patterns", "AI analysis", "Generating report"];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setStep(s => (s + 1) % steps.length), 2800);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="text-center py-20 rounded-2xl border border-violet-500/12 bg-violet-500/4">
      <div className="relative inline-flex mb-6">
        <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-lg animate-pulse" />
        <div className="relative w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        </div>
      </div>
      <h3 className="text-lg font-display font-bold text-white mb-2">AI Analysis in Progress</h3>
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        <AnimatePresence mode="wait">
          <motion.p key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="text-zinc-400 text-sm min-w-[200px]">
            {steps[step]}…
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="flex justify-center gap-1.5 mb-6">
        {steps.map((_, i) => (
          <div key={i} className="h-1 rounded-full transition-all duration-500"
            style={{
              width: i === step ? 24 : 8,
              background: i <= step ? "#8B5CF6" : "rgba(255,255,255,0.1)",
            }} />
        ))}
      </div>
      <p className="text-zinc-600 text-xs">This typically takes 15–30 seconds</p>
    </div>
  );
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [filterSev, setFilterSev] = useState<"all" | SevKey>("all");
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const { data: run, isLoading } = (useGetQaRun as any)(id!, {
    query: { refetchInterval: pollingEnabled ? 3000 : false, staleTime: 0 },
  }) as { data: RunData | undefined; isLoading: boolean };

  useEffect(() => {
    if (run?.status === "completed" || run?.status === "failed") setPollingEnabled(false);
  }, [run?.status]);

  const report = run?.report as Report | null | undefined;
  const allIssues = report?.issues ?? [];
  const issues = filterSev === "all" ? allIssues : allIssues.filter(i => i.severity === filterSev);

  const copyReport = useCallback(() => {
    if (!report) return;
    const lines = [
      `# QA Report — ${run?.appUrl ?? run?.projectName}`,
      `**Score:** ${report.overallScore}/100`,
      `\n## Executive Summary\n${report.summary}`,
      `\n## Issues (${report.issues.length})`,
      ...report.issues.map(i =>
        `\n### [${i.severity.toUpperCase()}] ${i.title}\n${i.description}\n**Fix:** ${i.suggestedFix}${i.filePath ? `\n**File:** ${i.filePath}` : ""}`
      ),
      `\n## Strategic Recommendations`,
      ...report.recommendations.map((r, i) => `${i + 1}. ${r}`),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => toast.success("Report copied to clipboard"));
  }, [report, run]);

  const downloadReport = useCallback(() => {
    if (!report || !run) return;
    const blob = new Blob([JSON.stringify({ run, report }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qa-report-${run.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Report downloaded");
  }, [report, run]);

  function handleRerun() {
    if (!run) return;
    if (run.runType === "url") setLocation("/new");
    else setLocation("/sast");
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
        </div>
        <p className="text-zinc-400 text-sm">Loading report…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <XCircle className="w-12 h-12 text-red-400" />
        <p className="text-zinc-300 font-semibold">Run not found</p>
        <Button asChild variant="outline" className="border-white/10 text-white rounded-xl">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-1.5" />Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const isRunning = run.status === "pending" || run.status === "running";
  const isUrl = run.runType === "url";

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm"
            className="text-zinc-500 hover:text-white pl-0 mb-3 -ml-1 gap-1 h-8">
            <Link href="/"><ArrowLeft className="w-3.5 h-3.5" />Dashboard</Link>
          </Button>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={[
              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
              isUrl ? "bg-violet-500/14 border border-violet-500/22" : "bg-cyan-500/14 border border-cyan-500/22",
            ].join(" ")}>
              {isUrl
                ? <Globe className="w-4 h-4 text-violet-400" />
                : <FileCode2 className="w-4 h-4 text-cyan-400" />}
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-white leading-tight max-w-lg truncate">
                {run.appUrl ?? run.projectName ?? "Assessment"}
              </h1>
              <p className="text-zinc-500 text-xs mt-0.5">
                {format(new Date(run.createdAt), "MMM d, yyyy · h:mm a")} · {isUrl ? "URL Test" : "SAST Scan"}
                {run.status === "completed" && ` · Updated ${formatDistanceToNow(new Date(run.updatedAt), { addSuffix: true })}`}
              </p>
            </div>
            <StatusBadge status={run.status} />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRerun}
            className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />New Run
          </Button>
          {run.status === "completed" && (
            <>
              <Button variant="outline" size="sm" onClick={copyReport}
                className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                <Copy className="w-3.5 h-3.5" />Copy
              </Button>
              <Button variant="outline" size="sm" onClick={downloadReport}
                className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                <Download className="w-3.5 h-3.5" />Export
              </Button>
            </>
          )}
        </div>
      </motion.div>

      {/* Running state */}
      <AnimatePresence>
        {isRunning && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <ProgressAnalysis isUrl={isUrl} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error state */}
      {run.status === "failed" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="p-5 rounded-2xl border border-red-500/18 bg-red-500/5 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 font-semibold text-sm">Analysis failed</p>
            <p className="text-zinc-400 text-sm mt-1">{run.errorMessage ?? "An unexpected error occurred during analysis."}</p>
            <Button size="sm" onClick={handleRerun} variant="outline"
              className="mt-3 border-red-500/20 text-red-300 hover:bg-red-500/10 rounded-xl h-8 gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />Try again
            </Button>
          </div>
        </motion.div>
      )}

      {/* Report */}
      {run.status === "completed" && report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
          {/* Score + Summary */}
          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-white/7 bg-white/2">
              <ScoreGauge score={report.overallScore} />
            </div>
            <div className="flex flex-col gap-4 p-6 rounded-2xl border border-white/7 bg-white/2">
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Executive Summary</p>
                <p className="text-zinc-300 leading-relaxed text-sm">{report.summary}</p>
              </div>
              <SeverityBar issues={report.issues} />
            </div>
          </div>

          {/* Recommendations */}
          {report.recommendations.length > 0 && (
            <div className="p-5 rounded-2xl border border-white/7 bg-white/2">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <p className="text-sm font-semibold text-white">Strategic Recommendations</p>
              </div>
              <ol className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                    <span className="w-5 h-5 rounded-md bg-emerald-500/12 border border-emerald-500/18 text-emerald-400 text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">{i + 1}</span>
                    {rec}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <BarChart3 className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-500 font-medium">Filter by severity:</span>
            {(["all", "critical", "high", "medium", "low"] as const).map((s) => {
              const cfg = s === "all" ? null : SEV_CONFIG[s];
              const count = s === "all" ? allIssues.length : allIssues.filter(i => i.severity === s).length;
              return (
                <button key={s} onClick={() => setFilterSev(s)}
                  className={[
                    "px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border",
                    filterSev === s && s === "all" ? "bg-violet-600 text-white border-violet-600" : "",
                    filterSev !== s ? "bg-white/4 text-zinc-400 border-white/8 hover:border-white/16 hover:text-zinc-200" : "",
                  ].join(" ")}
                  style={filterSev === s && cfg ? { background: cfg.bg, color: cfg.color, borderColor: cfg.border } : {}}>
                  {s === "all" ? `All (${count})` : `${cfg!.label} (${count})`}
                </button>
              );
            })}
          </div>

          {/* Issues */}
          <div className="space-y-2">
            {issues.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-white/7 bg-white/2">
                <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto mb-3" />
                <h3 className="font-semibold text-white text-sm mb-1">
                  {filterSev === "all" ? "No issues found!" : `No ${filterSev} issues`}
                </h3>
                <p className="text-zinc-500 text-xs">
                  {filterSev === "all" ? "Clean analysis — no issues detected." : "No issues at this severity level."}
                </p>
              </div>
            ) : (
              <AnimatePresence>
                {issues.map((issue, i) => {
                  const cfg = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.low;
                  const Icon = cfg.icon;
                  const isExpanded = expandedIssue === i;
                  return (
                    <motion.div key={`${filterSev}-${i}`}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="rounded-2xl border overflow-hidden"
                      style={{ background: cfg.bg, borderColor: cfg.border }}>
                      <button
                        className="w-full text-left flex items-start gap-3 p-4 hover:bg-white/3 transition-colors"
                        onClick={() => setExpandedIssue(isExpanded ? null : i)}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.border}` }}>
                          <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white text-sm">{issue.title}</span>
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide"
                              style={{ background: `${cfg.color}18`, color: cfg.color, borderColor: cfg.border }}>
                              {cfg.label}
                            </span>
                            {issue.filePath && (
                              <span className="text-[10px] font-mono text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded-md truncate max-w-[200px]">
                                {issue.filePath}
                              </span>
                            )}
                          </div>
                          <p className="text-zinc-400 text-xs mt-1.5 leading-relaxed line-clamp-2">{issue.description}</p>
                        </div>
                        <div className="text-zinc-600 shrink-0 mt-1">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }} className="overflow-hidden"
                            style={{ borderTop: `1px solid ${cfg.border}` }}>
                            <div className="p-4 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-xl p-3.5 bg-white/4 border border-white/8">
                                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Root Cause</p>
                                  <p className="text-sm text-zinc-300 leading-relaxed">{issue.possibleCause}</p>
                                </div>
                                <div className="rounded-xl p-3.5 border"
                                  style={{ background: `${cfg.color}0C`, borderColor: cfg.border }}>
                                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: cfg.color }}>Suggested Fix</p>
                                  <p className="text-sm leading-relaxed" style={{ color: `${cfg.color}CC` }}>{issue.suggestedFix}</p>
                                </div>
                              </div>
                              {issue.codeSnippet && (
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Code Snippet</p>
                                    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(issue.codeSnippet!); toast.success("Copied"); }}
                                      className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors">
                                      <Copy className="w-3 h-3" />Copy
                                    </button>
                                  </div>
                                  <pre className="code-block text-zinc-300 text-[11px]">{issue.codeSnippet}</pre>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
