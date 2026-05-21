import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, AlertCircle, User,
  Shield, Zap, Globe, CheckCircle2,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

function getAppBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href");
  if (baseHref) return baseHref.replace(/\/+$/, "");
  return import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";
}

const FLOATING_ICONS = [
  { Icon: Shield,      x: "6%",   y: "18%",  size: 18, delay: 0,   dur: 6 },
  { Icon: Zap,         x: "87%",  y: "10%",  size: 14, delay: 1.0, dur: 7 },
  { Icon: Globe,       x: "91%",  y: "65%",  size: 16, delay: 0.7, dur: 5 },
  { Icon: ShieldCheck, x: "4%",   y: "75%",  size: 20, delay: 1.9, dur: 8 },
  { Icon: CheckCircle2,x: "82%",  y: "38%",  size: 13, delay: 0.4, dur: 6.5 },
];

export default function Register() {
  usePageTitle("Create Account");

  const [name, setName]             = useState("");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [showPassword, setShowPw]   = useState(false);
  const [showConfirm, setShowConf]  = useState(false);
  const [error, setError]           = useState("");
  const [isLoading, setIsLoading]   = useState(false);

  const [nameFocused, setNameFocused]   = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused]       = useState(false);
  const [confFocused, setConfFocused]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~])/.test(password)) {
      setError("Password must contain uppercase, lowercase, and a number or special character.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Registration failed. Please try again.");
        return;
      }
      window.location.href = getAppBase() + "/";
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const passwordsMatch = confirm === "" || password === confirm;

  // Strength scoring: 0=empty 1=too short 2=length ok but weak 3=good 4=strong
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumOrSpecial = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);
  const pwStrength =
    password.length === 0 ? 0
    : password.length < 12 ? 1
    : (!hasUpper || !hasLower || !hasNumOrSpecial) ? 2
    : password.length < 16 ? 3
    : 4;
  const pwStrengthColor = ["", "#EF4444", "#F59E0B", "#F59E0B", "#10B981"][pwStrength];
  const pwStrengthLabel = ["", "Too short", "Needs complexity", "Good", "Strong"][pwStrength];

  function focusBoxShadow(focused: boolean, error = false) {
    if (error) return "0 0 0 1px rgba(239,68,68,0.4), 0 4px 20px rgba(239,68,68,0.06)";
    if (focused) return "0 0 0 1px rgba(139,92,246,0.4), 0 4px 20px rgba(139,92,246,0.08)";
    return "none";
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-10 relative overflow-hidden"
      style={{ background: "hsl(230,25%,5%)" }}
    >
      {/* Cyber grid */}
      <div className="absolute inset-0 cyber-grid opacity-40 pointer-events-none z-0" />

      {/* Ambient orbs */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-15%] right-[0%] w-[700px] h-[700px] rounded-full blur-[160px] orb-drift-2"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full blur-[140px] orb-drift"
          style={{ background: "radial-gradient(circle, rgba(6,182,212,0.07) 0%, transparent 70%)" }} />
      </div>

      {/* Floating icons */}
      {FLOATING_ICONS.map(({ Icon, x, y, size, delay, dur }, i) => (
        <div
          key={i}
          className="absolute pointer-events-none z-0 text-violet-500/10"
          style={{ left: x, top: y, animation: `float ${dur}s ease-in-out ${delay}s infinite` }}
        >
          <Icon style={{ width: size, height: size }} />
        </div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-3 group focus-visible:outline-none">
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
          {/* Top glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.35), transparent)" }} />

          <div className="mb-7">
            <h1 className="font-display font-bold text-2xl text-white mb-1.5">Create your account</h1>
            <p className="text-zinc-500 text-sm">Free forever — no credit card required</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Full name</label>
              <div className="relative transition-all duration-200" style={{ borderRadius: "0.75rem", boxShadow: focusBoxShadow(nameFocused) }}>
                <User className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${nameFocused ? "text-violet-400" : "text-zinc-600"}`} />
                <input
                  type="text" autoComplete="name" required value={name}
                  onChange={e => setName(e.target.value)}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  placeholder="Jane Smith"
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all"
                />
              </div>
            </div>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Email address</label>
              <div className="relative transition-all duration-200" style={{ borderRadius: "0.75rem", boxShadow: focusBoxShadow(emailFocused) }}>
                <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${emailFocused ? "text-violet-400" : "text-zinc-600"}`} />
                <input
                  type="email" autoComplete="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  placeholder="you@example.com"
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Password</label>
              <div className="relative transition-all duration-200" style={{ borderRadius: "0.75rem", boxShadow: focusBoxShadow(pwFocused) }}>
                <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${pwFocused ? "text-violet-400" : "text-zinc-600"}`} />
                <input
                  type={showPassword ? "text" : "password"} autoComplete="new-password" required value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  placeholder="Min. 12 chars, uppercase + number"
                  className="w-full pl-11 pr-11 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors" tabIndex={-1}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Password strength */}
              {password.length > 0 && (
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="flex gap-1 flex-1">
                    {[1, 2, 3].map(lvl => (
                      <div key={lvl} className="h-1 flex-1 rounded-full transition-all duration-300"
                        style={{ background: lvl <= pwStrength ? pwStrengthColor : "rgba(255,255,255,0.07)" }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-semibold shrink-0" style={{ color: pwStrengthColor ?? "#52525b" }}>
                    {pwStrengthLabel}
                  </span>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Confirm password</label>
              <div className="relative transition-all duration-200"
                style={{ borderRadius: "0.75rem", boxShadow: focusBoxShadow(confFocused, !passwordsMatch && confirm.length > 0) }}>
                <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${confFocused ? "text-violet-400" : "text-zinc-600"}`} />
                <input
                  type={showConfirm ? "text" : "password"} autoComplete="new-password" required value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onFocus={() => setConfFocused(true)}
                  onBlur={() => setConfFocused(false)}
                  placeholder="••••••••"
                  className={[
                    "w-full pl-11 pr-11 py-3 rounded-xl bg-white/[0.04] border text-white placeholder-zinc-600 text-sm focus:outline-none focus:bg-white/[0.06] transition-all",
                    !passwordsMatch && confirm.length > 0
                      ? "border-red-500/40 focus:border-red-500/55"
                      : "border-white/[0.08] focus:border-violet-500/50",
                  ].join(" ")}
                />
                <button type="button" onClick={() => setShowConf(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors" tabIndex={-1}>
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <AnimatePresence>
                {!passwordsMatch && confirm.length > 0 && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="text-red-400/90 text-xs flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />Passwords do not match
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, scale: 0.97 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.97 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/22 text-red-400 text-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !name || !email || !password || !confirm || !passwordsMatch}
              className="relative w-full h-12 rounded-xl font-semibold text-white overflow-hidden transition-all mt-1 disabled:opacity-55 disabled:cursor-not-allowed group"
              style={{
                background: "linear-gradient(135deg, hsl(258,85%,60%), hsl(258,85%,52%))",
                boxShadow: (!isLoading && name && email && password && confirm && passwordsMatch)
                  ? "0 4px 24px rgba(139,92,246,0.4), 0 1px 0 rgba(255,255,255,0.1) inset"
                  : "none",
              }}
            >
              <span className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700 ease-in-out" />
              <span className="relative flex items-center justify-center gap-2">
                {isLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Creating account…</>
                  : <><ArrowRight className="w-4 h-4" />Create Account</>}
              </span>
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-zinc-600 text-sm mt-5">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-violet-400 hover:text-violet-300 font-semibold transition-colors underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
