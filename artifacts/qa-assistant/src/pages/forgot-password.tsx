import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Mail, Loader2, ArrowLeft, AlertCircle,
  CheckCircle2, Shield, Zap, Globe,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

function getAppBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href");
  if (baseHref) return baseHref.replace(/\/+$/, "");
  return import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";
}

const FLOATING_ICONS = [
  { Icon: Shield,       x: "8%",  y: "15%", size: 18, delay: 0,   dur: 6 },
  { Icon: Zap,          x: "85%", y: "12%", size: 14, delay: 1.2, dur: 7 },
  { Icon: Globe,        x: "90%", y: "70%", size: 16, delay: 0.6, dur: 5 },
  { Icon: ShieldCheck,  x: "5%",  y: "72%", size: 20, delay: 1.8, dur: 8 },
];

export default function ForgotPassword() {
  usePageTitle("Forgot Password");

  const [email, setEmail]         = useState("");
  const [error, setError]         = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent]           = useState(false);
  const [devResetUrl, setDevResetUrl] = useState("");
  const [focused, setFocused]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json() as { success?: boolean; error?: string; _devResetUrl?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data._devResetUrl) setDevResetUrl(data._devResetUrl);
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "hsl(230,25%,5%)" }}
    >
      <div className="absolute inset-0 cyber-grid opacity-40 pointer-events-none z-0" />

      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-15%] left-[5%] w-[700px] h-[700px] rounded-full blur-[160px] orb-drift"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.09) 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full blur-[140px] orb-drift-2"
          style={{ background: "radial-gradient(circle, rgba(6,182,212,0.07) 0%, transparent 70%)" }} />
      </div>

      {FLOATING_ICONS.map(({ Icon, x, y, size, delay, dur }, i) => (
        <div key={i} className="absolute pointer-events-none z-0 text-violet-500/10"
          style={{ left: x, top: y, animation: `float ${dur}s ease-in-out ${delay}s infinite` }}>
          <Icon style={{ width: size, height: size }} />
        </div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[400px]"
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/login" className="flex items-center gap-3 group focus-visible:outline-none">
            <div className="relative">
              <div className="absolute inset-0 bg-violet-500/30 rounded-xl blur-md group-hover:blur-lg transition-all" />
              <div className="relative bg-gradient-to-br from-violet-500/20 to-violet-600/10 p-3 rounded-xl border border-violet-500/35 group-hover:border-violet-400/50 transition-all shield-pulse">
                <ShieldCheck className="w-6 h-6 text-violet-400" />
              </div>
            </div>
            <span className="font-display font-extrabold text-2xl tracking-tight text-white">
              QA<span className="gradient-text">Assistant</span>
            </span>
          </Link>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8 relative overflow-hidden"
          style={{
            background: "linear-gradient(145deg, hsl(230,22%,8.5%), hsl(230,22%,7%))",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(139,92,246,0.06), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.35), transparent)" }} />

          <AnimatePresence mode="wait">
            {sent ? (
              <motion.div
                key="sent"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-4"
              >
                <div className="flex justify-center mb-5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-emerald-500/25 rounded-2xl blur-xl" />
                    <div className="relative w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                      <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                    </div>
                  </div>
                </div>
                <h2 className="font-display font-bold text-xl text-white mb-2">Check your inbox</h2>
                <p className="text-zinc-500 text-sm leading-relaxed mb-5">
                  If an account exists for <span className="text-zinc-300 font-medium">{email}</span>, you'll receive a password reset link shortly.
                </p>
                {devResetUrl && (
                  <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/18 text-left mb-5">
                    <p className="text-amber-400 text-[11px] font-bold uppercase tracking-widest mb-1.5">Dev mode — no email sent</p>
                    <a href={devResetUrl} className="text-violet-400 text-xs break-all hover:underline">{devResetUrl}</a>
                  </div>
                )}
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-violet-400 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sign In
                </Link>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="mb-7">
                  <h1 className="font-display font-bold text-2xl text-white mb-1.5">Forgot password?</h1>
                  <p className="text-zinc-500 text-sm">Enter your email and we'll send you a reset link.</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                      Email address
                    </label>
                    <div
                      className="relative transition-all duration-200"
                      style={{
                        borderRadius: "0.75rem",
                        boxShadow: focused ? "0 0 0 1px rgba(139,92,246,0.4), 0 4px 20px rgba(139,92,246,0.08)" : "none",
                      }}
                    >
                      <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${focused ? "text-violet-400" : "text-zinc-600"}`} />
                      <input
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        placeholder="you@example.com"
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all"
                      />
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/22 text-red-400 text-sm"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="submit"
                    disabled={isLoading || !email}
                    className="relative w-full h-12 rounded-xl font-semibold text-white overflow-hidden transition-all mt-1 disabled:opacity-55 disabled:cursor-not-allowed group"
                    style={{
                      background: "linear-gradient(135deg, hsl(258,85%,60%), hsl(258,85%,52%))",
                      boxShadow: (!isLoading && email) ? "0 4px 24px rgba(139,92,246,0.4), 0 1px 0 rgba(255,255,255,0.1) inset" : "none",
                    }}
                  >
                    <span className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700 ease-in-out" />
                    <span className="relative flex items-center justify-center gap-2">
                      {isLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                        : <>Send Reset Link</>}
                    </span>
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-zinc-600 text-sm mt-5">
          Remember your password?{" "}
          <Link href="/login" className="text-violet-400 hover:text-violet-300 font-semibold transition-colors underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
