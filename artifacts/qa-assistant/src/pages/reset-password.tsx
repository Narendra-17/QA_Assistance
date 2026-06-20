import { useState, type FormEvent, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Lock, Eye, EyeOff, Loader2, ArrowRight,
  AlertCircle, CheckCircle2, Shield, Zap, Globe,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

function getAppBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href");
  if (baseHref) return baseHref.replace(/\/+$/, "");
  return import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";
}

const FLOATING_ICONS = [
  { Icon: Shield,      x: "8%",  y: "15%", size: 18, delay: 0,   dur: 6 },
  { Icon: Zap,         x: "85%", y: "12%", size: 14, delay: 1.2, dur: 7 },
  { Icon: Globe,       x: "90%", y: "70%", size: 16, delay: 0.6, dur: 5 },
  { Icon: ShieldCheck, x: "5%",  y: "72%", size: 20, delay: 1.8, dur: 8 },
];

const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]).{12,128}$/;

export default function ResetPassword() {
  usePageTitle("Reset Password");

  const [token, setToken]           = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirm, setConfirm]       = useState("");
  const [showNew, setShowNew]       = useState(false);
  const [showConfirm, setShowConf]  = useState(false);
  const [error, setError]           = useState("");
  const [isLoading, setIsLoading]   = useState(false);
  const [success, setSuccess]       = useState(false);
  const [pwFocused, setPwFocused]   = useState(false);
  const [confFocused, setConfFocused] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) setToken(t);
    else setError("Invalid or missing reset token. Please request a new reset link.");
  }, []);

  const hasUpper = /[A-Z]/.test(newPw);
  const hasLower = /[a-z]/.test(newPw);
  const hasNumOrSpecial = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(newPw);
  const pwStrength =
    newPw.length === 0 ? 0
    : newPw.length < 12 ? 1
    : (!hasUpper || !hasLower || !hasNumOrSpecial) ? 2
    : newPw.length < 16 ? 3
    : 4;
  const pwStrengthColor = ["", "#EF4444", "#F59E0B", "#F59E0B", "#10B981"][pwStrength];
  const pwStrengthLabel = ["", "Too short", "Needs complexity", "Good", "Strong"][pwStrength];
  const passwordsMatch = confirm === "" || newPw === confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) { setError("No reset token found. Please use the link from your email."); return; }
    if (newPw !== confirm) { setError("Passwords do not match."); return; }
    if (!PASSWORD_RE.test(newPw)) {
      setError("Password must be 12+ chars with uppercase, lowercase, and a number or special character.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword: newPw }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to reset password. Please try again.");
        return;
      }
      setSuccess(true);
      setTimeout(() => { window.location.href = getAppBase() + "/login"; }, 2500);
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
        className="relative z-10 w-full max-w-[420px]"
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
            {success ? (
              <motion.div
                key="success"
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
                <h2 className="font-display font-bold text-xl text-white mb-2">Password reset!</h2>
                <p className="text-zinc-500 text-sm">Your password has been updated. Redirecting you to sign in…</p>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="mb-7">
                  <h1 className="font-display font-bold text-2xl text-white mb-1.5">Set new password</h1>
                  <p className="text-zinc-500 text-sm">Choose a strong password for your account.</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                  {/* New password */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">New password</label>
                    <div className="relative transition-all duration-200"
                      style={{ borderRadius: "0.75rem", boxShadow: pwFocused ? "0 0 0 1px rgba(139,92,246,0.4), 0 4px 20px rgba(139,92,246,0.08)" : "none" }}>
                      <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${pwFocused ? "text-violet-400" : "text-zinc-600"}`} />
                      <input
                        type={showNew ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={newPw}
                        onChange={e => setNewPw(e.target.value)}
                        onFocus={() => setPwFocused(true)}
                        onBlur={() => setPwFocused(false)}
                        placeholder="Min. 12 chars, uppercase + number"
                        className="w-full pl-11 pr-11 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all"
                      />
                      <button type="button" onClick={() => setShowNew(v => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors" tabIndex={-1}>
                        {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {newPw.length > 0 && (
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
                      style={{
                        borderRadius: "0.75rem",
                        boxShadow: confFocused
                          ? (!passwordsMatch && confirm.length > 0)
                            ? "0 0 0 1px rgba(239,68,68,0.4)"
                            : "0 0 0 1px rgba(139,92,246,0.4), 0 4px 20px rgba(139,92,246,0.08)"
                          : "none",
                      }}>
                      <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${confFocused ? "text-violet-400" : "text-zinc-600"}`} />
                      <input
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={confirm}
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
                        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
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
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/22 text-red-400 text-sm"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                        {error.includes("expired") && (
                          <Link href="/forgot-password" className="ml-auto text-violet-400 hover:text-violet-300 whitespace-nowrap text-xs">
                            Get new link
                          </Link>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="submit"
                    disabled={isLoading || !newPw || !confirm || !passwordsMatch || !token}
                    className="relative w-full h-12 rounded-xl font-semibold text-white overflow-hidden transition-all mt-1 disabled:opacity-55 disabled:cursor-not-allowed group"
                    style={{
                      background: "linear-gradient(135deg, hsl(258,85%,60%), hsl(258,85%,52%))",
                      boxShadow: (!isLoading && newPw && confirm && passwordsMatch) ? "0 4px 24px rgba(139,92,246,0.4), 0 1px 0 rgba(255,255,255,0.1) inset" : "none",
                    }}
                  >
                    <span className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700 ease-in-out" />
                    <span className="relative flex items-center justify-center gap-2">
                      {isLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Resetting…</>
                        : <><ArrowRight className="w-4 h-4" />Reset Password</>}
                    </span>
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
