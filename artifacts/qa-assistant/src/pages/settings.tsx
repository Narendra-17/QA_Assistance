import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetQaStats } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  User, Lock, BarChart3, Save, Loader2,
  Eye, EyeOff, CheckCircle2, AlertTriangle,
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
            {/* Current password */}
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

            {/* New password */}
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

            {/* Confirm password */}
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
