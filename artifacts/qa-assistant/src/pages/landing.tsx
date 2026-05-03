import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  ShieldCheck, ArrowRight, Zap, FileCode2, BrainCircuit,
  CheckCircle2, Sparkles, Globe, Lock, Code2,
  Cpu, Shield, Star,
} from "lucide-react";
import { useMemo, useEffect, useState } from "react";

// ── Star field ────────────────────────────────────────────────────────────────
interface StarDef { id: number; x: number; y: number; size: number; delay: number; duration: number }

function StarField({ count = 90 }: { count?: number }) {
  const stars = useMemo<StarDef[]>(() =>
    Array.from({ length: count }, (_, id) => ({
      id, x: Math.random() * 100, y: Math.random() * 100,
      size: Math.random() * 1.4 + 0.4, delay: Math.random() * 6, duration: 3 + Math.random() * 5,
    })),
  [count]);
  return (
    <div aria-hidden className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {stars.map(s => (
        <div key={s.id} className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size,
            animation: `star-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite` }} />
      ))}
    </div>
  );
}

// ── Scan terminal ─────────────────────────────────────────────────────────────
const SCAN_LINES = [
  { text: "$ qa scan https://shop.example.com --depth=full", type: "cmd" },
  { text: "  ▸ Resolving DNS · Connecting to target...", type: "dim" },
  { text: "  ✓ Connected  ·  Page loaded (1.1s)  ·  HTML: 18KB", type: "ok" },
  { text: "  ▸ Auditing 18 security vectors...", type: "dim" },
  { text: "  ✗ Content-Security-Policy    MISSING   [CRITICAL]", type: "crit" },
  { text: "  ✗ X-Frame-Options            MISSING   [HIGH]", type: "high" },
  { text: "  ✓ Strict-Transport-Security  valid  ·  Referrer-Policy  valid", type: "ok" },
  { text: "  ▸ Sending to GPT-4o for deep analysis...", type: "dim" },
  { text: "  ✓ 9 issues found  ·  2 critical  ·  4 high  ·  3 medium", type: "ok" },
  { text: "  ✓ Score: 51/100  ·  AI fixes generated  ·  SARIF ready", type: "score" },
] as const;

const LINE_DELAYS = [0, 650, 1200, 1950, 2650, 3150, 3700, 4550, 5450, 6300];
const CYCLE_MS = 10000;

function lineColor(type: string): string {
  if (type === "cmd")   return "#e2e8f0";
  if (type === "dim")   return "#52525b";
  if (type === "ok")    return "#10B981";
  if (type === "crit")  return "#EF4444";
  if (type === "high")  return "#F97316";
  if (type === "score") return "#8B5CF6";
  return "#a1a1aa";
}

