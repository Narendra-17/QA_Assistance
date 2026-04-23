import { useListQaRuns, useDeleteQaRun, getListQaRunsQueryKey, getGetQaStatsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Plus, Trash2, ExternalLink, Globe, FileCode2, AlertTriangle, TrendingUp, Activity, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { useGetQaStats } from "@workspace/api-client-react";

const CONTAINER: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const ITEM: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 280 } },
};

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <motion.div variants={ITEM} className="stat-card p-5 flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <div className="text-2xl font-display font-bold text-white">{value}</div>
        <div className="text-sm text-zinc-400 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
      </div>
    </motion.div>
  );
}

type FilterType = "all" | "url" | "sast";

export default function Dashboard() {
  const [filter, setFilter] = useState<FilterType>("all");
  const { data, isLoading } = useListQaRuns();
  const { data: stats } = useGetQaStats();
  const deleteMutation = useDeleteQaRun();
  const queryClient = useQueryClient();

  const allRuns = data?.runs ?? [];
  const runs = filter === "all" ? allRuns : allRuns.filter(r => r.runType === filter);

  function handleDelete(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQaRunsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetQaStatsQueryKey() });
        toast.success("Test run deleted");
      },
      onError: () => toast.error("Failed to delete"),
    });
  }

  const scoreColor = (s: number) =>
    s >= 80 ? "#10B981" : s >= 60 ? "#F59E0B" : s >= 40 ? "#F97316" : "#EF4444";

  return (
    <div className="max-w-6xl mx-auto w-full space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Dashboard</h1>
          <p className="text-zinc-500 mt-1 text-sm">Monitor your security assessments and test results.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl">
            <Link href="/sast"><FileCode2 className="w-4 h-4 mr-1.5" />SAST Scan</Link>
          </Button>
          <Button asChild className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl shadow-lg shadow-violet-900/30">
            <Link href="/new"><Plus className="w-4 h-4 mr-1.5" />New URL Test</Link>
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      {stats && (
        <motion.div variants={CONTAINER} initial="hidden" animate="show"
          className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Runs" value={stats.totalRuns} icon={Activity} color="#8B5CF6" />
          <StatCard label="Avg Score" value={stats.completedRuns > 0 ? `${stats.averageScore}/100` : "—"} icon={TrendingUp} color="#10B981"
            sub={`${stats.completedRuns} completed`} />
          <StatCard label="Critical Issues" value={stats.criticalIssues} icon={AlertTriangle} color="#EF4444"
            sub={`+ ${stats.highIssues} high`} />
          <StatCard label="SAST Scans" value={stats.sastRuns ?? 0} icon={FileCode2} color="#06B6D4"
            sub={`${stats.urlRuns ?? 0} URL tests`} />
        </motion.div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/4 border border-white/8 w-fit">
        {(["all", "url", "sast"] as FilterType[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={[
              "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
              filter === f ? "bg-violet-600 text-white shadow-md" : "text-zinc-400 hover:text-zinc-200",
            ].join(" ")}>
            {f === "all" ? "All Runs" : f === "url" ? "🌐 URL Tests" : "📂 SAST Scans"}
          </button>
        ))}
      </div>

      {/* Runs list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl shimmer" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="text-center py-24 glass-card">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
            <Activity className="w-8 h-8 text-violet-400" />
          </div>
          <h3 className="text-xl font-display font-bold text-white mb-2">No test runs yet</h3>
          <p className="text-zinc-500 mb-6 text-sm max-w-xs mx-auto">
            {filter !== "all" ? `No ${filter === "url" ? "URL tests" : "SAST scans"} found.` : "Start your first security assessment."}
          </p>
          <div className="flex gap-3 justify-center">
            <Button asChild variant="outline" className="border-white/10 hover:bg-white/8 text-white rounded-xl">
              <Link href="/sast"><FileCode2 className="w-4 h-4 mr-1.5" />SAST Scan</Link>
            </Button>
            <Button asChild className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl">
              <Link href="/new"><Plus className="w-4 h-4 mr-1.5" />URL Test</Link>
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div variants={CONTAINER} initial="hidden" animate="show" className="space-y-3">
          <AnimatePresence>
            {runs.map((run) => {
              const report = (run as { report?: { overallScore?: number } }).report;
              const score = report?.overallScore;
              const isUrl = run.runType === "url";

              return (
                <motion.div key={run.id} variants={ITEM} layout exit={{ opacity: 0, x: -20 }}>
                  <Link href={`/runs/${run.id}`}
                    className="group flex items-center gap-4 px-5 py-4 rounded-2xl bg-white/3 border border-white/8 hover:bg-white/5 hover:border-white/14 transition-all cursor-pointer block">
                    {/* Type icon */}
                    <div className={[
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      isUrl ? "bg-violet-500/12 border border-violet-500/20" : "bg-cyan-500/12 border border-cyan-500/20",
                    ].join(" ")}>
                      {isUrl
                        ? <Globe className="w-5 h-5 text-violet-400" />
                        : <FileCode2 className="w-5 h-5 text-cyan-400" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm truncate max-w-xs">
                          {run.appUrl ?? run.projectName ?? "Unnamed"}
                        </span>
                        <StatusBadge status={run.status as "pending" | "running" | "completed" | "failed"} />
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-3">
                        <span>{format(new Date(run.createdAt), "MMM d, yyyy · h:mm a")}</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-white/5 text-zinc-400">{isUrl ? "URL Test" : "SAST Scan"}</span>
                      </div>
                    </div>

                    {/* Score */}
                    {score !== undefined && (
                      <div className="text-right shrink-0">
                        <div className="text-xl font-display font-bold" style={{ color: scoreColor(score) }}>{score}</div>
                        <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Score</div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleDelete(run.id, e)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-all">
                        <ExternalLink className="w-4 h-4" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
