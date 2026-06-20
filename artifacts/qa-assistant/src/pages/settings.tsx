import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetQaStats } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Lock, BarChart3, Save, Loader2,
  Eye, EyeOff, CheckCircle2, AlertTriangle,
  ShieldCheck, ShieldOff, Smartphone, Copy, RefreshCw, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const ITEM = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]).{12,128}$/;
const MAX_RUNS = 500;

export default function Settings() {
  usePageTitle("Settings");
  const { user } = useAuth();
  const { data: stats } = useGetQaStats();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName,  setLastName]  = useState(user?.lastName  ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw,   setCurrentPw]   = useState("");
  const [newPw,       setNewPw]       = useState("");
  const [confirmPw,   setConfirmPw]   = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [savingPw,    setSavingPw]    = useState(false);

  // MFA state
  const [mfaEnabled,    setMfaEnabled]    = useState(false);
  const [mfaLoading,    setMfaLoading]    = useState(true);
  const [mfaStep,       setMfaStep]       = useState<"idle" | "setup" | "verify" | "backup-codes" | "disable">("idle");
  const [qrCodeUrl,     setQrCodeUrl]     = useState("");
  const [mfaSecret,     setMfaSecret]     = useState("");
  const [mfaCode,       setMfaCode]       = useState("");
  const [mfaVerifying,  setMfaVerifying]  = useState(false);
  const [backupCodes,   setBackupCodes]   = useState<string[]>([]);
  const [disablePw,     setDisablePw]     = useState("");
  const [disabling,     setDisabling]     = useState(false);
  const [copiedSecret,  setCopiedSecret]  = useState(false);

  const totalRuns = stats?.totalRuns ?? 0;
  const quotaPct  = Math.min((totalRuns / MAX_RUNS) * 100, 100);
  const quotaColor =
    totalRuns >= 450 ? "#EF4444" :
    totalRuns >= 400 ? "#F59E0B" : "#8B5CF6";

  const pwStrength = [
    newPw.length >= 12,
    /[A-Z]/.test(newPw),
    /[a-z]/.test(newPw),
    /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(newPw),
  ];

  useEffect(() => {
    fetch("/api/auth/mfa/status", { credentials: "include" })
      .then(r => r.json())
      .then((d: { mfaEnabled?: boolean }) => setMfaEnabled(d.mfaEnabled ?? false))
      .catch(() => {})
      .finally(() => setMfaLoading(false));
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) { toast.error("First name is required"); return; }
    setSavingProfile(true);
    try {
      const resp = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() || null }),
      });
      const data = await resp.json();
      if (!resp.ok) { toast.error(data.error ?? "Failed to update profile"); return; }
      toast.success("Profile updated successfully");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { toast.error("Passwords don't match"); return; }
    if (!PASSWORD_RE.test(newPw)) {
      toast.error("New password must be 12+ chars with uppercase, lowercase, and a number or special character");
      return;
    }
    setSavingPw(true);
    try {
      const resp = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await resp.json();
      if (!resp.ok) { toast.error(data.error ?? "Failed to change password"); return; }
      toast.success("Password changed successfully");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch {
      toast.error("Failed to change password");
    } finally {
      setSavingPw(false);
    }
  }

  async function handleMfaSetup() {
    setMfaLoading(true);
    try {
      const resp = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      const data = await resp.json() as { secret?: string; qrCodeDataUrl?: string; error?: string };
      if (!resp.ok) { toast.error(data.error ?? "Failed to initiate MFA setup"); return; }
      setQrCodeUrl(data.qrCodeDataUrl ?? "");
      setMfaSecret(data.secret ?? "");
      setMfaStep("setup");
    } catch {
      toast.error("Failed to initiate MFA setup");
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleMfaEnable(e: React.FormEvent) {
    e.preventDefault();
    if (mfaCode.length < 6) return;
    setMfaVerifying(true);
    try {
      const resp = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = await resp.json() as { success?: boolean; backupCodes?: string[]; error?: string };
      if (!resp.ok) { toast.error(data.error ?? "Verification failed"); return; }
      setBackupCodes(data.backupCodes ?? []);
      setMfaEnabled(true);
      setMfaCode("");
      setMfaStep("backup-codes");
    } catch {
      toast.error("Failed to enable MFA");
    } finally {
      setMfaVerifying(false);
    }
  }

  async function handleMfaDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!disablePw) return;
    setDisabling(true);
    try {
      const resp = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: disablePw }),
      });
      const data = await resp.json() as { success?: boolean; error?: string };
      if (!resp.ok) { toast.error(data.error ?? "Failed to disable MFA"); return; }
      setMfaEnabled(false);
      setMfaStep("idle");
      setDisablePw("");
      toast.success("Two-factor authentication disabled");
    } catch {
      toast.error("Failed to disable MFA");
    } finally {
      setDisabling(false);
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(mfaSecret).catch(() => {});
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  }

  return (
    <motion.div
      initial="hidden" animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      className="max-w-2xl mx-auto w-full space-y-6"
    >
      {/* Page header */}
      <motion.div variants={ITEM}>
        <h1 className="text-2xl font-display font-bold text-white">Account Settings</h1>
        <p className="text-zinc-500 mt-0.5 text-sm">Manage your profile, security, and usage.</p>
      </motion.div>

      {/* ── Profile ── */}
      <motion.div variants={ITEM}
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="absolute top-0 inset-x-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.45), transparent)" }} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-violet-500/14 border border-violet-500/22 flex items-center justify-center shrink-0"
              style={{ boxShadow: "0 0 16px rgba(139,92,246,0.15)" }}>
              <User className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-white">Profile</h2>
              <p className="text-xs text-zinc-500">Update your display name</p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-400">Email address</Label>
              <Input
                value={user?.email ?? ""}
                disabled
                className="h-9 bg-white/[0.02] border-white/6 text-zinc-500 rounded-xl text-sm cursor-not-allowed"
              />
              <p className="text-[11px] text-zinc-600">Email cannot be changed</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-400">First name</Label>
                <Input
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="First name"
                  maxLength={80}
                  className="h-9 bg-white/[0.03] border-white/8 focus-visible:border-violet-500/40 focus-visible:ring-0 text-white rounded-xl text-sm placeholder:text-zinc-600"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-400">Last name</Label>
                <Input
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Last name (optional)"
                  maxLength={80}
                  className="h-9 bg-white/[0.03] border-white/8 focus-visible:border-violet-500/40 focus-visible:ring-0 text-white rounded-xl text-sm placeholder:text-zinc-600"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm" disabled={savingProfile}
                className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-9 gap-1.5"
                style={{ boxShadow: "0 4px 14px rgba(139,92,246,0.3)" }}>
                {savingProfile
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
                Save Profile
              </Button>
            </div>
          </form>
        </div>
      </motion.div>

      {/* ── Password ── */}
      <motion.div variants={ITEM}
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="absolute top-0 inset-x-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(6,182,212,0.45), transparent)" }} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/12 border border-cyan-500/20 flex items-center justify-center shrink-0"
              style={{ boxShadow: "0 0 16px rgba(6,182,212,0.12)" }}>
              <Lock className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-white">Password</h2>
              <p className="text-xs text-zinc-500">Change your account password</p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-400">Current password</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  placeholder="Enter current password"
                  className="h-9 bg-white/[0.03] border-white/8 focus-visible:border-cyan-500/35 focus-visible:ring-0 text-white rounded-xl text-sm placeholder:text-zinc-600 pr-10"
                />
                <button type="button" onClick={() => setShowCurrent(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                  {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-400">New password</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="12+ chars, upper, lower, number/symbol"
                  className="h-9 bg-white/[0.03] border-white/8 focus-visible:border-cyan-500/35 focus-visible:ring-0 text-white rounded-xl text-sm placeholder:text-zinc-600 pr-10"
                />
                <button type="button" onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                  {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              {newPw.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    {pwStrength.map((ok, i) => (
                      <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
                        style={{ background: ok ? "#8B5CF6" : "rgba(255,255,255,0.08)" }} />
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    {["12+ characters", "Uppercase", "Lowercase", "Number or symbol"].map((label, i) => (
                      <span key={i} className={pwStrength[i] ? "text-violet-400" : ""}>
                        {i > 0 ? " · " : ""}{label}
                      </span>
                    ))}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-400">Confirm new password</Label>
              <div className="relative">
                <Input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Repeat new password"
                  className={[
                    "h-9 bg-white/[0.03] border-white/8 focus-visible:ring-0 text-white rounded-xl text-sm placeholder:text-zinc-600 pr-9",
                    confirmPw.length > 0 && confirmPw !== newPw
                      ? "border-red-500/40 focus-visible:border-red-500/60"
                      : confirmPw.length > 0 && confirmPw === newPw
                        ? "border-emerald-500/35 focus-visible:border-emerald-500/55"
                        : "focus-visible:border-cyan-500/35",
                  ].join(" ")}
                />
                {confirmPw.length > 0 && confirmPw === newPw && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400" />
                )}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm"
                disabled={savingPw || !currentPw || !newPw || !confirmPw}
                className="bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl h-9 gap-1.5"
                style={{ boxShadow: "0 4px 14px rgba(6,182,212,0.25)" }}>
                {savingPw
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Lock className="w-3.5 h-3.5" />}
                Change Password
              </Button>
            </div>
          </form>
        </div>
      </motion.div>

      {/* ── Two-Factor Authentication ── */}
      <motion.div variants={ITEM}
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
          border: mfaEnabled ? "1px solid rgba(16,185,129,0.18)" : "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="absolute top-0 inset-x-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${mfaEnabled ? "rgba(16,185,129,0.5)" : "rgba(139,92,246,0.35)"}, transparent)` }} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
              mfaEnabled
                ? "bg-emerald-500/12 border border-emerald-500/25"
                : "bg-violet-500/12 border border-violet-500/22"
            }`}
              style={{ boxShadow: mfaEnabled ? "0 0 16px rgba(16,185,129,0.12)" : "0 0 16px rgba(139,92,246,0.12)" }}>
              {mfaEnabled
                ? <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" />
                : <Smartphone className="w-4.5 h-4.5 text-violet-400" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-display font-semibold text-white">Two-Factor Authentication</h2>
                {mfaEnabled && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/12 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                    Enabled
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500">Add a second layer of security with an authenticator app</p>
            </div>
          </div>

          {mfaLoading ? (
            <div className="flex items-center gap-2 text-zinc-600 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading MFA status…
            </div>
          ) : (
            <AnimatePresence mode="wait">

              {/* ── idle: show enable/disable button ── */}
              {mfaStep === "idle" && (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {mfaEnabled ? (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/6 border border-emerald-500/15">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-300 leading-relaxed">
                          Your account is protected with two-factor authentication. You'll need your authenticator app each time you sign in.
                        </p>
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => setMfaStep("disable")}
                          className="border-red-500/25 text-red-400 hover:bg-red-500/8 hover:border-red-500/40 rounded-xl h-9 gap-1.5 bg-transparent">
                          <ShieldOff className="w-3.5 h-3.5" />
                          Disable 2FA
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/6 border border-amber-500/15">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300 leading-relaxed">
                          Two-factor authentication is not enabled. We strongly recommend enabling it to protect your account.
                        </p>
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" size="sm" onClick={handleMfaSetup} disabled={mfaLoading}
                          className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-9 gap-1.5"
                          style={{ boxShadow: "0 4px 14px rgba(139,92,246,0.3)" }}>
                          {mfaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          Enable 2FA
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── setup: show QR code ── */}
              {mfaStep === "setup" && (
                <motion.div key="setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="space-y-5">
                  <div>
                    <p className="text-sm text-zinc-400 mb-4">
                      Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.), then enter the 6-digit code to confirm.
                    </p>
                    <div className="flex gap-6 items-start">
                      {qrCodeUrl && (
                        <div className="shrink-0 p-3 bg-white rounded-xl">
                          <img src={qrCodeUrl} alt="MFA QR Code" className="w-36 h-36" />
                        </div>
                      )}
                      <div className="flex-1 space-y-3">
                        <div>
                          <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Manual entry key</p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs font-mono text-violet-300 bg-violet-500/8 border border-violet-500/18 rounded-lg px-3 py-2 break-all leading-relaxed">
                              {mfaSecret.match(/.{1,4}/g)?.join(" ") ?? mfaSecret}
                            </code>
                            <button type="button" onClick={copySecret}
                              className="p-2 rounded-lg border border-white/8 bg-white/4 hover:bg-white/8 text-zinc-500 hover:text-zinc-300 transition-all shrink-0"
                              title="Copy secret">
                              {copiedSecret ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleMfaEnable} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-zinc-400">Verification code</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={mfaCode}
                        onChange={e => setMfaCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000"
                        autoFocus
                        className="h-9 bg-white/[0.03] border-white/8 focus-visible:border-violet-500/40 focus-visible:ring-0 text-white rounded-xl text-sm font-mono tracking-[0.3em] text-center placeholder:text-zinc-600 placeholder:tracking-normal"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <button type="button" onClick={() => { setMfaStep("idle"); setMfaCode(""); }}
                        className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1">
                        <X className="w-3.5 h-3.5" />Cancel
                      </button>
                      <Button type="submit" size="sm" disabled={mfaVerifying || mfaCode.length < 6}
                        className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-9 gap-1.5"
                        style={{ boxShadow: "0 4px 14px rgba(139,92,246,0.3)" }}>
                        {mfaVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        Verify & Enable
                      </Button>
                    </div>
                  </form>
                </motion.div>
              )}

              {/* ── backup codes: shown after enabling ── */}
              {mfaStep === "backup-codes" && (
                <motion.div key="backup-codes" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="space-y-4">
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/6 border border-emerald-500/15">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-emerald-300 font-semibold mb-0.5">Two-factor authentication enabled!</p>
                      <p className="text-xs text-emerald-400/70">Save these backup codes in a safe place. Each code can only be used once.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Backup codes</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {backupCodes.map((code, i) => (
                        <div key={i} className="font-mono text-xs text-zinc-300 bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-center tracking-widest">
                          {code}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(backupCodes.join("\n")).catch(() => {});
                        toast.success("Backup codes copied to clipboard");
                      }}
                      className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      Copy all codes
                    </button>
                  </div>

                  <div className="flex justify-end">
                    <Button type="button" size="sm" onClick={() => setMfaStep("idle")}
                      className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-9 gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Done
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* ── disable: require password ── */}
              {mfaStep === "disable" && (
                <motion.div key="disable" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="space-y-4">
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-500/6 border border-red-500/15">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300 leading-relaxed">
                      Disabling two-factor authentication will make your account less secure. Enter your password to confirm.
                    </p>
                  </div>

                  <form onSubmit={handleMfaDisable} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-zinc-400">Current password</Label>
                      <Input
                        type="password"
                        value={disablePw}
                        onChange={e => setDisablePw(e.target.value)}
                        placeholder="Enter your password to confirm"
                        autoFocus
                        className="h-9 bg-white/[0.03] border-white/8 focus-visible:border-red-500/40 focus-visible:ring-0 text-white rounded-xl text-sm placeholder:text-zinc-600"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <button type="button" onClick={() => { setMfaStep("idle"); setDisablePw(""); }}
                        className="text-sm text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1">
                        <X className="w-3.5 h-3.5" />Cancel
                      </button>
                      <Button type="submit" size="sm" disabled={disabling || !disablePw}
                        className="bg-red-600 hover:bg-red-500 text-white rounded-xl h-9 gap-1.5">
                        {disabling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                        Disable 2FA
                      </Button>
                    </div>
                  </form>
                </motion.div>
              )}

            </AnimatePresence>
          )}
        </div>
      </motion.div>

      {/* ── Usage ── */}
      <motion.div variants={ITEM}
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="absolute top-0 inset-x-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${quotaColor}60, transparent)` }} />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-amber-500/12 border border-amber-500/20 flex items-center justify-center shrink-0"
              style={{ boxShadow: "0 0 16px rgba(245,158,11,0.12)" }}>
              <BarChart3 className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-white">Usage</h2>
              <p className="text-xs text-zinc-500">Your scan quota for this account</p>
            </div>
            <div className="ml-auto font-mono text-xs font-semibold tabular-nums" style={{ color: quotaColor }}>
              {totalRuns} / {MAX_RUNS}
            </div>
          </div>

          <div className="space-y-2">
            <div className="h-2.5 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${quotaPct}%`,
                  background: `linear-gradient(90deg, ${quotaColor}aa, ${quotaColor})`,
                  boxShadow: `0 0 8px ${quotaColor}50`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-600">
              <span>{MAX_RUNS - totalRuns} scans remaining</span>
              <span>{quotaPct.toFixed(0)}% used</span>
            </div>
          </div>

          {totalRuns >= 400 && (
            <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300 leading-relaxed">
                You're approaching your scan limit. Delete old runs from the dashboard to free up space, or contact support to increase your quota.
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
