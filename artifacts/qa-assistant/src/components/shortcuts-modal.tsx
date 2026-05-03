import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { useEffect } from "react";

interface ShortcutRow { keys: string[]; label: string }
interface ShortcutGroup { title: string; items: ShortcutRow[] }

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Global",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"],        label: "Show keyboard shortcuts" },
      { keys: ["Esc"],      label: "Close any modal or overlay" },
    ],
  },
  {
    title: "Report Page — Issue Navigation",
    items: [
      { keys: ["j", "↓"],   label: "Expand next issue" },
      { keys: ["k", "↑"],   label: "Expand previous issue" },
      { keys: ["/"],         label: "Focus issue search box" },
      { keys: ["Esc"],       label: "Collapse expanded issue" },
    ],
  },
  {
    title: "Report Page — Filters",
    items: [
      { keys: ["1"],  label: "Filter: All severities" },
      { keys: ["2"],  label: "Filter: Critical" },
      { keys: ["3"],  label: "Filter: High" },
      { keys: ["4"],  label: "Filter: Medium" },
      { keys: ["5"],  label: "Filter: Low" },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-white/8 border border-white/12 text-zinc-300 leading-snug min-w-[1.5rem]">
      {children}
    </kbd>
  );
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-10"
            style={{ background: "hsl(230,24%,9%)" }}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
              <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/22 flex items-center justify-center shrink-0">
                <Keyboard className="w-3.5 h-3.5 text-violet-400" />
              </div>
              <span className="text-sm font-display font-semibold text-white">Keyboard Shortcuts</span>
              <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors p-1 rounded-lg hover:bg-white/6">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {SHORTCUTS.map(group => (
                <div key={group.title}>
                  <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-3">{group.title}</p>
                  <div className="space-y-2.5">
                    {group.items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between gap-4">
                        <span className="text-sm text-zinc-300">{item.label}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {item.keys.map((key, j) => (
                            <Kbd key={j}>{key}</Kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-white/6 text-center">
              <span className="text-[11px] text-zinc-600">
                Press <Kbd>Esc</Kbd>{" "}
                <span className="mx-0.5">or</span>{" "}
                <Kbd>?</Kbd> to close
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