function ScanTerminal() {
  const [revealed, setRevealed] = useState(0);
  const [cycle, setCycle]       = useState(0);

  useEffect(() => {
    const ts: ReturnType<typeof setTimeout>[] = [];
    LINE_DELAYS.forEach((d, i) => ts.push(setTimeout(() => setRevealed(i + 1), d)));
    ts.push(setTimeout(() => { setRevealed(0); setCycle(c => c + 1); }, CYCLE_MS));
    return () => ts.forEach(clearTimeout);
  }, [cycle]);

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden"
      style={{ background: "hsl(230,26%,3%)", boxShadow: "0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.04)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5" style={{ background: "hsl(230,26%,5.5%)" }}>
        <div className="flex gap-1.5">
          {(["#EF4444","#F59E0B","#10B981"] as const).map(c => (
            <div key={c} className="w-3 h-3 rounded-full" style={{ background: c, opacity: 0.7 }} />
          ))}
        </div>
        <span className="text-zinc-600 text-[11px] font-mono ml-2 select-none">qa-assistant — scan</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-50" />
          </div>
          <span className="text-emerald-400/80 text-[10px] font-mono tracking-widest">LIVE</span>
        </div>
      </div>
      <div className="p-5 font-mono text-[11.5px] leading-[1.75] min-h-[228px]">
        {revealed === 0 && (
          <div className="flex items-center"><span className="text-zinc-600">$ </span><span className="text-zinc-400 cursor-blink ml-0.5">▋</span></div>
        )}
        {SCAN_LINES.slice(0, revealed).map((line, i) => (
          <div key={`${cycle}-${i}`} className="terminal-line">
            <span style={{ color: lineColor(line.type) }}>{line.text}</span>
            {i === revealed - 1 && revealed < SCAN_LINES.length && (
              <span className="text-zinc-500 cursor-blink ml-0.5">▋</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Typewriter hook ───────────────────────────────────────────────────────────
function useTypewriter(words: string[], speed = 68, pause = 2400, del = 38) {
  const [display, setDisplay]   = useState("");
  const [wIdx, setWIdx]         = useState(0);
  const [cIdx, setCIdx]         = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = words[wIdx % words.length];
    let cleanup: (() => void) | undefined;

    if (!deleting && cIdx < word.length) {
      const t = setTimeout(() => setCIdx(n => n + 1), speed);
      cleanup = () => clearTimeout(t);
    } else if (!deleting && cIdx === word.length) {
      const t = setTimeout(() => setDeleting(true), pause);
      cleanup = () => clearTimeout(t);
    } else if (deleting && cIdx > 0) {
      const t = setTimeout(() => setCIdx(n => n - 1), del);
      cleanup = () => clearTimeout(t);
    } else {
      setDeleting(false);
      setWIdx(n => n + 1);
    }

    return cleanup;
  }, [cIdx, deleting, wIdx, words, speed, pause, del]);

  useEffect(() => {
    setDisplay(words[wIdx % words.length].slice(0, cIdx));
  }, [words, wIdx, cIdx]);

  return display;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPEWRITER_WORDS = ["Vulnerabilities", "SQL Injection", "XSS Vectors", "Hardcoded Secrets", "Broken Auth"];

const FEATURES = [
  { icon: Globe, title: "Live URL Scanning (DAST)", color: "#8B5CF6", glow: "rgba(139,92,246,0.1)",
    desc: "Test any deployed URL. AI audits security headers, page structure, accessibility, and runs full dynamic analysis." },
  { icon: FileCode2, title: "Static Code Analysis (SAST)", color: "#06B6D4", glow: "rgba(6,182,212,0.1)",
    desc: "Upload source files. Detects SQL injection, XSS, hardcoded secrets, IaC misconfigs, container risks, and 20+ more patterns." },
  { icon: BrainCircuit, title: "AI-Generated Fixes", color: "#10B981", glow: "rgba(16,185,129,0.1)",
    desc: "GPT-4o produces structured reports with severity ratings, OWASP Top 10 mapping, attack chain narratives, and copy-ready patches." },
] as const;

const STEPS = [
  { n: "01", icon: Code2,   title: "Submit",  color: "#8B5CF6",
    desc: "Paste a live URL or upload your source code files. Zero configuration — no API keys needed." },
  { n: "02", icon: Cpu,     title: "Analyze", color: "#06B6D4",
    desc: "GPT-4o scans for 20+ vulnerability types including OWASP Top 10, secrets, and CVE-tracked dependencies." },
  { n: "03", icon: Shield,  title: "Fix",     color: "#10B981",
    desc: "Get severity ratings, attack chain narratives, SARIF export, and one-click AI code fixes." },
] as const;

const COMPARISON = [
  { feat: "AI-Generated Code Fixes",    qa: true,  snyk: false, sq: false },
  { feat: "Live URL / DAST Scanning",   qa: true,  snyk: false, sq: false },
  { feat: "Attack Chain Narratives",    qa: true,  snyk: false, sq: false },
  { feat: "Zero Setup Required",        qa: true,  snyk: false, sq: false },
  { feat: "OWASP Top 10 Mapping",       qa: true,  snyk: true,  sq: true  },
  { feat: "Dependency CVE Scanning",    qa: true,  snyk: true,  sq: true  },
] as const;

const TESTIMONIALS = [
  { q: "Found 3 critical SQL injection bugs in our API endpoint in under 20 seconds.", role: "Backend Engineer",  icon: "🛡️" },
  { q: "The SAST scan caught hardcoded AWS access keys before our security audit.",   role: "CTO, SaaS Startup", icon: "🚀" },
  { q: "Best QA tool for solo developers who need to ship fast and stay secure.",      role: "Indie Developer",   icon: "⚡" },
] as const;

// ── Landing ───────────────────────────────────────────────────────────────────
export default function Landing() {
  const word = useTypewriter(TYPEWRITER_WORDS);

  return (
    <div className="min-h-screen w-full bg-[hsl(230,25%,5%)] relative overflow-x-hidden flex flex-col">
      <StarField count={90} />

      {/* Gradient orbs */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-8%] left-[8%]   w-[700px] h-[700px] rounded-full bg-violet-600 opacity-[0.055] blur-[140px] orb-drift" />
        <div className="absolute bottom-[5%] right-[5%] w-[600px] h-[600px] rounded-full bg-cyan-500   opacity-[0.04]  blur-[120px] orb-drift-2" />
        <div className="absolute top-[45%] left-[48%]  w-[350px] h-[350px] rounded-full bg-indigo-500 opacity-[0.03]  blur-[100px]" />
      </div>

      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="sticky top-0 z-20 w-full" style={{ backdropFilter: "blur(20px) saturate(1.3)" }}>
        <div className="absolute inset-0 border-b border-white/[0.05]" style={{ background: "hsl(230,25%,5%,0.8)" }} />
        <div className="relative max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-violet-500/20 rounded-xl blur-md" />
              <div className="relative bg-violet-500/12 p-2.5 rounded-xl border border-violet-500/25">
                <ShieldCheck className="w-5 h-5 text-violet-400" />
              </div>
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight text-white">QA<span className="text-violet-400">Assistant</span></span>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" className="text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl px-5">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl px-5 shadow-lg shadow-violet-900/40 hover-lift">
                Get Started <ArrowRight className="ml-1.5 w-4 h-4" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </nav>

      <main className="relative z-10 flex-1 flex flex-col max-w-7xl mx-auto w-full px-6">

        {/* ── Hero ─────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center pt-16 pb-24">
          <div className="flex flex-col items-start">
            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 text-violet-300 text-sm font-medium mb-8">
              <Sparkles className="w-3.5 h-3.5" />
              AI Security &amp; QA Platform · Powered by GPT-4o
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.65 }}
              className="font-display font-extrabold text-5xl md:text-6xl lg:text-[62px] tracking-tight text-white leading-[1.06] mb-5"
            >
              Find{" "}
              <span style={{ background: "linear-gradient(135deg,#8B5CF6,#06B6D4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                {word || "\u00A0"}
              </span>
              <span className="text-white/25 cursor-blink">|</span>
              <br />Before Your Users Do.
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="text-zinc-400 text-lg leading-relaxed max-w-lg mb-8">
              AI-powered DAST &amp; SAST scanner. Scan live URLs and source code for 20+ vulnerability types — get structured GPT-4o reports in under 30 seconds.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}
              className="flex flex-col sm:flex-row gap-3 mb-10">
              <Link href="/register">
                <Button size="lg"
                  className="h-[3.25rem] px-8 rounded-2xl text-base font-semibold bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white shadow-2xl shadow-violet-900/45 hover-lift">
                  <Zap className="mr-2 w-5 h-5" /> Start Testing Free
                </Button>
              </Link>
              <Link href="/register">
                <Button size="lg" variant="outline"
                  className="h-[3.25rem] px-8 rounded-2xl text-base border-white/10 bg-white/4 hover:bg-white/7 text-white hover-lift">
                  <FileCode2 className="mr-2 w-5 h-5 text-cyan-400" /> Scan Source Code
                </Button>
              </Link>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.38 }}
              className="flex items-center flex-wrap gap-5">
              {([
                { icon: CheckCircle2, text: "No setup required", c: "text-emerald-400" },
                { icon: Lock,         text: "No data stored",    c: "text-cyan-400" },
                { icon: Code2,        text: "SAST + DAST",       c: "text-violet-400" },
              ] as const).map(({ icon: Icon, text, c }) => (
                <div key={text} className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${c}`} />
                  <span className="text-zinc-400 text-sm">{text}</span>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Terminal (desktop only) */}
          <motion.div initial={{ opacity: 0, x: 44 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.45, type: "spring", stiffness: 75 }}
            className="hidden lg:block">
            <ScanTerminal />
          </motion.div>
        </section>

        {/* ── Stats ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-24">
          {([
            { value: "20+",   label: "Vulnerability types", icon: Shield,      color: "#8B5CF6" },
            { value: "< 30s", label: "Analysis time",       icon: Zap,         color: "#06B6D4" },
            { value: "4",     label: "Severity levels",     icon: Star,        color: "#F59E0B" },
            { value: "GPT-4o",label: "AI engine",           icon: BrainCircuit,color: "#10B981" },
          ] as const).map((s, i) => (
            <motion.div key={s.label}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07 }}
              className="flex items-center gap-3 p-4 rounded-2xl border border-white/7 bg-white/3 backdrop-blur-sm hover:border-white/12 transition-colors">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${s.color}14`, border: `1px solid ${s.color}20` }}>
                <s.icon className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <div>
                <div className="font-display font-bold text-white text-xl leading-none">{s.value}</div>
                <div className="text-zinc-500 text-xs mt-0.5">{s.label}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── How it works ──────────────────────────────── */}
        <div className="mb-24">
          <div className="text-center mb-12">
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-3">How it works</p>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-white">Three steps to secure code</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-[1.75rem] left-[34%] right-[34%] h-px"
              style={{ background: "linear-gradient(90deg, rgba(139,92,246,0.4), rgba(6,182,212,0.2))" }} />
            {STEPS.map((step, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }}
                className="relative flex flex-col items-center text-center p-7 rounded-2xl border border-white/7 bg-white/2 backdrop-blur-sm hover:border-white/12 transition-all group cursor-default">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 relative transition-transform group-hover:scale-105 duration-200"
                  style={{ background: `${step.color}12`, border: `1px solid ${step.color}22` }}>
                  <step.icon className="w-6 h-6" style={{ color: step.color }} />
                  <span className="absolute -top-2.5 -right-2.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-lg"
                    style={{ background: `${step.color}18`, color: step.color, border: `1px solid ${step.color}28` }}>
                    {step.n}
                  </span>
                </div>
                <h3 className="font-display font-bold text-white text-lg mb-2">{step.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Features ──────────────────────────────────── */}
        <div className="mb-24">
          <div className="text-center mb-12">
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-3">What we scan</p>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-white">Every layer, covered</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                whileHover={{ y: -5, transition: { type: "spring", stiffness: 300 } }}
                className="text-left p-7 rounded-2xl border border-white/7 bg-white/2 backdrop-blur-sm hover:border-white/13 cursor-default transition-colors group">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-105 duration-200"
                  style={{ background: f.glow, border: `1px solid ${f.color}28` }}>
                  <f.icon className="w-6 h-6" style={{ color: f.color }} />
                </div>
                <h3 className="font-display font-bold text-lg text-white mb-2">{f.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Comparison ────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-24">
          <div className="rounded-2xl border border-white/8 overflow-hidden"
            style={{ background: "linear-gradient(145deg,hsl(230,22%,7%),hsl(230,22%,6%))" }}>
            <div className="px-8 py-6 border-b border-white/5">
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-2">How we compare</p>
              <h2 className="font-display font-bold text-2xl text-white">Why QA Assistant wins on AI</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-8 py-3 text-zinc-500 font-medium text-xs">Feature</th>
                    {[
                      { name: "QA Assistant", accent: true },
                      { name: "Snyk",         accent: false },
                      { name: "SonarQube",    accent: false },
                    ].map(h => (
                      <th key={h.name} className={["px-6 py-3 text-xs font-bold text-center", h.accent ? "text-violet-400" : "text-zinc-600"].join(" ")}>
                        {h.name}
                        {h.accent && <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-violet-500/12 text-[9px] text-violet-300 border border-violet-500/15">YOU</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <tr key={i} className={["border-b border-white/4 last:border-0 transition-colors hover:bg-white/[0.015]", i % 2 === 0 ? "bg-white/[0.01]" : ""].join(" ")}>
                      <td className="px-8 py-3.5 text-zinc-300 font-medium">{row.feat}</td>
                      {([row.qa, row.snyk, row.sq] as boolean[]).map((v, j) => (
                        <td key={j} className="px-6 py-3.5 text-center">
                          {v
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                            : <span className="text-zinc-700 font-mono text-base leading-none">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        {/* ── Testimonials ──────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-24">
          {TESTIMONIALS.map((t, i) => (
            <motion.div key={i}
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
              className="flex flex-col gap-4 px-6 py-5 rounded-2xl border border-white/7 bg-white/2 hover:border-white/12 transition-colors">
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, si) => <Star key={si} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-zinc-200 text-sm leading-relaxed flex-1">"{t.q}"</p>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-violet-500/12 border border-violet-500/20 flex items-center justify-center text-sm select-none">{t.icon}</div>
                <p className="text-zinc-500 text-xs">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── CTA ───────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-20">
          <div className="relative overflow-hidden rounded-3xl border border-violet-500/18 p-12 text-center"
            style={{ background: "linear-gradient(135deg,rgba(109,40,217,0.14) 0%,rgba(6,182,212,0.07) 100%)" }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ backgroundImage: "radial-gradient(circle, rgba(139,92,246,0.08) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
            <div className="absolute top-[-30%] left-[30%] w-[40%] h-[80%] bg-violet-600/15 blur-[80px] pointer-events-none" />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/20 bg-violet-500/8 text-violet-300 text-xs font-medium mb-5">
                <Sparkles className="w-3 h-3" /> Free to use · No credit card
              </div>
              <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-3">Ready to ship with confidence?</h2>
              <p className="text-zinc-400 mb-8 max-w-md mx-auto">Join developers who catch security issues before their users — or their attackers — do.</p>
              <Link href="/register">
                <Button size="lg"
                  className="h-14 px-10 rounded-2xl font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-xl shadow-violet-900/50 hover-lift">
                  Get Started — It's Free <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 border-t border-white/[0.04] py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-violet-500/12 p-1.5 rounded-lg border border-violet-500/20">
              <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <span className="font-display font-bold text-sm text-white/60">QA<span className="text-violet-400/70">Assistant</span></span>
          </div>
          <p className="text-zinc-600 text-xs">AI-powered security &amp; quality platform · Powered by GPT-4o</p>
          <p className="text-zinc-700 text-xs">SAST · DAST · OWASP Top 10 · SARIF</p>
        </div>
      </footer>
    </div>
  );
}
