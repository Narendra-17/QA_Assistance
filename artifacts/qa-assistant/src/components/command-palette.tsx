import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, LayoutDashboard, Globe, FileCode2, Zap, ArrowRight,
  X, CheckCircle2, AlertCircle, Loader2, Clock, Settings,
} from "lucide-react";
import { useListQaRuns } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { title: "Dashboard",          path: "/",            icon: LayoutDashboard, desc: "View all runs and statistics" },
  { title: "New URL Test",       path: "/new",         icon: Globe,           desc: "Analyze a live application by URL" },
  { title: "New SAST Scan",      path: "/sast",        icon: FileCode2,       desc: "Scan source code for vulnerabilities" },
  { title: "CI/CD Integration",  path: "/integrations",icon: Zap,             desc: "API keys and GitHub Actions setup" },
  { title: "Settings",           path: "/settings",    icon: Settings,        desc: "Account settings and preferences" },
] as const;

function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />;
  if (status === "failed")    return <AlertCircle  className="w-3 h-3 text-red-400 shrink-0" />;
  if (status === "running" || status === "pending") return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
  return <Clock className="w-3 h-3 text-zinc-500 shrink-0" />;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState(0);
  const [, setLocation]         = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const { data } = useListQaRuns();
  const runs = data?.runs?.slice(0, 8) ?? [];

  const q = query.toLowerCase();

  const navMatches = NAV_ITEMS.filter(n =>
    !q || n.title.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q),
  );
  const runMatches = runs.filter(r =>
    !q ||
    r.appUrl?.toLowerCase().includes(q) ||
    r.projectName?.toLowerCase().includes(q) ||
    r.appDescription?.toLowerCase().includes(q),
  );

  const totalItems = navMatches.length + runMatches.length;

  useEffect(() => {
    if (open) { inputRef.current?.focus(); setQuery(""); setSelected(0); }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-selected='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function openItem(type: "nav" | "run", path?: string, id?: string) {
    if (type === "nav" && path) setLocation(path);
    else if (id)               setLocation(`/runs/${id}`);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape")    { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, totalItems - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0));              return; }
    if (e.key === "Enter") {
      const navItem = navMatches[selected];
      if (navItem) { openItem("nav", navItem.path); return; }
      const runItem = runMatches[selected - navMatches.length];
      if (runItem) { openItem("run", undefined, runItem.id); }
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
          onKeyDown={handleKeyDown}
        >
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: "spring", damping: 26, stiffness: 380 }}
            className="relative w-full max-w-[520px] rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-black/70"
            style={{ background: "hsl(230,24%,8%)" }}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/6">
              <Search className="w-4 h-4 text-zinc-500 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search pages, recent scans…"
                className="flex-1 bg-transparent text-white placeholder:text-zinc-600 text-sm outline-none font-sans min-w-0"
              />
              {query && (
                <button onClick={() => setQuery("")} className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <kbd className="shrink-0 text-[10px] font-mono bg-white/5 border border-white/8 rounded px-1.5 py-0.5 text-zinc-600 select-none">esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[360px] overflow-y-auto overscroll-contain py-1.5">
              {navMatches.length > 0 && (
                <div className="mb-1">
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-700">Navigation</p>
                  {navMatches.map((item, i) => {
                    const isActive = selected === i;
                    return (
                      <button
                        key={item.path}
                        data-selected={isActive}
                        onMouseEnter={() => setSelected(i)}
                        onClick={() => openItem("nav", item.path)}
                        className={["w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", isActive ? "bg-violet-500/12" : "hover:bg-white/4"].join(" ")}
                      >
                        <div className={["w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors", isActive ? "bg-violet-500/20 text-violet-300" : "bg-white/5 text-zinc-500"].join(" ")}>
                          <item.icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={["text-sm font-medium", isActive ? "text-white" : "text-zinc-300"].join(" ")}>{item.title}</p>
                          <p className="text-[11px] text-zinc-600 truncate">{item.desc}</p>
                        </div>
                        {isActive && <ArrowRight className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {runMatches.length > 0 && (
                <div className={navMatches.length > 0 ? "border-t border-white/5 pt-1.5" : ""}>
                  <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-700">Recent Scans</p>
                  {runMatches.map((run, i) => {
                    const idx = navMatches.length + i;
                    const isActive = selected === idx;
                    const isUrl = run.runType === "url";
                    const Icon = isUrl ? Globe : FileCode2;
                    return (
                      <button
                        key={run.id}
                        data-selected={isActive}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => openItem("run", undefined, run.id)}
                        className={["w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", isActive ? "bg-violet-500/12" : "hover:bg-white/4"].join(" ")}
                      >
                        <div className={["w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                          isActive ? "bg-violet-500/20 text-violet-300"
                            : isUrl ? "bg-violet-500/8 text-violet-400/60" : "bg-cyan-500/8 text-cyan-400/60",
                        ].join(" ")}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={["text-sm font-medium truncate", isActive ? "text-white" : "text-zinc-300"].join(" ")}>
                            {run.appUrl ?? run.projectName ?? "Unnamed scan"}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <StatusDot status={run.status} />
                            <p className="text-[11px] text-zinc-600">
                              {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                        {isActive && <ArrowRight className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {totalItems === 0 && (
                <div className="py-14 text-center">
                  <Search className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500 text-sm">No results for "{query}"</p>
                  <p className="text-zinc-700 text-xs mt-1">Try a page name or scan URL</p>
                </div>
              )}
            </div>

            <div className="border-t border-white/5 px-4 py-2 flex items-center gap-4">
              {[["↑", "↓", "Navigate"], ["↵", "", "Open"], ["esc", "", "Close"]].map(([k1, k2, label]) => (
                <div key={label} className="flex items-center gap-1 text-zinc-700 text-[10px]">
                  <kbd className="font-mono bg-white/4 border border-white/6 rounded px-1 py-0.5 leading-none">{k1}</kbd>
                  {k2 && <kbd className="font-mono bg-white/4 border border-white/6 rounded px-1 py-0.5 leading-none">{k2}</kbd>}
                  <span className="ml-1">{label}</span>
                </div>
              ))}
              <p className="ml-auto text-[10px] text-zinc-700 select-none">⌘K to toggle</p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
