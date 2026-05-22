import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Home, Search, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4"
      style={{ background: "hsl(230,25%,5%)" }}
    >
      <div className="relative w-full max-w-lg text-center">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-violet-600/[0.07] rounded-full blur-[120px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 flex flex-col items-center gap-6"
        >
          {/* 404 number */}
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/15 rounded-3xl blur-2xl animate-pulse" />
            <div
              className="relative px-8 py-5 rounded-3xl border"
              style={{ background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.2)" }}
            >
              <span
                className="font-display font-bold text-8xl tabular-nums"
                style={{
                  background: "linear-gradient(135deg, hsl(258,85%,70%), hsl(190,88%,55%))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                404
              </span>
            </div>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <h1 className="font-display font-bold text-2xl text-white">Page not found</h1>
            <p className="text-zinc-400 text-sm max-w-xs mx-auto leading-relaxed">
              The page you're looking for doesn't exist or may have been moved.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link href="/">
              <Button
                className="gap-2 rounded-xl h-10 px-5 font-medium"
                style={{ background: "hsl(258,85%,64%)" }}
              >
                <Home className="w-4 h-4" /> Go to Dashboard
              </Button>
            </Link>
            <Button
              variant="outline"
              className="gap-2 rounded-xl h-10 px-5 font-medium border-white/10 bg-white/4 hover:bg-white/7 text-white"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-4 h-4" /> Go back
            </Button>
          </div>

          {/* Hint */}
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs text-zinc-500"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <Search className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
            <span>Press <kbd className="font-mono bg-white/6 border border-white/8 rounded px-1 py-0.5 text-zinc-400">⌘K</kbd> to search across all pages and scans</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
