import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "pending" | "running" | "completed" | "failed";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className={cn("bg-muted/50 text-muted-foreground border-muted", className)}>
          Pending
        </Badge>
      );
    case "running":
      return (
        <Badge variant="secondary" className={cn("bg-primary/20 text-primary border-primary/30", className)}>
          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="default" className={cn("bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20", className)}>
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className={cn("bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/20", className)}>
          Failed
        </Badge>
      );
    default:
      return null;
  }
}
