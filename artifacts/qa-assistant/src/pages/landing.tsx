import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ShieldCheck, ArrowRight, Zap, FileCode2, BrainCircuit, CheckCircle2, Sparkles } from "lucide-react";

const FEATURES = [
  {
    icon: GlobeIcon,
    title: "Live URL Testing",
    desc: "Test any deployed app by URL. AI scans security headers, structure, accessibility, performance & UX in seconds.",
    color: "#8B5CF6",
    glow: "rgba(139,92,246,0.12)",
  },
  {
    icon: FileCode2,
    title: "Static Code Analysis",
    desc: "Upload source files for SAST scanning. Detects SQL injection, XSS, hardcoded secrets, and 20+ vulnerability types.",
    color: "#06B6D4",
    glow: "rgba(6,182,212,0.12)",
  },
  {
    icon: BrainCircuit,
    title: "AI-Powered Reports",
    desc: "GPT-4o generates structured reports with severity ratings, root causes, and copy-ready fixes for every issue.",
    color: "#10B981",
    glow: "rgba(16,185,129,0.12)",
  },
];

const STATS = [
  { value: "20+", label: "Vulnerability types" },
  { value: "< 30s", label: "Analysis time" },
  { value: "4 levels", label: "Severity scoring" },
  { value: "GPT-4o", label: "AI engine" },
];

const TESTIMONIALS = [
  { quote: "Found 3 critical SQL injection bugs in 20 seconds.", role: "Backend Engineer", icon: "🛡️" },
  { quote: "The SAST feature saved us before our security audit.", role: "CTO, SaaS Startup", icon: "🚀" },
  { quote: "Best QA tool for solo devs shipping fast.", role: "Indie Developer", icon: "⚡" },
];

function GlobeIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export default function Landing() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen w-full bg-[hsl(230,25%,5%)] relative overflow-hidden flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] rounded-full opacity-[0.07] bg-violet-500 blur-[120px]" />
        <div className="absolute bottom-[10%] right-[15%] w-[500px] h-[500px] rounded-full opacity-[0.05] bg-cyan-400 blur-[100px]" />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.08) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 w-full px-6 py-5 max-w-7xl mx-auto flex items-center justify-between">
        <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/25 rounded-xl blur-md" />
            <div className="relative bg-violet-500/15 p-2.5 rounded-xl border border-violet-500/30">
              <ShieldCheck className="w-5 h-5 text-violet-400" />
            </div>
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight text-white">
            QA<span className="text-violet-400">Assistant</span>
          </span>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2">
          <Button variant="ghost" onClick={login} className="text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl px-5">Sign In</Button>
          <Button onClick={login} className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl px-5 shadow-lg shadow-violet-900/40">
            Get Started <ArrowRight className="ml-1.5 w-4 h-4" />
          </Button>
        </motion.div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center text-center px-4 pt-12 pb-28">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 text-violet-300 text-sm font-medium mb-8">
          <Sparkles className="w-3.5 h-3.5" />
          AI Security &amp; QA Platform · Powered by GPT-4o
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.7 }}
          className="font-display font-extrabold text-5xl md:text-7xl lg:text-[80px] tracking-tight text-white leading-[1.05] max-w-5xl"
        >
          Ship Code With<br />
          <span style={{ background: 'linear-gradient(135deg,#8B5CF6,#06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Zero Blind Spots.
          </span>
        </motion.h1>

        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="max-w-2xl text-lg md:text-xl text-zinc-400 leading-relaxed mt-6">
          Analyze live apps and source code for security vulnerabilities, bugs &amp; quality issues — in under 30 seconds.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-col sm:flex-row gap-4 mt-10">
          <Button size="lg" onClick={login}
            className="h-14 px-9 rounded-2xl text-base font-semibold bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white shadow-2xl shadow-violet-900/40 transition-all hover:-translate-y-0.5">
            <Zap className="mr-2 w-5 h-5" /> Start Testing Free
          </Button>
          <Button size="lg" variant="outline" onClick={login}
            className="h-14 px-9 rounded-2xl text-base border-white/10 bg-white/4 hover:bg-white/8 text-white transition-all hover:-translate-y-0.5">
            <FileCode2 className="mr-2 w-5 h-5 text-cyan-400" /> Scan Source Code
          </Button>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="flex items-center gap-10 mt-10">
          {STATS.map((s) => (
            <div key={s.value} className="text-center">
              <div className="font-display font-bold text-xl text-white">{s.value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Feature cards */}
        <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-24 w-full max-w-5xl">
          {FEATURES.map((f, i) => (
            <motion.div key={i} whileHover={{ y: -5 }} transition={{ type: "spring", stiffness: 300 }}
              className="text-left p-7 rounded-2xl border border-white/8 bg-white/3 backdrop-blur-sm hover:border-white/14 cursor-default transition-colors">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5" style={{ background: f.glow, border: `1px solid ${f.color}30` }}>
                <f.icon className="w-6 h-6" style={{ color: f.color }} />
              </div>
              <h3 className="font-display font-bold text-lg text-white mb-2">{f.title}</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Testimonials */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10 w-full max-w-4xl">
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-white/3 border border-white/6">
              <span className="text-xl mt-0.5">{t.icon}</span>
              <div>
                <p className="text-zinc-200 text-sm font-medium leading-snug">"{t.quote}"</p>
                <p className="text-zinc-500 text-xs mt-1">{t.role}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Checklist */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.75 }}
          className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 mt-12 max-w-2xl">
          {["No setup required", "No API key needed", "SAST + DAST", "Export reports", "Powered by GPT-4o"].map((item) => (
            <div key={item} className="flex items-center gap-1.5 text-zinc-400 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />{item}
            </div>
          ))}
        </motion.div>

        {/* CTA Banner */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }} className="mt-20 w-full max-w-4xl">
          <div className="relative overflow-hidden rounded-3xl border border-violet-500/18 p-12 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(109,40,217,0.15) 0%, rgba(6,182,212,0.08) 100%)' }}>
            <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(139,92,246,0.1) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
            <div className="relative z-10">
              <h2 className="font-display font-bold text-3xl text-white mb-3">Ready to ship with confidence?</h2>
              <p className="text-zinc-400 mb-7">Join developers who catch bugs before their users do.</p>
              <Button size="lg" onClick={login}
                className="h-14 px-10 rounded-2xl font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-xl shadow-violet-900/50 transition-all hover:-translate-y-0.5">
                Get Started — It's Free <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 text-center py-6 text-zinc-600 text-sm border-t border-white/4">
        QA Assistant · AI-powered security & quality platform
      </footer>
    </div>
  );
}
