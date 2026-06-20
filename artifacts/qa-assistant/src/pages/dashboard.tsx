import {
  useListQaRuns, useDeleteQaRun,
  getListQaRunsQueryKey, getGetQaStatsQueryKey, useGetQaStats,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus, Trash2, Globe, FileCode2, AlertTriangle, TrendingUp,
  Activity, Loader2, Search, ShieldAlert, CheckCircle2, RotateCcw,
  ArrowUpDown, Star, Download, SquareCheck, Square, RotateCw, X,
  ChevronDown,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CONTAINER: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const ITEM: Variants = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 26 } },
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

// ── Live elapsed timer ────────────────────────────────────────────────────────
function useLiveElapsed(startedAt: string, active: boolean) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!active) { setElapsed(""); return; }
    function compute() {
      const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setElapsed(m > 0 ? `${m}m ${s < 10 ? "0" : ""}${s}s` : `${s}s`);
    }
    compute();
    const t = setInterval(compute, 1000);
    return () => clearInterval(t);
  }, [active, startedAt]);
  return elapsed;
}

function LiveElapsed({ startedAt }: { startedAt: string }) {
  const elapsed = useLiveElapsed(startedAt, true);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-blue-300 font-mono tabular-nums">
      <span className="relative w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0">
        <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-60" />
      </span>
      {elapsed}
    </span>
  );
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
            <span className="font-display font-bold text-2xl tabular-nums value-pop" style={{ color: scoreColor(last.score) }}>{last.score}</span>
            <span className="text-zinc-500 text-sm">latest score</span>
          </div>
        )}
        {Math.abs(delta) > 0 && (
          <span className={[
            "text-xs font-bold px-2.5 py-1 rounded-lg border",
            delta > 0
              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/22"
              : "text-red-400 bg-red-500/10 border-red-500/22",
          ].join(" ")}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} pts vs first run
          </span>
        )}
        <span className="text-zinc-600 text-[11px] ml-auto font-mono">{data.length} run{data.length !== 1 ? "s" : ""}</span>
      </div>
      <ResponsiveContainer width="100%" height={112}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="#8B5CF6" stopOpacity={0.28} />
              <stop offset="60%" stopColor="#8B5CF6" stopOpacity={0.07} />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#52525b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#52525b" }} axisLine={false} tickLine={false} ticks={[0, 50, 100]} />
          <Tooltip
            contentStyle={{
              background: "hsl(230,24%,9%)",
              border: "1px solid rgba(139,92,246,0.2)",
              borderRadius: 12,
              fontSize: 11,
              padding: "8px 12px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
            cursor={{ stroke: "rgba(139,92,246,0.3)", strokeWidth: 1, strokeDasharray: "4 2" }}
            formatter={(val: number, _: string, props: { payload?: { label?: string } }) => [
              <span key="v" style={{ color: scoreColor(val), fontWeight: 700 }}>{val}/100</span>,
              props.payload?.label ?? "",
            ]}
          />
          <Area type="monotone" dataKey="score" stroke="#8B5CF6" strokeWidth={2} fill="url(#scoreGrad)"
            dot={(props: { cx?: number; cy?: number; payload?: { score: number }; index?: number }) => (
              <circle key={props.index} cx={props.cx} cy={props.cy} r={3.5}
                fill={scoreColor(props.payload?.score ?? 0)}
                stroke="hsl(230,25%,5%)"
                strokeWidth={1.5}
              />
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
      className="group relative overflow-hidden rounded-2xl p-5 flex items-start gap-4 transition-all duration-250 cursor-default"
      style={{
        background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
    >
      <div className="absolute top-0 left-4 right-4 h-px transition-all duration-300"
        style={{ background: `linear-gradient(90deg, transparent, ${color}60, transparent)` }} />

      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-400 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 0% 0%, ${color}0D 0%, transparent 65%)` }} />

      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 relative z-10 transition-all duration-200 group-hover:scale-110"
        style={{ background: `${color}16`, border: `1px solid ${color}28`, boxShadow: `0 0 12px ${color}18` }}
      >
        <Icon className="w-5 h-5" style={{ color }} />
      </div>

      <div className="relative z-10 min-w-0 flex-1">
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

      <div className="absolute bottom-0 right-0 w-16 h-16 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: `radial-gradient(circle at 100% 100%, ${color}08, transparent 70%)` }} />
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
      <div className="flex h-1.5 w-16 rounded-full overflow-hidden gap-[1.5px] bg-white/5">
        {counts.critical > 0 && (
          <div className="bar-fill h-full rounded-sm" style={{ width: `${(counts.critical / total) * 100}%`, background: "linear-gradient(90deg,#EF4444,#DC2626)" }} />
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

// ── OWASP heatmap ─────────────────────────────────────────────────────────────
const OWASP_NAMES: Record<string, string> = {
  A01: "Broken Access Control",      A02: "Cryptographic Failures",
  A03: "Injection",                  A04: "Insecure Design",
  A05: "Security Misconfiguration",  A06: "Vulnerable Components",
  A07: "Auth Failures",              A08: "Integrity Failures",
  A09: "Logging Failures",           A10: "SSRF",
};

function OwaspHeatmap({ breakdown }: { breakdown: Array<{ code: string; count: number; critical: number }> }) {
  if (breakdown.length === 0) return null;
  const maxCount = Math.max(...breakdown.map(d => d.count), 1);

  return (
    <div className="space-y-2">
      {breakdown.map(({ code, count, critical }, idx) => {
        const name      = OWASP_NAMES[code] ?? code;
        const critRatio = critical / count;
        const barColor  = critRatio >= 0.5 ? "#EF4444" : critRatio >= 0.2 ? "#F97316" : "#F59E0B";
        const pct       = (count / maxCount) * 100;
        return (
          <motion.div
            key={code}
            className="flex items-center gap-3 group"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.3 }}
          >
            <div className="w-[4.5rem] shrink-0 text-right">
              <span className="text-[10px] font-mono font-semibold text-zinc-500 group-hover:text-zinc-300 transition-colors">{code}</span>
            </div>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div
                  className="bar-fill h-full rounded-full"
                  style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}, ${barColor}AA)` }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums w-5 text-right shrink-0" style={{ color: barColor }}>{count}</span>
            </div>
            <span className="text-[11px] text-zinc-500 group-hover:text-zinc-400 transition-colors w-44 shrink-0 truncate hidden lg:block">{name}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

type FilterType = "all" | "url" | "sast";

interface QaRunExtended {
  id: string; userId: string; appUrl?: string | null; appDescription?: string | null;
  projectName?: string | null; status: string; runType: string; errorMessage?: string | null;
  createdAt: string; updatedAt: string;
  score?: number | null;
  pinned?: boolean | null;
  issues?: Array<{ severity: string }> | null;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── API helpers ───────────────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiPatch(path: string) {
  const r = await fetch(`${BASE}${path}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" } });
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Request failed"); }
  return r.json() as Promise<Record<string, unknown>>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Request failed"); }
  return r.json() as Promise<T>;
}

export default function Dashboard() {
  usePageTitle("Dashboard");
  const [filter,      setFilter]      = useState<FilterType>("all");
  const [search,      setSearch]      = useState("");
  const [sortBy,      setSortBy]      = useState<"newest" | "oldest" | "score-desc" | "score-asc">("newest");
  const [deleteId,    setDeleteId]    = useState<string | null>(null);
  const [selectMode,  setSelectMode]  = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDelConfirm, setBulkDelConfirm] = useState(false);
  const [pinningId,   setPinningId]   = useState<string | null>(null);
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [, setLocation] = useLocation();

  const { data, isLoading, refetch }                           = useListQaRuns();
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useGetQaStats();
  const deleteMutation = useDeleteQaRun();
  const queryClient    = useQueryClient();

  const allRuns      = (data?.runs ?? []) as QaRunExtended[];
  const runningCount = allRuns.filter(r => r.status === "running" || r.status === "pending").length;

  useEffect(() => {
    if (runningCount === 0) return;
    const t = setInterval(() => { void refetch(); void refetchStats(); }, 3000);
    return () => clearInterval(t);
  }, [runningCount, refetch, refetchStats]);

  // Exit select mode when no runs
  useEffect(() => {
    if (allRuns.length === 0) { setSelectMode(false); setSelectedIds(new Set()); }
  }, [allRuns.length]);

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
    list = [...list].sort((a, b) => {
      // Pinned runs always float to top
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (sortBy === "oldest")     return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === "score-desc") return (b.score ?? -1) - (a.score ?? -1);
      if (sortBy === "score-asc")  return (a.score ?? 101) - (b.score ?? 101);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return list;
  }, [allRuns, filter, search, sortBy]);

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

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await apiPost<{ deleted: number }>("/api/qa/bulk-delete", { ids: [...selectedIds] });
      queryClient.invalidateQueries({ queryKey: getListQaRunsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetQaStatsQueryKey() });
      toast.success(`Deleted ${res.deleted} run${res.deleted !== 1 ? "s" : ""}`);
      exitSelectMode();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed");
    } finally {
      setBulkDeleting(false);
      setBulkDelConfirm(false);
    }
  }

  async function handlePin(id: string, e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    if (pinningId === id) return;
    setPinningId(id);
    try {
      const res = await apiPatch(`/api/qa/runs/${id}/pin`);
      queryClient.setQueryData(getListQaRunsQueryKey(), (old: { runs: QaRunExtended[] } | undefined) => {
        if (!old) return old;
        return { ...old, runs: old.runs.map(r => r.id === id ? { ...r, pinned: res.pinned } : r) };
      });
      toast.success((res.pinned as boolean) ? "Run pinned" : "Run unpinned");
    } catch {
      toast.error("Failed to update pin");
    } finally {
      setPinningId(null);
    }
  }

  async function handleRescan(id: string, e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    if (rescanningId) return;
    setRescanningId(id);
    try {
      const newRun = await apiPost<{ id: string }>(`/api/qa/runs/${id}/rescan`);
      queryClient.invalidateQueries({ queryKey: getListQaRunsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetQaStatsQueryKey() });
      toast.success("Re-scan started!");
      setLocation(`/runs/${newRun.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-scan failed");
    } finally {
      setRescanningId(null);
    }
  }

  function exportCsv() {
    const header = ["ID", "Type", "Target", "Status", "Score", "Issues", "Pinned", "Created At"];
    const rows   = runs.map(r => [
      r.id,
      r.runType.toUpperCase(),
      r.appUrl ?? r.projectName ?? "",
      r.status,
      r.score != null ? String(r.score) : "",
      r.issues ? String(r.issues.length) : "",
      r.pinned ? "Yes" : "No",
      new Date(r.createdAt).toISOString(),
    ]);
    downloadCsv([header, ...rows], `qa-runs-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success("Runs exported as CSV");
  }

  const allVisibleSelected = runs.length > 0 && runs.every(r => selectedIds.has(r.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(runs.map(r => r.id)));
    }
  }

  return (
    <>
      {/* Single delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent
          className="border-white/8 rounded-2xl overflow-hidden"
          style={{ background: "hsl(230,24%,9%)", boxShadow: "0 32px 80px rgba(0,0,0,0.5)" }}
        >
          <div className="absolute top-0 inset-x-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.5), transparent)" }} />
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-display">Delete this run?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This permanently deletes the test run and its report. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/4 text-white hover:bg-white/8 rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all"
              style={{ boxShadow: "0 4px 16px rgba(239,68,68,0.3)" }}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirm dialog */}
      <AlertDialog open={bulkDelConfirm} onOpenChange={(o) => !o && setBulkDelConfirm(false)}>
        <AlertDialogContent
          className="border-white/8 rounded-2xl overflow-hidden"
          style={{ background: "hsl(230,24%,9%)", boxShadow: "0 32px 80px rgba(0,0,0,0.5)" }}
        >
          <div className="absolute top-0 inset-x-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.5), transparent)" }} />
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-display">
              Delete {selectedIds.size} run{selectedIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This permanently removes the selected runs and their reports. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/4 text-white hover:bg-white/8 rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all"
              style={{ boxShadow: "0 4px 16px rgba(239,68,68,0.3)" }}
            >
              {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : `Delete ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-5xl mx-auto w-full space-y-6">
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-display font-bold text-white">Dashboard</h1>
              <AnimatePresence>
                {runningCount > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/12 border border-blue-500/25 text-blue-300 badge-pulse"
                  >
                    <span className="relative w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0">
                      <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-60" />
                    </span>
                    {runningCount} running
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <p className="text-zinc-500 mt-0.5 text-sm">Your security assessments and scan history.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Export CSV */}
            {allRuns.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportCsv}
                className="border-white/10 bg-white/3 hover:bg-white/7 hover:border-emerald-500/25 text-zinc-400 hover:text-emerald-300 rounded-xl h-9 transition-all gap-1.5">
                <Download className="w-3.5 h-3.5" />Export CSV
              </Button>
            )}
            {/* Select mode toggle */}
            {allRuns.length > 0 && (
              <Button variant="outline" size="sm"
                onClick={() => { setSelectMode(v => !v); if (selectMode) setSelectedIds(new Set()); }}
                className={[
                  "border-white/10 bg-white/3 rounded-xl h-9 transition-all gap-1.5",
                  selectMode ? "border-violet-500/40 bg-violet-500/10 text-violet-300" : "text-zinc-400 hover:bg-white/7 hover:text-zinc-200",
                ].join(" ")}>
                {selectMode ? <><X className="w-3.5 h-3.5" />Cancel</> : <><SquareCheck className="w-3.5 h-3.5" />Select</>}
              </Button>
            )}
            <Button asChild variant="outline" size="sm"
              className="border-white/10 bg-white/3 hover:bg-white/7 hover:border-cyan-500/25 text-zinc-300 hover:text-cyan-300 rounded-xl h-9 transition-all gap-1.5">
              <Link href="/sast"><FileCode2 className="w-3.5 h-3.5" />SAST Scan</Link>
            </Button>
            <Button asChild size="sm"
              className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-9 btn-shimmer gap-1.5 transition-all"
              style={{ boxShadow: "0 4px 16px rgba(139,92,246,0.35)" }}>
              <Link href="/new"><Plus className="w-3.5 h-3.5" />New URL Test</Link>
            </Button>
          </div>
        </motion.div>

        {/* ── Stats grid ── */}
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

        {/* ── Score trend + OWASP breakdown ── */}
        {!statsLoading && (() => {
          const history  = (stats as unknown as { scoreHistory?: ScorePoint[]; owaspBreakdown?: Array<{ code: string; count: number; critical: number }> } | undefined);
          const hasChart = (history?.scoreHistory?.length ?? 0) >= 2;
          const owasp    = history?.owaspBreakdown ?? [];
          if (!hasChart && owasp.length === 0) return null;
          return (
            <div className={["grid gap-4", hasChart && owasp.length > 0 ? "lg:grid-cols-2" : "grid-cols-1"].join(" ")}>
              {hasChart && (
                <motion.div
                  variants={ITEM} initial="hidden" animate="show"
                  className="p-5 rounded-2xl relative overflow-hidden"
                  style={{
                    background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
                    border: "1px solid rgba(139,92,246,0.12)",
                  }}
                >
                  <div className="absolute top-0 inset-x-0 h-px"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.35), transparent)" }} />
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/14 border border-violet-500/20 flex items-center justify-center">
                      <TrendingUp className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                    <p className="text-sm font-display font-semibold text-white">Security Score Trend</p>
                    <div className="ml-auto flex items-center gap-1">
                      {[0.7, 0.4, 0.2].map(o => (
                        <span key={o} className="w-1.5 h-1.5 rounded-full bg-violet-500" style={{ opacity: o }} />
                      ))}
                    </div>
                  </div>
                  <ScoreTrendChart data={history!.scoreHistory!} />
                </motion.div>
              )}
              {owasp.length > 0 && (
                <motion.div
                  variants={ITEM} initial="hidden" animate="show"
                  className="p-5 rounded-2xl relative overflow-hidden"
                  style={{
                    background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
                    border: "1px solid rgba(245,158,11,0.12)",
                  }}
                >
                  <div className="absolute top-0 inset-x-0 h-px"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.35), transparent)" }} />
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/12 border border-amber-500/20 flex items-center justify-center">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <p className="text-sm font-display font-semibold text-white">Top Vulnerability Categories</p>
                    <span className="ml-auto text-[10px] text-zinc-600 font-mono">OWASP Top 10</span>
                  </div>
                  <OwaspHeatmap breakdown={owasp} />
                </motion.div>
              )}
            </div>
          );
        })()}

        {/* ── Bulk action bar (shown when items are selected) ── */}
        <AnimatePresence>
          {selectMode && selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-violet-500/25"
              style={{ background: "rgba(139,92,246,0.07)" }}
            >
              <span className="text-sm font-semibold text-violet-300">
                {selectedIds.size} run{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={exitSelectMode}
                className="border-white/10 bg-white/4 text-zinc-400 hover:text-zinc-200 rounded-xl h-8 text-xs gap-1">
                <X className="w-3 h-3" />Clear
              </Button>
              <Button size="sm"
                onClick={() => setBulkDelConfirm(true)}
                className="bg-red-600/80 hover:bg-red-600 text-white rounded-xl h-8 text-xs gap-1.5"
                style={{ boxShadow: "0 2px 12px rgba(239,68,68,0.25)" }}>
                <Trash2 className="w-3.5 h-3.5" />
                Delete {selectedIds.size}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Search + filter + sort ── */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="flex flex-col sm:flex-row gap-3 flex-wrap">
          {/* Select all checkbox (in select mode) */}
          {selectMode && runs.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 px-3 h-9 rounded-xl border border-white/8 bg-white/3 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {allVisibleSelected
                ? <SquareCheck className="w-4 h-4 text-violet-400" />
                : <Square className="w-4 h-4" />}
              {allVisibleSelected ? "Deselect all" : "Select all"}
            </button>
          )}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runs…"
              className="pl-9 h-9 bg-white/[0.03] border-white/8 focus-visible:border-violet-500/35 focus-visible:ring-0 rounded-xl text-white placeholder:text-zinc-600 text-sm transition-all"
              style={{ outline: "none" }}
            />
          </div>
          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl w-fit h-9 relative"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            {(["all", "url", "sast"] as FilterType[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                aria-label={f === "all" ? "Show all runs" : f === "url" ? "Show URL tests only" : "Show SAST scans only"}
                aria-pressed={filter === f}
                className={[
                  "relative px-3 py-1 rounded-lg text-xs font-semibold transition-all h-7",
                  filter === f ? "text-white" : "text-zinc-500 hover:text-zinc-300",
                ].join(" ")}
                style={filter === f ? {
                  background: "linear-gradient(135deg, hsl(258,85%,58%), hsl(258,80%,50%))",
                  boxShadow: "0 2px 10px rgba(139,92,246,0.3)",
                } : {}}
              >
                {f === "all"  ? `All (${allRuns.length})`
                  : f === "url"  ? `URL (${allRuns.filter(r => r.runType === "url").length})`
                    : `SAST (${allRuns.filter(r => r.runType === "sast").length})`}
              </button>
            ))}
          </div>
          {/* Sort dropdown */}
          <div className="relative h-9 flex items-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <ArrowUpDown className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              aria-label="Sort runs"
              className="appearance-none bg-transparent text-zinc-400 text-xs font-medium pl-8 pr-4 h-full focus:outline-none cursor-pointer hover:text-zinc-200 transition-colors"
              style={{ colorScheme: "dark" }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="score-desc">Highest score</option>
              <option value="score-asc">Lowest score</option>
            </select>
          </div>
        </motion.div>

        {/* ── Runs list ── */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[72px] rounded-2xl shimmer" style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : runs.length === 0 ? (
          search || filter !== "all" ? (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Search className="w-9 h-9 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-base font-display font-bold text-white mb-2">No matching runs</h3>
              <p className="text-zinc-500 text-sm">
                {search ? `No results for "${search}".` : `No ${filter === "url" ? "URL tests" : "SAST scans"} found.`}
              </p>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="text-center pt-8 pb-4">
                <div className="relative w-16 h-16 mx-auto mb-5">
                  <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-xl animate-pulse" />
                  <div className="relative w-16 h-16 rounded-2xl bg-violet-500/12 border border-violet-500/22 flex items-center justify-center">
                    <ShieldAlert className="w-8 h-8 text-violet-400" />
                  </div>
                </div>
                <h3 className="font-display font-bold text-lg text-white mb-1.5">Run your first assessment</h3>
                <p className="text-zinc-500 text-sm max-w-sm mx-auto">
                  Get an AI-powered security report in under 30 seconds — test a live URL or scan source code.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                {[
                  { href: "/new",  Icon: Globe,     color: "#8B5CF6", label: "Test a live URL",    sub: "Security headers, XSS, perf",   bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.2)"  },
                  { href: "/sast", Icon: FileCode2, color: "#06B6D4", label: "Scan source code",   sub: "SQL injection, secrets, IaC",    bg: "rgba(6,182,212,0.08)",   border: "rgba(6,182,212,0.2)"   },
                ].map(({ href, Icon, color, label, sub, bg, border }) => (
                  <Link key={href} href={href}>
                    <div
                      className="flex items-center gap-3.5 p-4 rounded-2xl cursor-pointer transition-all duration-200 group hover:-translate-y-0.5"
                      style={{ background: bg, border: `1px solid ${border}` }}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                        style={{ background: `${color}22`, border: `1px solid ${color}30` }}>
                        <Icon className="w-5 h-5" style={{ color }} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{label}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </motion.div>
          )
        ) : (
          <motion.div variants={CONTAINER} initial="hidden" animate="show" className="space-y-2">
            <AnimatePresence>
              {runs.map((run) => {
                const isUrl      = run.runType === "url";
                const isRunning  = run.status === "running" || run.status === "pending";
                const label      = run.appUrl ?? run.projectName ?? "Unnamed scan";
                const hasScore   = run.status === "completed" && run.score != null;
                const score      = run.score ?? 0;
                const isSelected = selectedIds.has(run.id);
                const isPinned   = !!run.pinned;
                const isRescanning = rescanningId === run.id;

                return (
                  <motion.div key={run.id} variants={ITEM} layout exit={{ opacity: 0, scale: 0.97 }}>
                    <div
                      onClick={() => selectMode ? setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(run.id)) next.delete(run.id); else next.add(run.id);
                        return next;
                      }) : setLocation(`/runs/${run.id}`)}
                      className="group flex items-center gap-4 px-4 py-3.5 rounded-2xl cursor-pointer transition-all duration-200 relative overflow-hidden"
                      style={{
                        background: isSelected
                          ? "linear-gradient(135deg, hsl(258,30%,11%), hsl(258,25%,10%))"
                          : "linear-gradient(135deg, hsl(230,22%,8%), hsl(230,22%,7.5%))",
                        border: isSelected
                          ? "1px solid rgba(139,92,246,0.35)"
                          : isPinned
                            ? "1px solid rgba(245,158,11,0.18)"
                            : "1px solid rgba(255,255,255,0.06)",
                      }}
                      onMouseEnter={e => {
                        if (isSelected) return;
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.2)";
                        (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, hsl(230,22%,9%), hsl(230,22%,8%))";
                      }}
                      onMouseLeave={e => {
                        if (isSelected) return;
                        (e.currentTarget as HTMLElement).style.borderColor = isPinned ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.06)";
                        (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, hsl(230,22%,8%), hsl(230,22%,7.5%))";
                      }}
                    >
                      {/* Left accent line on hover */}
                      <div className="absolute left-0 top-[20%] bottom-[20%] w-0.5 rounded-r-full opacity-0 group-hover:opacity-100 transition-all duration-200"
                        style={{ background: isUrl ? "rgba(139,92,246,0.7)" : "rgba(6,182,212,0.7)" }} />

                      {/* Checkbox (select mode) OR Type icon */}
                      {selectMode ? (
                        <div onClick={(e) => toggleSelect(run.id, e)}
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all border"
                          style={isSelected
                            ? { background: "rgba(139,92,246,0.25)", borderColor: "rgba(139,92,246,0.5)" }
                            : { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)" }}>
                          {isSelected
                            ? <SquareCheck className="w-4.5 h-4.5 text-violet-400" />
                            : <Square className="w-4.5 h-4.5 text-zinc-600" />}
                        </div>
                      ) : (
                        <div className={[
                          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105",
                          isUrl ? "bg-violet-500/12 border border-violet-500/18" : "bg-cyan-500/12 border border-cyan-500/18",
                        ].join(" ")}>
                          {isUrl
                            ? <Globe     className="w-4 h-4 text-violet-400" />
                            : <FileCode2 className="w-4 h-4 text-cyan-400" />}
                        </div>
                      )}

                      {/* Label + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white group-hover:text-violet-100 transition-colors truncate">{label}</span>
                          {isPinned && !selectMode && (
                            <Star className="w-3 h-3 text-amber-400 shrink-0 fill-amber-400" />
                          )}
                          {isRunning && <LiveElapsed startedAt={run.createdAt} />}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-zinc-600">
                            {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                          </span>
                          <span className="text-zinc-700">·</span>
                          <span className="text-[11px] text-zinc-600 font-mono uppercase">{run.runType}</span>
                        </div>
                      </div>

                      {/* Severity bar */}
                      {run.issues && <SeverityBar issues={run.issues} />}

                      {/* Score badge */}
                      {hasScore && (
                        <div className="shrink-0 hidden sm:flex">
                          <div
                            className="text-xs font-bold font-mono tabular-nums px-2.5 py-1 rounded-lg border"
                            style={{
                              color: scoreColor(score),
                              background: `${scoreColor(score)}14`,
                              borderColor: `${scoreColor(score)}25`,
                            }}
                          >
                            {score}/100
                          </div>
                        </div>
                      )}

                      {/* Status badge */}
                      <StatusBadge status={run.status as "pending" | "running" | "completed" | "failed"} />

                      {/* Action buttons (hidden in select mode) */}
                      {!selectMode && (
                        <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-all">
                          {/* Pin button */}
                          <button
                            onClick={(e) => handlePin(run.id, e)}
                            className={[
                              "p-1.5 rounded-lg transition-all",
                              isPinned
                                ? "text-amber-400 hover:bg-amber-500/10"
                                : "text-zinc-700 hover:text-amber-400 hover:bg-amber-500/8",
                            ].join(" ")}
                            title={isPinned ? "Unpin" : "Pin to top"}
                          >
                            {pinningId === run.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Star className={["w-3.5 h-3.5", isPinned ? "fill-amber-400" : ""].join(" ")} />}
                          </button>

                          {/* Re-scan button (URL only) */}
                          {run.runType === "url" && run.status === "completed" && (
                            <button
                              onClick={(e) => handleRescan(run.id, e)}
                              className="p-1.5 rounded-lg text-zinc-700 hover:text-cyan-400 transition-all hover:bg-cyan-500/8"
                              title="Re-scan with same URL"
                            >
                              {isRescanning
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                                : <RotateCw className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {/* Delete button */}
                          <button
                            onClick={(e) => confirmDelete(run.id, e)}
                            className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400 transition-all hover:bg-red-500/8"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Refresh hint */}
        {!isLoading && allRuns.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="flex justify-center">
            <button
              onClick={() => { void refetch(); void refetchStats(); }}
              className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/4"
            >
              <RotateCcw className="w-3 h-3" />
              Refresh
            </button>
          </motion.div>
        )}
      </div>
    </>
  );
}
