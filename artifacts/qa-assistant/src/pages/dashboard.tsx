import {
  useListQaRuns, useDeleteQaRun,
  getListQaRunsQueryKey, getGetQaStatsQueryKey, useGetQaStats,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus, Trash2, Globe, FileCode2, AlertTriangle, TrendingUp,
  Activity, Loader2, Search, ShieldAlert, CheckCircle2,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CONTAINER: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const ITEM: Variants = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } },
};

// ── Animated counter ──────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1100) {
  const [value, setValue] = useState(0);
  const prevRef           = useRef(0);

  useEffect(() => {
    if (target === prevRef.current) return;
    const from = prevRef.current;
    prevRef.current = target;

    if (from === target) return;

    let startTs: number | null = null;
    let raf: number;

    function tick(now: number) {
      if (!startTs) startTs = now;
      const p    = Math.min((now - startTs) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 4);
      setValue(Math.round(from + (target - from) * ease));
      if (p < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

// ── Score trend chart ─────────────────────────────────────────────────────────
interface ScorePoint { id: string; score: number; runType: string; createdAt: string; label: string }

function scoreColor(s: number) { return s >= 80 ? "#10B981" : s >= 60 ? "#F59E0B" : s >= 40 ? "#F97316" : "#EF4444"; }

function ScoreTrendChart({ data }: { data: ScorePoint[] }) {
  const chartData = data.map((d, i) => ({
    n: `#${i + 1}`,
    score: d.score,
    label: d.label,
    date: new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    type: d.runType,
  }));
  const last  = chartData.at(-1);
  const first = chartData[0];
  const delta = last && first ? last.score - first.score : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {last && (
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-2xl tabular-nums" style={{ color: scoreColor(last.score) }}>{last.score}</span>
            <span className="text-zinc-500 text-sm">latest score</span>
          </div>
        )}
        {Math.abs(delta) > 0 && (
          <span className={["text-xs font-bold px-2 py-0.5 rounded-lg", delta > 0 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-red-400 bg-red-500/10 border border-red-500/20"].join(" ")}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} pts vs first run
          </span>
        )}
        <span className="text-zinc-600 text-[11px] ml-auto">{data.length} completed run{data.length !== 1 ? "s" : ""}</span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#8B5CF6" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#52525b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#52525b" }} axisLine={false} tickLine={false} ticks={[0, 50, 100]} />
          <Tooltip
            contentStyle={{ background: "hsl(230,24%,9%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, fontSize: 11, padding: "8px 12px" }}
            labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
            cursor={{ stroke: "rgba(139,92,246,0.25)", strokeWidth: 1 }}
            formatter={(val: number, _: string, props: { payload?: { label?: string } }) => [
              <span key="v" style={{ color: scoreColor(val), fontWeight: 700 }}>{val}/100</span>,
              props.payload?.label ?? "",
            ]}
          />
          <Area type="monotone" dataKey="score" stroke="#8B5CF6" strokeWidth={2} fill="url(#scoreGrad)"
            dot={(props: { cx?: number; cy?: number; payload?: { score: number }; index?: number }) => (
              <circle key={props.index} cx={props.cx} cy={props.cy} r={3.5} fill={scoreColor(props.payload?.score ?? 0)} strokeWidth={0} />
            )}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color, loading }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; loading?: boolean;
}) {
  const numTarget    = typeof value === "number" ? value :
    (typeof value === "string" && value !== "—" && !isNaN(Number(value))) ? Number(value) : null;
  const animatedNum  = useCountUp(numTarget ?? 0, 1100);
  const displayValue = loading ? null : numTarget !== null ? animatedNum : value;

  return (
    <motion.div variants={ITEM}
      className="group relative overflow-hidden rounded-2xl border border-white/8 p-5 flex items-start gap-4 transition-all duration-200 hover:border-white/14"
      style={{ background: "linear-gradient(145deg,hsl(230 22% 8%),hsl(230 22% 7%))" }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `radial-gradient(circle at 0% 0%, ${color}08 0%, transparent 70%)` }} />
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 relative z-10 transition-transform group-hover:scale-110 duration-200"
        style={{ background: `${color}18`, border: `1px solid ${color}28` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="relative z-10 min-w-0">
        {loading ? (
          <div className="h-8 w-16 rounded-lg shimmer mb-1" />
        ) : (
          <div key={String(displayValue)} className="text-2xl font-display font-bold text-white tabular-nums value-pop">
            {displayValue}
          </div>
        )}
        <div className="text-sm text-zinc-400 mt-0.5 font-medium">{label}</div>
        {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
      </div>
    </motion.div>
  );
}

// ── Severity bar ──────────────────────────────────────────────────────────────
function SeverityBar({ issues }: { issues: Array<{ severity: string }> }) {
  const total = issues.length;
  if (total === 0) return null;

  const counts = {
    critical: issues.filter(i => i.severity === "critical").length,
    high:     issues.filter(i => i.severity === "high").length,
    medium:   issues.filter(i => i.severity === "medium").length,
    low:      issues.filter(i => i.severity === "low").length,
  };

  return (
    <div className="hidden md:flex flex-col items-center gap-1 shrink-0">
      <div className="flex h-1.5 w-14 rounded-full overflow-hidden gap-[1px] bg-white/5">
        {counts.critical > 0 && (
          <div className="bar-fill h-full rounded-sm" style={{ width: `${(counts.critical / total) * 100}%`, background: "#EF4444" }} />
        )}
        {counts.high > 0 && (
          <div className="bar-fill h-full rounded-sm" style={{ width: `${(counts.high / total) * 100}%`, background: "#F97316", animationDelay: "0.05s" }} />
        )}
        {counts.medium > 0 && (
          <div className="bar-fill h-full rounded-sm" style={{ width: `${(counts.medium / total) * 100}%`, background: "#F59E0B", animationDelay: "0.1s" }} />
        )}
        {counts.low > 0 && (
          <div className="bar-fill h-full rounded-sm" style={{ width: `${(counts.low / total) * 100}%`, background: "#06B6D4", animationDelay: "0.15s" }} />
        )}
      </div>
      <span className="text-[9px] text-zinc-600 font-mono tabular-nums">{total} issues</span>
    </div>
  );
}

type FilterType = "all" | "url" | "sast";

export default function Dashboard() {
  const [filter,   setFilter]   = useState<FilterType>("all");
  const [search,   setSearch]   = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading }              = useListQaRuns();
  const { data: stats, isLoading: statsLoading } = useGetQaStats();
  const deleteMutation = useDeleteQaRun();
  const queryClient    = useQueryClient();

  const allRuns     = data?.runs ?? [];
  const runningCount = allRuns.filter(r => r.status === "running" || r.status === "pending").length;

  const runs = useMemo(() => {
    let list = filter === "all" ? allRuns : allRuns.filter(r => r.runType === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.appUrl?.toLowerCase().includes(q) ||
        r.projectName?.toLowerCase().includes(q) ||
        r.appDescription?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allRuns, filter, search]);

  function confirmDelete(id: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation(); setDeleteId(id);
  }

  function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQaRunsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetQaStatsQueryKey() });
        toast.success("Run deleted");
        setDeleteId(null);
      },
      onError: () => { toast.error("Failed to delete"); setDeleteId(null); },
    });
  }

  return (
    <>
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="border-white/10 rounded-2xl" style={{ background: "hsl(230,24%,9%)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-display">Delete this run?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This permanently deletes the test run and its report. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/4 text-white hover:bg-white/8 rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-500 text-white rounded-xl">
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-display font-bold text-white">Dashboard</h1>
              {runningCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 border border-blue-500/25 text-blue-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {runningCount} running
                </span>
              )}
            </div>
            <p className="text-zinc-500 mt-0.5 text-sm">Your security assessments and scan history.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"
              className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9">
              <Link href="/sast"><FileCode2 className="w-3.5 h-3.5 mr-1.5" />SAST Scan</Link>
            </Button>
            <Button asChild size="sm"
              className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl shadow-lg shadow-violet-900/30 h-9">
              <Link href="/new"><Plus className="w-3.5 h-3.5 mr-1.5" />New URL Test</Link>
            </Button>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div variants={CONTAINER} initial="hidden" animate="show" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total Runs"     value={stats?.totalRuns ?? 0}      icon={Activity}     color="#8B5CF6" loading={statsLoading} />
          <StatCard
            label="Avg Score"
            value={(stats?.completedRuns ?? 0) > 0 ? `${stats!.averageScore}` : "—"}
            sub={(stats?.completedRuns ?? 0) > 0 ? "out of 100" : "no completed runs"}
            icon={TrendingUp} color="#10B981" loading={statsLoading}
          />
          <StatCard
            label="Critical Issues"
            value={stats?.criticalIssues ?? 0}
            sub={`${stats?.highIssues ?? 0} high severity`}
            icon={AlertTriangle} color="#EF4444" loading={statsLoading}
          />
          <StatCard
            label="SAST Scans"
            value={stats?.sastRuns ?? 0}
            sub={`${stats?.urlRuns ?? 0} URL tests`}
            icon={ShieldAlert} color="#06B6D4" loading={statsLoading}
          />
        </motion.div>

        {/* Score Trend Chart */}
        {!statsLoading && ((stats as { scoreHistory?: unknown[] } | undefined)?.scoreHistory?.length ?? 0) >= 2 && (
          <motion.div variants={ITEM} initial="hidden" animate="show"
            className="p-5 rounded-2xl border border-white/8"
            style={{ background: "linear-gradient(145deg,hsl(230,22%,7%),hsl(230,22%,6%))" }}>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-violet-400" />
              <p className="text-sm font-display font-semibold text-white">Security Score Trend</p>
              <div className="ml-auto flex items-center gap-1.5">
                {[0.6, 0.4, 0.2].map(o => (
                  <span key={o} className="w-2 h-2 rounded-full bg-violet-500" style={{ opacity: o }} />
                ))}
              </div>
            </div>
            <ScoreTrendChart data={(stats as unknown as { scoreHistory: ScorePoint[] }).scoreHistory} />
          </motion.div>
        )}

        {/* Search + filter */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runs…"
              className="pl-9 h-9 bg-white/4 border-white/10 focus-visible:border-violet-500/40 focus-visible:ring-violet-500/15 rounded-xl text-white placeholder:text-zinc-600 text-sm"
            />
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/4 border border-white/8 w-fit h-9">
            {(["all", "url", "sast"] as FilterType[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={["px-3 py-1 rounded-lg text-xs font-semibold transition-all h-7",
                  filter === f ? "bg-violet-600 text-white shadow-md" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>
                {f === "all"  ? `All (${allRuns.length})`
                  : f === "url"  ? `URL (${allRuns.filter(r => r.runType === "url").length})`
                    : `SAST (${allRuns.filter(r => r.runType === "sast").length})`}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Runs list */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-2xl shimmer" style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : runs.length === 0 ? (
          search || filter !== "all" ? (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 rounded-2xl border border-white/6 bg-white/2">
              <Search className="w-9 h-9 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-base font-display font-bold text-white mb-2">No matching runs</h3>
              <p className="text-zinc-500 text-sm">
                {search ? `No results for "${search}".` : `No ${filter === "url" ? "URL tests" : "SAST scans"} found.`}
              </p>
            </motion.div>
          ) : (
            /* First-run onboarding */
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="text-center pt-8 pb-4">
                <div className="relative w-16 h-16 mx-auto mb-5">
                  <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-xl animate-pulse" />
                  <div className="relative w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                    <ShieldAlert className="w-8 h-8 text-violet-400" />
                  </div>
                </div>
                <h3 className="text-xl font-display font-bold text-white mb-2">Welcome to QA Assistant</h3>
                <p className="text-zinc-500 text-sm max-w-md mx-auto">Your AI-powered security scanner. Run your first assessment to get started — no setup required.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link href="/new">
                  <div className="group p-5 rounded-2xl border border-violet-500/15 bg-violet-500/4 hover:bg-violet-500/8 hover:border-violet-500/25 transition-all cursor-pointer">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                        <Globe className="w-5 h-5 text-violet-400" />
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-white text-sm mb-1">URL Test</h4>
                        <p className="text-zinc-500 text-xs leading-relaxed">Paste a live URL. QA Assistant checks security headers and runs an AI-powered analysis covering security, accessibility, performance, and UX.</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-violet-400 text-xs font-semibold">
                      <Plus className="w-3.5 h-3.5" />Start URL Test
                    </div>
                  </div>
                </Link>
                <Link href="/sast">
                  <div className="group p-5 rounded-2xl border border-cyan-500/15 bg-cyan-500/4 hover:bg-cyan-500/8 hover:border-cyan-500/25 transition-all cursor-pointer">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                        <FileCode2 className="w-5 h-5 text-cyan-400" />
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-white text-sm mb-1">SAST Code Scan</h4>
                        <p className="text-zinc-500 text-xs leading-relaxed">Upload source code files. Detects hardcoded secrets, vulnerable dependencies via OSV.dev CVE database, and deep AI-powered vulnerability analysis.</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-cyan-400 text-xs font-semibold">
                      <Plus className="w-3.5 h-3.5" />Start SAST Scan
                    </div>
                  </div>
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: ShieldAlert,  label: "Secrets Detection", desc: "50+ credential patterns + entropy analysis", color: "#EF4444" },
                  { icon: Activity,     label: "CVE Scanning",       desc: "Dependency vulnerabilities via OSV.dev",    color: "#F97316" },
                  { icon: CheckCircle2, label: "Issue Tracking",     desc: "Mark issues resolved, acknowledged, or won't fix", color: "#10B981" },
                ].map((f, i) => (
                  <div key={i} className="p-4 rounded-2xl border border-white/6 bg-white/2">
                    <f.icon className="w-5 h-5 mb-2" style={{ color: f.color }} />
                    <p className="text-white text-xs font-semibold mb-1">{f.label}</p>
                    <p className="text-zinc-600 text-[11px] leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )
        ) : (
          <motion.div variants={CONTAINER} initial="hidden" animate="show" className="space-y-2">
            <AnimatePresence mode="popLayout">
              {runs.map((run) => {
                const report     = (run as { report?: { overallScore?: number; issues?: Array<{ severity: string }> } }).report;
                const score      = report?.overallScore;
                const issues     = report?.issues ?? [];
                const issueCount = issues.length > 0 ? issues.length : undefined;
                const isUrl      = run.runType === "url";
                const isRunning  = run.status === "running" || run.status === "pending";

                return (
                  <motion.div key={run.id} variants={ITEM} layout exit={{ opacity: 0, x: -16, transition: { duration: 0.2 } }}>
                    <Link href={`/runs/${run.id}`} className="group block">
                      <div className={[
                        "flex items-center gap-4 px-4 py-3.5 rounded-2xl border transition-all duration-200 cursor-pointer",
                        isRunning
                          ? "bg-blue-950/20 border-blue-500/15 hover:border-blue-500/25"
                          : "bg-white/2 border-white/7 hover:bg-white/4 hover:border-white/12",
                      ].join(" ")}>
                        {/* Type icon */}
                        <div className={[
                          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 duration-200",
                          isUrl ? "bg-violet-500/12 border border-violet-500/18" : "bg-cyan-500/12 border border-cyan-500/18",
                        ].join(" ")}>
                          {isUrl
                            ? <Globe className="w-4 h-4 text-violet-400" />
                            : <FileCode2 className="w-4 h-4 text-cyan-400" />}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white text-sm truncate max-w-[280px]">
                              {run.appUrl ?? run.projectName ?? "Unnamed"}
                            </span>
                            <StatusBadge status={run.status as "pending" | "running" | "completed" | "failed"} />
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-zinc-500">
                              {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                            </span>
                            <span className="text-zinc-700">·</span>
                            <span className="text-xs text-zinc-600 capitalize">{isUrl ? "URL Test" : "SAST Scan"}</span>
                            {issueCount !== undefined && (
                              <>
                                <span className="text-zinc-700">·</span>
                                <span className="text-xs text-zinc-500">{issueCount} issue{issueCount !== 1 ? "s" : ""}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Severity bar */}
                        {run.status === "completed" && issues.length > 0 && (
                          <SeverityBar issues={issues} />
                        )}

                        {/* Score */}
                        {score !== undefined && (
                          <div className="text-right shrink-0 hidden sm:block">
                            <div className="text-lg font-display font-bold" style={{ color: scoreColor(score) }}>{score}</div>
                            <div className="text-[10px] text-zinc-600 uppercase tracking-widest">/ 100</div>
                          </div>
                        )}

                        {run.status === "completed" && score !== undefined && (
                          <div className="shrink-0 hidden md:flex">
                            {score >= 80
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              : <AlertTriangle className={`w-4 h-4 ${score >= 60 ? "text-amber-500" : "text-red-500"}`} />}
                          </div>
                        )}

                        {/* Delete */}
                        <button
                          onClick={(e) => confirmDelete(run.id, e)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                          title="Delete run"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </>
  );
}
