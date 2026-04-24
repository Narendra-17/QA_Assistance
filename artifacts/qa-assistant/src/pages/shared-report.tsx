import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import {
  AlertTriangle, ShieldAlert, Info, Bug, CheckCircle2,
  Globe, FileCode2, Loader2, XCircle, TrendingUp, BarChart3,
  Clock, ShieldCheck, ChevronDown, ChevronUp, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { getBaseUrl } from "@/lib/api";

interface Issue {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  possibleCause: string;
  suggestedFix: string;
  codeSnippet?: string | null;
  filePath?: string | null;
}

interface Report {
  summary: string;
  issues: Issue[];
  overallScore: number;
  recommendations: string[];
  testType?: "url" | "sast";
  deterministicFindings?: { secretsFound: number; vulnerableDepsFound: number };
}

const SEV_CONFIG = {
  critical: { label: "Critical", color: "#EF4444", bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.18)", icon: ShieldAlert },
  high:     { label: "High",     color: "#F97316", bg: "rgba(249,115,22,0.07)", border: "rgba(249,115,22,0.18)", icon: AlertTriangle },
  medium:   { label: "Medium",   color: "#F59E0B", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.18)", icon: Bug },
  low:      { label: "Low",      color: "#06B6D4", bg: "rgba(6,182,212,0.07)",  border: "rgba(6,182,212,0.18)",  icon: Info },
} as const;
type SevKey = keyof typeof SEV_CONFIG;

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : score >= 40 ? "#F97316" : "#EF4444";
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="9" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="9"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 10px ${color}70)` }} />
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

export default function SharedReport() {
  const { token } = useParams<{ token: string }>();
  const [filterSev, setFilterSev] = useState<"all" | SevKey>("all");
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared-report", token],
    queryFn: async () => {
      const resp = await fetch(`${getBaseUrl()}/api/qa/share/${token}`);
      if (!resp.ok) throw new Error(`Status ${resp.status}`);
      return resp.json() as Promise<{ run: Record<string, unknown>; expiresAt: string }>;
    },
    retry: false,
    staleTime: 60_000,
  });

  const run = data?.run as {
    id: string; appUrl?: string | null; projectName?: string | null;
    runType: "url" | "sast"; status: string; createdAt: string; updatedAt: string;
    report?: Report | null;
  } | undefined;

  const report = run?.report ?? null;
  const allIssues = report?.issues ?? [];
  const issues = filterSev === "all" ? allIssues : allIssues.filter(i => i.severity === filterSev);

  const copyShareLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copied!"));
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "hsl(230,25%,5%)" }}>
        <div className="relative">
          <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-lg animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
          </div>
        </div>
        <p className="text-zinc-500 text-sm">Loading shared report…</p>
      </div>
    );
  }

  if (error || !run || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-4" style={{ background: "hsl(230,25%,5%)" }}>
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <XCircle className="w-7 h-7 text-red-400" />
        </div>
        <div className="text-center">
          <h2 className="font-display font-bold text-xl text-white mb-2">Report not available</h2>
          <p className="text-zinc-500 text-sm max-w-sm">This share link has expired or does not exist. Ask the report owner to generate a new link.</p>
        </div>
        <Link href="/">
          <Button className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl">Go to QA Assistant</Button>
        </Link>
      </div>
    );
  }

  const isUrl = run.runType === "url";
  const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : null;

  return (
    <div className="min-h-screen" style={{ background: "hsl(230,25%,5%)" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-white/5 backdrop-blur-xl px-5 md:px-8 h-14 flex items-center justify-between"
        style={{ background: "hsl(230,25%,5%,0.85)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <span className="font-display font-bold text-sm text-white">QA Assistant</span>
          <span className="text-zinc-600 text-sm">/ Shared Report</span>
        </div>
        <div className="flex items-center gap-3">
          {expiresAt && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="w-3 h-3" />
              Expires {formatDistanceToNow(expiresAt, { addSuffix: true })}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={copyShareLink}
            className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-8 gap-1.5 text-xs">
            <Copy className="w-3 h-3" />Copy link
          </Button>
          <Link href="/">
            <Button size="sm" className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-8 text-xs">
              Try QA Assistant
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-5 md:px-8 py-8 space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={[
              "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
              isUrl ? "bg-violet-500/14 border border-violet-500/22" : "bg-cyan-500/14 border border-cyan-500/22",
            ].join(" ")}>
              {isUrl ? <Globe className="w-4.5 h-4.5 text-violet-400" /> : <FileCode2 className="w-4.5 h-4.5 text-cyan-400" />}
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-white leading-tight">
                {run.appUrl ?? run.projectName ?? "Security Assessment"}
              </h1>
              <p className="text-zinc-500 text-xs mt-0.5">
                {format(new Date(run.createdAt), "MMM d, yyyy · h:mm a")} · {isUrl ? "URL Test" : "SAST Scan"}
              </p>
            </div>
            <StatusBadge status={run.status as "completed"} />
          </div>
        </motion.div>

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
            <div className="grid grid-cols-4 gap-2">
              {(Object.entries(SEV_CONFIG) as [SevKey, typeof SEV_CONFIG[SevKey]][]).map(([key, cfg]) => {
                const count = allIssues.filter(i => i.severity === key).length;
                return (
                  <div key={key} className="text-center p-3 rounded-xl border" style={{ background: cfg.bg, borderColor: cfg.border }}>
                    <div className="text-xl font-display font-bold" style={{ color: cfg.color }}>{count}</div>
                    <div className="text-[11px] mt-0.5 font-medium" style={{ color: cfg.color }}>{cfg.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Deterministic findings banner */}
        {report.deterministicFindings && (report.deterministicFindings.secretsFound > 0 || report.deterministicFindings.vulnerableDepsFound > 0) && (
          <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-red-200">
              <span className="font-semibold">Deterministic scanner findings: </span>
              {report.deterministicFindings.secretsFound > 0 && <span>{report.deterministicFindings.secretsFound} secret{report.deterministicFindings.secretsFound > 1 ? "s" : ""} detected · </span>}
              {report.deterministicFindings.vulnerableDepsFound > 0 && <span>{report.deterministicFindings.vulnerableDepsFound} vulnerable dependenc{report.deterministicFindings.vulnerableDepsFound > 1 ? "ies" : "y"} found via OSV.dev</span>}
            </div>
          </div>
        )}

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
          <span className="text-xs text-zinc-500 font-medium">Filter:</span>
          {(["all", "critical", "high", "medium", "low"] as const).map((s) => {
            const cfg = s === "all" ? null : SEV_CONFIG[s];
            const count = s === "all" ? allIssues.length : allIssues.filter(i => i.severity === s).length;
            return (
              <button key={s} onClick={() => setFilterSev(s)}
                className={["px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border",
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
              <h3 className="font-semibold text-white text-sm mb-1">{filterSev === "all" ? "No issues found!" : `No ${filterSev} issues`}</h3>
            </div>
          ) : (
            <AnimatePresence>
              {issues.map((issue, i) => {
                const cfg = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.low;
                const Icon = cfg.icon;
                const isExpanded = expandedIssue === i;
                return (
                  <motion.div key={`${filterSev}-${i}`}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="rounded-2xl border overflow-hidden" style={{ background: cfg.bg, borderColor: cfg.border }}>
                    <button className="w-full text-left flex items-start gap-3 p-4 hover:bg-white/3 transition-colors"
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
                              <div className="rounded-xl p-3.5 border" style={{ background: `${cfg.color}0C`, borderColor: cfg.border }}>
                                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: cfg.color }}>Suggested Fix</p>
                                <p className="text-sm leading-relaxed" style={{ color: `${cfg.color}CC` }}>{issue.suggestedFix}</p>
                              </div>
                            </div>
                            {issue.codeSnippet && (
                              <pre className="code-block text-zinc-300 text-[11px]">{issue.codeSnippet}</pre>
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

        {/* Footer */}
        <div className="text-center py-6 border-t border-white/5 text-zinc-600 text-xs">
          Generated by <span className="text-violet-400 font-semibold">QA Assistant</span> · {format(new Date(run.createdAt), "MMM d, yyyy")}
          {expiresAt && ` · Link expires ${format(expiresAt, "MMM d, yyyy")}`}
        </div>
      </div>
    </div>
  );
}
