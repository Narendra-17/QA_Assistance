import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

interface StatusBadgeProps {
  status: "pending" | "running" | "completed" | "failed";
  className?: string;
}

const CONFIG = {
  pending:   { label: "Pending",   icon: Clock,        color: "text-zinc-400",   bg: "bg-zinc-500/10 border-zinc-500/20" },
  running:   { label: "Running",   icon: Loader2,       color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  completed: { label: "Completed", icon: CheckCircle2,  color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20" },
  failed:    { label: "Failed",    icon: XCircle,       color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, icon: Icon, color, bg } = CONFIG[status] ?? CONFIG.pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", bg, color, className)}>
      <Icon className={cn("w-3.5 h-3.5 shrink-0", status === "running" && "animate-spin")} />
      {label}
    </span>
  );
}
