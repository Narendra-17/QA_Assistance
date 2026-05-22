import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

interface Props  { children: ReactNode; label?: string }
interface State  { hasError: boolean; error?: Error }

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center min-h-[420px] gap-6 px-4">
        <div className="relative">
          <div className="absolute inset-0 bg-red-500/15 rounded-2xl blur-xl animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
        </div>

        <div className="text-center max-w-sm">
          <h2 className="font-display font-bold text-lg text-white mb-1.5">
            {this.props.label ?? "Page"} failed to load
          </h2>
          <p className="text-zinc-500 text-sm leading-relaxed">
            {this.state.error?.message ?? "An unexpected error occurred while rendering this page."}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2 h-9 rounded-xl border-white/10 bg-white/4 hover:bg-white/7 text-white text-sm"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Go back
          </Button>
          <Button
            className="gap-2 h-9 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-sm"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </Button>
        </div>
      </div>
    );
  }
}
