import { useGetQaRun } from "@workspace/api-client-react";
import { useParams, Link, useLocation } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft, AlertTriangle, ShieldAlert, Info, Bug, CheckCircle2,
  Copy, Download, Globe, FileCode2, Loader2, XCircle,
  TrendingUp, BarChart3, RotateCcw, ChevronDown, ChevronUp,
  Share2, FileText, Shield, Clock, Check, Eye, X, Zap,
  Wand2, Target, Swords, Layers, Search, Bell, History, ListFilter, ArrowUpDown,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip as RechartTooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Issue {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  possibleCause: string;
  suggestedFix: string;
  codeSnippet?: string | null;
  filePath?: string | null;
  lineNumber?: number | null;
  detectionMethod?: "deterministic" | "sca-osv" | "ai";
  owasp?: string | null;
  effortLevel?: "low" | "medium" | "high" | null;
  effortNote?: string | null;
}

interface Report {
  summary: string;
  issues: Issue[];
  overallScore: number;
  recommendations: string[];
  testType?: "url" | "sast";
  deterministicFindings?: { secretsFound: number; vulnerableDepsFound: number };
}

interface RunData {
  id: string;
  appUrl?: string | null;
  projectName?: string | null;
  appDescription?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  runType: "url" | "sast";
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  report?: Report | null;
}

interface IssueStatus {
  id: string;
  issueIndex: number;
  status: "open" | "acknowledged" | "resolved" | "wont_fix";
  note?: string | null;
}

// ─── Severity config ──────────────────────────────────────────────────────────

const SEV_CONFIG = {
  critical: { label: "Critical", color: "#EF4444", bg: "rgba(239,68,68,0.07)", border: "rgba(239,68,68,0.18)", icon: ShieldAlert, order: 0 },
  high:     { label: "High",     color: "#F97316", bg: "rgba(249,115,22,0.07)", border: "rgba(249,115,22,0.18)", icon: AlertTriangle, order: 1 },
  medium:   { label: "Medium",   color: "#F59E0B", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.18)", icon: Bug, order: 2 },
  low:      { label: "Low",      color: "#06B6D4", bg: "rgba(6,182,212,0.07)",  border: "rgba(6,182,212,0.18)",  icon: Info, order: 3 },
} as const;
type SevKey = keyof typeof SEV_CONFIG;

// ─── Jargon glossary ──────────────────────────────────────────────────────────

const GLOSSARY: Record<string, string> = {
  "SQL injection": "An attack where malicious SQL code is inserted into a query, allowing attackers to read or modify your database.",
  "XSS": "Cross-Site Scripting — injecting malicious scripts into web pages that run in other users' browsers.",
  "CSRF": "Cross-Site Request Forgery — tricks a user's browser into making unwanted requests using their credentials.",
  "SSRF": "Server-Side Request Forgery — tricks your server into making HTTP requests to internal services.",
  "IDOR": "Insecure Direct Object Reference — accessing another user's data by guessing their ID.",
  "path traversal": "An attack that uses ../ sequences to access files outside the intended directory.",
  "command injection": "Injecting OS commands into shell calls in your code, giving attackers system access.",
  "prototype pollution": "Modifying JavaScript's Object prototype to affect all objects in the application.",
  "deserialization": "Converting data back into objects — insecure deserialization can lead to remote code execution.",
  "OWASP": "Open Worldwide Application Security Project — the standard framework for classifying web vulnerabilities.",
  "CSP": "Content Security Policy — a browser mechanism that restricts which scripts and resources can load.",
  "HSTS": "HTTP Strict Transport Security — forces browsers to always use HTTPS for your domain.",
  "CVSS": "Common Vulnerability Scoring System — a 0-10 scale for rating vulnerability severity.",
  "CVE": "Common Vulnerabilities and Exposures — an official database of known security vulnerabilities.",
  "RCE": "Remote Code Execution — the most severe class of vulnerability, allowing an attacker to run arbitrary code.",
  "SAST": "Static Application Security Testing — analysing source code for vulnerabilities without running it.",
  "DAST": "Dynamic Application Security Testing — testing a running application for security issues.",
  "SCA": "Software Composition Analysis — scanning dependencies for known vulnerabilities.",
  "IAM": "Identity and Access Management — controlling who can access what in a cloud environment.",
  "MFA": "Multi-Factor Authentication — requiring a second proof of identity beyond a password.",
  "privilege escalation": "Gaining higher permissions than originally granted, e.g., becoming admin from a regular user.",
  "RBAC": "Role-Based Access Control — restricting system access based on user roles.",
  "PII": "Personally Identifiable Information — data that could identify a specific individual (name, email, etc.).",
  "entropy": "A measure of randomness — high-entropy strings are more likely to be secrets like API keys.",
  "hardcoded": "A value written directly in source code instead of being loaded from a secure configuration.",
};

// ─── OWASP / Effort intelligence constants ────────────────────────────────────

const OWASP_CATS = [
  { id: "A01", name: "Broken Access Control",                    color: "#EF4444" },
  { id: "A02", name: "Cryptographic Failures",                   color: "#F97316" },
  { id: "A03", name: "Injection",                                color: "#EF4444" },
  { id: "A04", name: "Insecure Design",                          color: "#F59E0B" },
  { id: "A05", name: "Security Misconfiguration",                color: "#F59E0B" },
  { id: "A06", name: "Vulnerable Components",                    color: "#F97316" },
  { id: "A07", name: "Auth Failures",                            color: "#EF4444" },
  { id: "A08", name: "Integrity Failures",                       color: "#F97316" },
  { id: "A09", name: "Logging Failures",                         color: "#06B6D4" },
  { id: "A10", name: "SSRF",                                     color: "#8B5CF6" },
] as const;

const EFFORT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low:    { label: "< 2h",  color: "#10B981", bg: "rgba(16,185,129,0.09)",  border: "rgba(16,185,129,0.22)"  },
  medium: { label: "~1d",   color: "#F59E0B", bg: "rgba(245,158,11,0.09)",  border: "rgba(245,158,11,0.22)"  },
  high:   { label: "Days",  color: "#F97316", bg: "rgba(249,115,22,0.09)",  border: "rgba(249,115,22,0.22)"  },
};

function guessOwasp(issue: Issue): string {
  const txt = `${issue.title} ${issue.description} ${issue.possibleCause ?? ""}`.toLowerCase();
  if (/sql|xss|inject|template injection|code injection|command inject/.test(txt)) return "A03";
  if (/auth|login|session|jwt|password|credential|privilege|idor|access control|broken access/.test(txt)) return "A01";
  if (/crypto|tls|ssl|encrypt|hash|weak cipher|plaintext password|insecure hash/.test(txt)) return "A02";
  if (/secret|hardcoded|api.key|token in code|entropy/.test(txt)) return "A02";
  if (/cors|header|csp|debug|misconfigur|default credential|stack trace/.test(txt)) return "A05";
  if (/dependency|cve|vulnerable component|outdated package|known vuln/.test(txt)) return "A06";
  if (/deserialization|integrity|supply chain|unsigned/.test(txt)) return "A08";
  if (/log|monitor|audit trail|no alerting/.test(txt)) return "A09";
  if (/ssrf|server.side request/.test(txt)) return "A10";
  if (/rate limit|brute force|account lockout|multi.factor/.test(txt)) return "A07";
  return "A04";
}

function getIssueOwaspCode(issue: Issue): string {
  if (issue.owasp) { const m = issue.owasp.match(/^(A\d{2})/); if (m) return m[1]; }
  return guessOwasp(issue);
}

// ─── Intelligence Panel ───────────────────────────────────────────────────────

interface AugmentedReport extends Report {
  attackChain?: string | null;
}

function IntelligencePanel({ report, issues, activeOwasp, onOwaspFilter }: {
  report: AugmentedReport; issues: Issue[];
  activeOwasp: string | null;
  onOwaspFilter: (code: string | null) => void;
}) {
  const [open, setOpen] = useState(true);

  const owaspCounts: Record<string, { count: number; critical: number }> = {};
  for (const issue of issues) {
    const code = getIssueOwaspCode(issue);
    if (!owaspCounts[code]) owaspCounts[code] = { count: 0, critical: 0 };
    owaspCounts[code].count++;
    if (issue.severity === "critical" || issue.severity === "high") owaspCounts[code].critical++;
  }

  const donutData = OWASP_CATS
    .filter(c => (owaspCounts[c.id]?.count ?? 0) > 0)
    .map(c => ({ name: c.name, value: owaspCounts[c.id]!.count, color: c.color, id: c.id }));

  const affectedCount = Object.keys(owaspCounts).length;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/8 overflow-hidden"
      style={{ background: "linear-gradient(145deg, hsl(230,22%,7%), hsl(230,22%,6%))" }}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/2 transition-colors"
        onClick={() => setOpen(v => !v)}>
        <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/22 flex items-center justify-center">
          <Layers className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <span className="text-sm font-display font-semibold text-white">Threat Intelligence</span>
        <span className="text-[11px] text-zinc-500 ml-1">{affectedCount} OWASP categor{affectedCount === 1 ? "y" : "ies"} affected</span>
        <div className="ml-auto">
          {open ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-4">

              {/* Attack Chain Narrative */}
              {report.attackChain && (
                <div className="p-4 rounded-2xl border border-red-500/18 bg-red-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-md bg-red-500/15 border border-red-500/22 flex items-center justify-center shrink-0">
                      <Swords className="w-3 h-3 text-red-400" />
                    </div>
                    <p className="text-xs font-bold text-red-300 uppercase tracking-wider">Attacker's Playbook</p>
                    <span className="ml-auto text-[9px] text-red-400/60 bg-red-500/8 border border-red-500/14 px-2 py-0.5 rounded-full font-medium">AI Threat Narrative</span>
                  </div>
                  <p className="text-sm text-red-200/75 leading-relaxed italic">
                    "<AnnotatedText text={report.attackChain} />"
                  </p>
                </div>
              )}

              {/* OWASP matrix + donut grid */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_190px] gap-4">
                {/* OWASP Top 10 matrix */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-3.5 h-3.5 text-cyan-400" />
                    <p className="text-xs font-semibold text-white">OWASP Top 10 Coverage</p>
                    <span className="text-[10px] text-zinc-600 ml-auto">2021 edition</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {OWASP_CATS.map((cat) => {
                      const cnt = owaspCounts[cat.id]?.count ?? 0;
                      const hasCrit = (owaspCounts[cat.id]?.critical ?? 0) > 0;
                      const isActive = activeOwasp === cat.id;
                      return (
                        <button key={cat.id}
                          onClick={() => cnt > 0 && onOwaspFilter(cat.id)}
                          disabled={cnt === 0}
                          className={[
                            "p-2 rounded-xl border text-center transition-all w-full",
                            cnt > 0 ? "cursor-pointer hover:scale-[1.03] active:scale-95" : "cursor-default",
                          ].join(" ")}
                          style={cnt > 0
                            ? { background: `${cat.color}${isActive ? "22" : "0D"}`, borderColor: `${cat.color}${isActive ? "60" : "2A"}`, boxShadow: isActive ? `0 0 0 2px ${cat.color}40` : undefined }
                            : { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.05)" }
                          }>
                          <div className="text-[9px] font-bold font-mono mb-1"
                            style={{ color: cnt > 0 ? cat.color : "#3f3f46" }}>{cat.id}</div>
                          <div className="text-[8px] text-zinc-600 leading-tight mb-1.5 line-clamp-2 min-h-[18px]">{cat.name}</div>
                          {cnt > 0
                            ? <div className="text-[11px] font-bold" style={{ color: cat.color }}>
                                {cnt}{hasCrit && <span className="text-[7px] ml-0.5">●</span>}
                              </div>
                            : <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500/35 mx-auto" />
                          }
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <p className="text-[9px] text-zinc-600">● = contains critical/high · Click a cell to filter issues below</p>
                    {activeOwasp && (
                      <button onClick={() => onOwaspFilter(null)}
                        className="ml-auto flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-200 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-lg transition-colors">
                        <X className="w-2.5 h-2.5" />
                        Clear {activeOwasp} filter
                      </button>
                    )}
                  </div>
                </div>

                {/* Category donut */}
                {donutData.length > 0 && (
                  <div className="flex flex-col">
                    <p className="text-xs font-semibold text-white mb-2">Issue Distribution</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={34} outerRadius={52}
                          paddingAngle={3} dataKey="value" stroke="none">
                          {donutData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                          ))}
                        </Pie>
                        <RechartTooltip
                          contentStyle={{ background: "hsl(230,24%,9%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 10 }}
                          formatter={(val: number, name: string) => [val, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 mt-1">
                      {donutData.map(d => (
                        <div key={d.id} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color }} />
                          <span className="font-mono text-[9px] font-bold shrink-0" style={{ color: d.color }}>{d.id}</span>
                          <span className="truncate text-zinc-500">{d.name}</span>
                          <span className="ml-auto font-semibold shrink-0" style={{ color: d.color }}>{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function GlossaryTerm({ term, children }: { term: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const def = GLOSSARY[term];
  if (!def) return <>{children}</>;
  return (
    <span className="relative inline">
      <button
        className="underline decoration-dotted decoration-zinc-500 cursor-help text-inherit"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(v => !v)}
      >
        {children}
      </button>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            className="absolute z-50 bottom-full left-0 mb-2 w-64 p-3 rounded-xl border border-violet-500/20 shadow-xl text-xs text-zinc-300 leading-relaxed"
            style={{ background: "hsl(230,25%,10%)" }}
          >
            <span className="font-bold text-violet-300 block mb-1">{term}</span>
            {def}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Wraps known jargon terms in the given text with glossary tooltips. */
function AnnotatedText({ text }: { text: string }) {
  const terms = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  // Build segments
  const segments: Array<{ text: string; term?: string }> = [{ text }];
  for (const term of terms) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.term) continue;
      const idx = seg.text.toLowerCase().indexOf(term.toLowerCase());
      if (idx === -1) continue;
      const before = seg.text.slice(0, idx);
      const match = seg.text.slice(idx, idx + term.length);
      const after = seg.text.slice(idx + term.length);
      segments.splice(i, 1,
        ...(before ? [{ text: before }] : []),
        { text: match, term },
        ...(after ? [{ text: after }] : []),
      );
      break;
    }
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.term
          ? <GlossaryTerm key={i} term={seg.term}>{seg.text}</GlossaryTerm>
          : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const mounted = useRef(false);
  const [animated, setAnimated] = useState(false);
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : score >= 40 ? "#F97316" : "#EF4444";
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = animated ? (score / 100) * circ : 0;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; requestAnimationFrame(() => setAnimated(true)); }
  }, []);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="9" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="9"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 10px ${color}70)`, transition: "stroke-dasharray 1.4s cubic-bezier(.4,0,.2,1)" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="font-display font-black text-4xl text-white leading-none">{score}</span>
          <span className="text-[11px] text-zinc-500 font-medium">/100</span>
        </div>
      </div>
      <div className="font-display font-bold text-lg" style={{ color }}>Grade {grade}</div>
    </div>
  );
}

function SeverityBar({ issues }: { issues: Issue[] }) {
  const counts: Record<SevKey, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });
  return (
    <div className="grid grid-cols-4 gap-2">
      {(Object.entries(SEV_CONFIG) as [SevKey, typeof SEV_CONFIG[SevKey]][]).map(([key, cfg]) => (
        <div key={key} className="text-center p-3 rounded-xl border transition-colors"
          style={{ background: cfg.bg, borderColor: cfg.border }}>
          <div className="text-xl font-display font-bold" style={{ color: cfg.color }}>{counts[key]}</div>
          <div className="text-[11px] mt-0.5 font-medium" style={{ color: cfg.color }}>{cfg.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProgressAnalysis({ isUrl, startedAt }: { isUrl: boolean; startedAt?: string }) {
  const steps = isUrl
    ? ["Fetching URL", "Parsing HTML", "Checking headers", "AI analysis", "Generating report"]
    : ["Reading files", "Detecting secrets", "Scanning dependencies", "AI analysis", "Generating report"];
  const [step, setStep]       = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setStep(s => (s + 1) % steps.length), 2800);
    return () => clearInterval(interval);
  }, [steps.length]);

  useEffect(() => {
    const base = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0;
    setElapsed(base);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="text-center py-20 rounded-2xl border border-violet-500/12 bg-violet-500/4">
      <div className="relative inline-flex mb-6">
        <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-lg animate-pulse" />
        <div className="relative w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
        </div>
      </div>
      <h3 className="text-lg font-display font-bold text-white mb-2">AI Analysis in Progress</h3>
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        <AnimatePresence mode="wait">
          <motion.p key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="text-zinc-400 text-sm min-w-[220px]">
            {steps[step]}…
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="flex justify-center gap-1.5 mb-4">
        {steps.map((_, i) => (
          <div key={i} className="h-1 rounded-full transition-all duration-500"
            style={{ width: i === step ? 24 : 8, background: i <= step ? "#8B5CF6" : "rgba(255,255,255,0.1)" }} />
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 mb-1">
        <span className="font-mono text-violet-400 text-sm font-semibold tabular-nums">{elapsedStr}</span>
        <span className="text-zinc-600 text-xs">elapsed</span>
      </div>
      <p className="text-zinc-600 text-xs">This typically takes 20–40 seconds</p>
    </div>
  );
}

// Issue status controls
const STATUS_CONFIG = {
  open:         { label: "Open",         color: "text-zinc-400",   bg: "bg-white/5",          icon: Eye },
  acknowledged: { label: "Acknowledged", color: "text-yellow-400", bg: "bg-yellow-500/10",    icon: Eye },
  resolved:     { label: "Resolved",     color: "text-emerald-400",bg: "bg-emerald-500/10",   icon: Check },
  wont_fix:     { label: "Won't Fix",    color: "text-zinc-500",   bg: "bg-white/5",          icon: X },
} as const;

function IssueStatusButton({
  issueIndex, runId, currentStatus, onUpdate,
}: {
  issueIndex: number;
  runId: string;
  currentStatus: IssueStatus["status"];
  onUpdate: (idx: number, status: IssueStatus["status"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[currentStatus];
  const Icon = cfg.icon;

  const statuses: IssueStatus["status"][] = ["open", "acknowledged", "resolved", "wont_fix"];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border border-white/8 transition-colors ${cfg.color} ${cfg.bg} hover:border-white/16`}
      >
        <Icon className="w-3 h-3" />
        {cfg.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.97 }}
              className="absolute right-0 top-full mt-1 z-50 rounded-xl border border-white/10 overflow-hidden shadow-xl min-w-[150px]"
              style={{ background: "hsl(230,25%,10%)" }}
            >
              {statuses.map(s => {
                const c = STATUS_CONFIG[s];
                const SIcon = c.icon;
                return (
                  <button key={s} onClick={(e) => { e.stopPropagation(); onUpdate(issueIndex, s); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-medium text-left hover:bg-white/5 transition-colors ${c.color} ${s === currentStatus ? "bg-white/5" : ""}`}>
                    <SIcon className="w-3.5 h-3.5" />
                    {c.label}
                    {s === currentStatus && <Check className="w-3 h-3 ml-auto" />}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Share modal
function ShareModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [duration, setDuration] = useState(168);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const durations = [
    { label: "24 hours", hours: 24 },
    { label: "7 days", hours: 168 },
    { label: "30 days", hours: 720 },
  ];

  async function generateLink() {
    setLoading(true);
    try {
      const resp = await fetch(`/api/qa/runs/${runId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInHours: duration }),
      });
      if (!resp.ok) throw new Error("Failed to create share link");
      const { token } = await resp.json() as { token: string };
      const base = window.location.origin + (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      setShareUrl(`${base}/share/${token}`);
    } catch {
      toast.error("Failed to generate share link");
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => toast.success("Link copied to clipboard!"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-2xl"
        style={{ background: "hsl(230,25%,10%)" }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Share2 className="w-4 h-4 text-violet-400" />
            </div>
            <h3 className="font-display font-bold text-white">Share Report</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-zinc-400 text-sm mb-5 leading-relaxed">
          Generate a read-only link. Anyone with the link can view the report — no account required.
        </p>
        {!shareUrl ? (
          <>
            <div className="mb-5">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Link expires after</p>
              <div className="flex gap-2">
                {durations.map(d => (
                  <button key={d.hours} onClick={() => setDuration(d.hours)}
                    className={["flex-1 py-2 rounded-xl text-sm font-medium border transition-all", duration === d.hours
                      ? "bg-violet-600 border-violet-500 text-white"
                      : "bg-white/4 border-white/8 text-zinc-400 hover:border-white/16 hover:text-white"
                    ].join(" ")}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={generateLink} disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white rounded-xl gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              Generate Link
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-emerald-300 text-xs font-medium">Share link created!</span>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2.5 rounded-xl border border-white/8 bg-white/4 text-xs font-mono text-zinc-400 truncate">
                {shareUrl}
              </div>
              <Button size="sm" onClick={copyLink}
                className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl shrink-0 gap-1.5">
                <Copy className="w-3.5 h-3.5" />Copy
              </Button>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="w-3 h-3" />
              Expires in {durations.find(d => d.hours === duration)?.label}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── PDF export ───────────────────────────────────────────────────────────────

async function exportPdf(run: RunData, report: Report) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  const BG = [14, 15, 22] as [number, number, number];
  const VIOLET = [139, 92, 246] as [number, number, number];
  const WHITE = [255, 255, 255] as [number, number, number];
  const ZINC = [113, 113, 122] as [number, number, number];
  const ZINC_LIGHT = [161, 161, 170] as [number, number, number];

  const SEV_COLORS: Record<string, [number, number, number]> = {
    critical: [239, 68, 68],
    high: [249, 115, 22],
    medium: [245, 158, 11],
    low: [6, 182, 212],
  };

  function addPage() {
    doc.addPage();
    doc.setFillColor(...BG);
    doc.rect(0, 0, W, pageH, "F");
    y = margin;
  }

  function checkPageBreak(needed: number) {
    if (y + needed > pageH - margin) addPage();
  }

  // Cover page
  doc.setFillColor(...BG);
  doc.rect(0, 0, W, pageH, "F");

  // Violet accent bar
  doc.setFillColor(...VIOLET);
  doc.roundedRect(margin, 20, 4, 32, 2, 2, "F");

  doc.setTextColor(...VIOLET);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("QA ASSISTANT", margin + 10, 30);

  doc.setTextColor(...WHITE);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  const title = run.appUrl ?? run.projectName ?? "Security Assessment";
  const titleLines = doc.splitTextToSize(title, W - (margin * 2) - 10) as string[];
  doc.text(titleLines, margin + 10, 42);

  doc.setTextColor(...ZINC_LIGHT);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${run.runType === "url" ? "URL Test" : "SAST Scan"} · ${format(new Date(run.createdAt), "MMMM d, yyyy")}`, margin + 10, 58);

  // Score box
  const score = report.overallScore;
  const scoreColor: [number, number, number] = score >= 80 ? [16, 185, 129] : score >= 60 ? [245, 158, 11] : score >= 40 ? [249, 115, 22] : [239, 68, 68];
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2], 0.1);
  doc.roundedRect(W - margin - 40, 20, 40, 44, 6, 6, "F");
  doc.setTextColor(...scoreColor);
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text(String(score), W - margin - 20, 42, { align: "center" });
  doc.setFontSize(8);
  doc.text(`Grade ${grade}`, W - margin - 20, 52, { align: "center" });

  // Counts
  y = 80;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  report.issues.forEach(i => { if (i.severity in counts) counts[i.severity as SevKey]++; });
  const sevBoxW = (W - margin * 2 - 9) / 4;
  let bx = margin;
  for (const [sev, count] of Object.entries(counts)) {
    const c = SEV_COLORS[sev];
    doc.setFillColor(c[0], c[1], c[2], 0.08);
    doc.roundedRect(bx, y, sevBoxW, 18, 4, 4, "F");
    doc.setTextColor(c[0], c[1], c[2]);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(String(count), bx + sevBoxW / 2, y + 9, { align: "center" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(sev.toUpperCase(), bx + sevBoxW / 2, y + 15, { align: "center" });
    bx += sevBoxW + 3;
  }
  y += 28;

  // Summary
  doc.setFillColor(255, 255, 255, 0.02);
  doc.roundedRect(margin, y, W - margin * 2, 2, 0, 0, "F");
  y += 6;
  doc.setTextColor(...ZINC);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("EXECUTIVE SUMMARY", margin, y);
  y += 5;
  doc.setTextColor(...ZINC_LIGHT);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const summaryLines = doc.splitTextToSize(report.summary, W - margin * 2) as string[];
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 5 + 10;

  // Issues table
  if (report.issues.length > 0) {
    checkPageBreak(20);
    doc.setTextColor(...ZINC);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(`ISSUES (${report.issues.length})`, margin, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Severity", "Title", "File", "Detection"]],
      body: report.issues.map(issue => [
        issue.severity.toUpperCase(),
        issue.title,
        issue.filePath ?? "-",
        issue.detectionMethod === "deterministic" ? "Secrets" : issue.detectionMethod === "sca-osv" ? "SCA/CVE" : "AI",
      ]),
      headStyles: { fillColor: [30, 30, 42], textColor: ZINC_LIGHT, fontSize: 7, fontStyle: "bold" },
      bodyStyles: { fillColor: BG, textColor: ZINC_LIGHT, fontSize: 7.5 },
      alternateRowStyles: { fillColor: [20, 21, 32] },
      columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 36, fontSize: 6.5 }, 3: { cellWidth: 22 } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const sev = String(data.cell.raw).toLowerCase();
          const c = SEV_COLORS[sev] ?? ZINC_LIGHT;
          data.cell.styles.textColor = c;
          data.cell.styles.fontStyle = "bold";
        }
      },
      didDrawPage: () => {
        doc.setFillColor(...BG);
        doc.rect(0, 0, W, margin - 1, "F");
      },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  // Detailed issues
  for (let i = 0; i < report.issues.length; i++) {
    const issue = report.issues[i];
    const cfg = SEV_COLORS[issue.severity] ?? ZINC_LIGHT;
    checkPageBreak(40);

    doc.setFillColor(cfg[0], cfg[1], cfg[2], 0.06);
    doc.roundedRect(margin, y, W - margin * 2, 8, 3, 3, "F");
    doc.setTextColor(cfg[0], cfg[1], cfg[2]);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(`[${issue.severity.toUpperCase()}] ${i + 1}. ${issue.title}`, margin + 3, y + 5.5);
    if (issue.filePath) {
      doc.setTextColor(...ZINC);
      doc.setFontSize(6);
      doc.text(issue.filePath, W - margin - 3, y + 5.5, { align: "right" });
    }
    y += 10;

    const descLines = doc.splitTextToSize(issue.description, W - margin * 2) as string[];
    checkPageBreak(descLines.length * 4 + 4);
    doc.setTextColor(...ZINC_LIGHT);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(descLines, margin, y);
    y += descLines.length * 4 + 2;

    if (issue.suggestedFix) {
      checkPageBreak(12);
      doc.setTextColor(...ZINC);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text("Fix: ", margin, y);
      doc.setTextColor(...ZINC_LIGHT);
      doc.setFont("helvetica", "normal");
      const fixLines = doc.splitTextToSize(issue.suggestedFix, W - margin * 2 - 8) as string[];
      doc.text(fixLines, margin + 8, y);
      y += fixLines.length * 4 + 6;
    } else {
      y += 4;
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    checkPageBreak(20);
    doc.setTextColor(...ZINC);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text("STRATEGIC RECOMMENDATIONS", margin, y);
    y += 5;
    for (let i = 0; i < report.recommendations.length; i++) {
      const rec = report.recommendations[i];
      const lines = doc.splitTextToSize(`${i + 1}. ${rec}`, W - margin * 2) as string[];
      checkPageBreak(lines.length * 4 + 3);
      doc.setTextColor(...ZINC_LIGHT);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(lines, margin, y);
      y += lines.length * 4 + 2;
    }
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(255, 255, 255, 0.03);
    doc.rect(0, pageH - 10, W, 10, "F");
    doc.setTextColor(...ZINC);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.text("Generated by QA Assistant", margin, pageH - 4);
    doc.text(`Page ${p} / ${totalPages}`, W - margin, pageH - 4, { align: "right" });
  }

  doc.save(`qa-report-${run.id.slice(0, 8)}.pdf`);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [filterSev, setFilterSev] = useState<"all" | SevKey>("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const issueSearchRef = useRef<HTMLInputElement>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [fixLoading, setFixLoading] = useState<Record<number, boolean>>({});
  const [fixResults, setFixResults] = useState<Record<number, { fixCode: string; explanation: string; language: string; testSuggestion: string }>>({});
  const [filterOwasp, setFilterOwasp] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | IssueStatus["status"]>("all");
  const [sortBy, setSortBy] = useState<"severity" | "effort" | "owasp">("severity");
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<string | undefined>(undefined);

  const { data: run, isLoading } = (useGetQaRun as any)(id!, {
    query: { refetchInterval: pollingEnabled ? 3000 : false, staleTime: 0 },
  }) as { data: RunData | undefined; isLoading: boolean };

  useEffect(() => {
    if (run?.status === "completed" || run?.status === "failed") setPollingEnabled(false);
  }, [run?.status]);

  // Browser notification when scan finishes
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = run?.status;
    if (
      prev && (prev === "running" || prev === "pending") &&
      (run?.status === "completed" || run?.status === "failed")
    ) {
      if ("Notification" in window && Notification.permission === "granted") {
        const title = run.status === "completed" ? "Scan Complete — QA Assistant" : "Scan Failed — QA Assistant";
        const body = run.status === "completed"
          ? `${run.appUrl ?? run.projectName ?? "Assessment"} scored ${(run.report as Report | null)?.overallScore ?? "?"}/100`
          : `${run.appUrl ?? run.projectName ?? "Assessment"} failed to complete`;
        new Notification(title, { body, icon: `${import.meta.env.BASE_URL}favicon.ico` });
      }
    }
  }, [run?.status]);

  // Request notification permission when scan starts
  useEffect(() => {
    if (
      (run?.status === "running" || run?.status === "pending") &&
      "Notification" in window && Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, [run?.status]);

  // Keep a ref of issues length so the keydown handler can clamp without stale closure
  const issuesLengthRef = useRef(0);

  // Auto-scroll when keyboard navigation moves to a new issue
  useEffect(() => {
    if (expandedIssue === null) return;
    const el = document.querySelector<HTMLElement>(`[data-issue-idx="${expandedIssue}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [expandedIssue]);

  // Keyboard shortcuts: j/k navigate issues, / focus search, Escape collapse
  useEffect(() => {
    if (run?.status !== "completed") return;
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setExpandedIssue(prev => {
          const len = issuesLengthRef.current;
          if (len === 0) return null;
          return Math.min(prev === null ? 0 : prev + 1, len - 1);
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setExpandedIssue(prev => {
          if (prev === null || prev === 0) return 0;
          return prev - 1;
        });
      } else if (e.key === "Escape") {
        setExpandedIssue(null);
      } else if (e.key === "/") {
        e.preventDefault();
        issueSearchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [run?.status]);

  // Stats for same-target run history
  const target = run?.appUrl ?? run?.projectName;
  const targetLabel = useMemo(() => {
    if (!target) return null;
    if (run?.appUrl) { try { return new URL(run.appUrl).hostname; } catch { return run.appUrl; } }
    return run?.projectName ?? null;
  }, [target, run?.appUrl, run?.projectName]);

  const { data: historyData } = useQuery<{ scoreHistory: Array<{ id: string; score: number; runType: string; createdAt: string; label: string }> }>({
    queryKey: ["stats-history"],
    queryFn: async () => {
      const resp = await fetch("/api/qa/stats");
      if (!resp.ok) return { scoreHistory: [] };
      return resp.json();
    },
    enabled: run?.status === "completed" && !!targetLabel,
    staleTime: 30_000,
  });

  const sameTargetHistory = useMemo(() => {
    if (!historyData?.scoreHistory || !targetLabel) return [];
    return historyData.scoreHistory
      .filter(r => r.id !== id && r.label === targetLabel)
      .slice(-6);
  }, [historyData, targetLabel, id]);

  // Issue statuses
  const { data: statusData, refetch: refetchStatuses } = useQuery<{ statuses: IssueStatus[] }>({
    queryKey: ["issue-statuses", id],
    queryFn: async () => {
      const resp = await fetch(`/api/qa/runs/${id}/issue-statuses`);
      if (!resp.ok) throw new Error("Failed to fetch statuses");
      return resp.json();
    },
    enabled: run?.status === "completed",
  });

  const issueStatusMap = useMemo(() => {
    const map: Record<number, IssueStatus["status"]> = {};
    for (const s of statusData?.statuses ?? []) map[s.issueIndex] = s.status;
    return map;
  }, [statusData]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ index, status }: { index: number; status: IssueStatus["status"] }) => {
      const resp = await fetch(`/api/qa/runs/${id}/issues/${index}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) throw new Error("Failed to update status");
      return resp.json();
    },
    onSuccess: () => refetchStatuses(),
    onError: () => toast.error("Failed to update issue status"),
  });

  const report = run?.report as Report | null | undefined;
  const allIssues = report?.issues ?? [];

  const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const EFFORT_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };

  const issues = useMemo(() => {
    let list: Issue[] = filterSev === "all" ? allIssues : allIssues.filter(i => i.severity === filterSev);

    if (filterOwasp) list = list.filter(i => getIssueOwaspCode(i) === filterOwasp);

    if (filterStatus !== "all") {
      list = list.filter(i => (issueStatusMap[allIssues.indexOf(i)] ?? "open") === filterStatus);
    }

    if (issueSearch.trim()) {
      const q = issueSearch.toLowerCase();
      list = list.filter(i =>
        [i.title, i.description, i.possibleCause, i.filePath ?? "", i.owasp ?? ""]
          .some(t => t.toLowerCase().includes(q)),
      );
    }

    return [...list].sort((a, b) => {
      if (sortBy === "effort") {
        return (EFFORT_ORDER[a.effortLevel ?? ""] ?? 3) - (EFFORT_ORDER[b.effortLevel ?? ""] ?? 3);
      }
      if (sortBy === "owasp") return getIssueOwaspCode(a).localeCompare(getIssueOwaspCode(b));
      return (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4);
    });
  }, [allIssues, filterSev, filterOwasp, filterStatus, issueSearch, issueStatusMap, sortBy]);

  // Sync ref synchronously so keyboard handler always has the current count
  issuesLengthRef.current = issues.length;

  const issueSummary = useMemo(() => {
    const byStatus = { open: 0, acknowledged: 0, resolved: 0, wont_fix: 0 };
    allIssues.forEach((_, i) => {
      const s = issueStatusMap[i] ?? "open";
      if (s in byStatus) byStatus[s as keyof typeof byStatus]++;
    });
    return byStatus;
  }, [allIssues, issueStatusMap]);

  const copyReport = useCallback(() => {
    if (!report) return;
    const lines = [
      `# QA Report — ${run?.appUrl ?? run?.projectName}`,
      `**Score:** ${report.overallScore}/100`,
      `\n## Executive Summary\n${report.summary}`,
      `\n## Issues (${report.issues.length})`,
      ...report.issues.map(i =>
        `\n### [${i.severity.toUpperCase()}] ${i.title}\n${i.description}\n**Fix:** ${i.suggestedFix}${i.filePath ? `\n**File:** ${i.filePath}` : ""}`
      ),
      `\n## Strategic Recommendations`,
      ...report.recommendations.map((r, i) => `${i + 1}. ${r}`),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => toast.success("Report copied to clipboard"));
  }, [report, run]);

  const downloadJson = useCallback(() => {
    if (!report || !run) return;
    const blob = new Blob([JSON.stringify({ run, report }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qa-report-${run.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("JSON exported");
  }, [report, run]);

  const downloadCsv = useCallback(() => {
    if (!run || issues.length === 0) return;
    const header = ["#", "Severity", "Title", "OWASP", "Effort", "Status", "File", "Line", "Description"];
    const rows = issues.map((iss, i) => {
      const origIdx = allIssues.indexOf(iss);
      const status  = issueStatusMap[origIdx] ?? "open";
      return [
        String(i + 1),
        iss.severity,
        `"${iss.title.replace(/"/g, '""')}"`,
        getIssueOwaspCode(iss),
        iss.effortLevel ?? "",
        status,
        iss.filePath  ? `"${iss.filePath.replace(/"/g, '""')}"` : "",
        String(iss.lineNumber ?? ""),
        `"${iss.description.replace(/"/g, '""')}"`,
      ].join(",");
    });
    const csv  = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a    = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const slug = (run.appUrl ?? run.projectName ?? run.id).replace(/[^a-z0-9]/gi, "-").slice(0, 40);
    a.download = `qa-issues-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`${issues.length} issue${issues.length !== 1 ? "s" : ""} exported as CSV`);
  }, [run, issues, allIssues, issueStatusMap]);

  const downloadMarkdown = useCallback(() => {
    if (!report || !run) return;
    const counts: Record<SevKey, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    report.issues.forEach(i => { if (i.severity in counts) counts[i.severity as SevKey]++; });
    const grade = report.overallScore >= 90 ? "A+" : report.overallScore >= 80 ? "A" : report.overallScore >= 70 ? "B" : report.overallScore >= 60 ? "C" : report.overallScore >= 40 ? "D" : "F";
    const sevEmoji: Record<string, string> = { critical: "🚨", high: "⚠️", medium: "🔶", low: "ℹ️" };
    const effortMap: Record<string, string> = { low: "< 2 hours", medium: "~1 day", high: "Multiple days" };

    const lines: string[] = [
      `# Security Assessment Report`,
      ``,
      `> Generated by **QA Assistant** on ${format(new Date(run.createdAt), "MMMM d, yyyy · h:mm a")}`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Target** | ${run.appUrl ?? run.projectName ?? "Assessment"} |`,
      `| **Score** | ${report.overallScore}/100 (Grade ${grade}) |`,
      `| **Scan type** | ${run.runType === "url" ? "DAST — Live URL Test" : "SAST — Static Code Analysis"} |`,
      `| **Issues** | ${report.issues.length} total · ${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ${counts.low} low |`,
      ``,
      `---`,
      ``,
      `## Executive Summary`,
      ``,
      report.summary,
      ``,
      `---`,
      ``,
      `## Issues (${report.issues.length})`,
      ``,
    ];

    report.issues.forEach((issue, i) => {
      const owaspCode = getIssueOwaspCode(issue);
      const owaspCat = OWASP_CATS.find(c => c.id === owaspCode);
      lines.push(`### ${sevEmoji[issue.severity] ?? "•"} ${i + 1}. ${issue.title}`);
      lines.push(``);
      lines.push(`**Severity:** ${issue.severity.toUpperCase()}`);
      if (issue.filePath) lines.push(`**File:** \`${issue.filePath}${issue.lineNumber ? `:${issue.lineNumber}` : ""}\``);
      lines.push(`**OWASP:** ${owaspCode}${owaspCat ? ` — ${owaspCat.name}` : ""}`);
      if (issue.effortLevel) lines.push(`**Effort:** ${effortMap[issue.effortLevel] ?? issue.effortLevel}`);
      if (issue.detectionMethod === "deterministic") lines.push(`**Detection:** Secrets Scanner (deterministic)`);
      else if (issue.detectionMethod === "sca-osv") lines.push(`**Detection:** SCA / OSV CVE Database`);
      lines.push(``);
      lines.push(`**Description:** ${issue.description}`);
      lines.push(``);
      lines.push(`**Root cause:** ${issue.possibleCause}`);
      lines.push(``);
      lines.push(`**Suggested fix:** ${issue.suggestedFix}`);
      lines.push(``);
      if (issue.codeSnippet) {
        lines.push(`**Vulnerable code:**`);
        lines.push(``);
        lines.push("```");
        lines.push(issue.codeSnippet);
        lines.push("```");
        lines.push(``);
      }
      lines.push(`---`);
      lines.push(``);
    });

    if (report.recommendations.length > 0) {
      lines.push(`## Strategic Recommendations`);
      lines.push(``);
      report.recommendations.forEach((rec, i) => lines.push(`${i + 1}. ${rec}`));
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    lines.push(`*Report ID: \`${run.id}\` · Powered by QA Assistant*`);

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const slug = (run.appUrl ?? run.projectName ?? run.id).replace(/[^a-z0-9]/gi, "-").slice(0, 40);
    a.download = `qa-report-${slug}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Markdown report downloaded");
  }, [report, run]);

  const handleExportPdf = useCallback(async () => {
    if (!report || !run || exportingPdf) return;
    setExportingPdf(true);
    try {
      await exportPdf(run, report);
      toast.success("PDF exported");
    } catch {
      toast.error("Failed to generate PDF");
    } finally {
      setExportingPdf(false);
    }
  }, [report, run, exportingPdf]);

  const downloadSarif = useCallback(async () => {
    if (!run) return;
    try {
      const resp = await fetch(`/api/qa/runs/${run.id}/sarif`);
      if (!resp.ok) throw new Error("Failed to fetch SARIF");
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `qa-${run.id.slice(0, 8)}.sarif`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("SARIF exported — ready for GitHub Code Scanning");
    } catch {
      toast.error("Failed to download SARIF report");
    }
  }, [run]);

  const generateFix = useCallback(async (issueIndex: number) => {
    if (fixLoading[issueIndex] || !run) return;
    setFixLoading(prev => ({ ...prev, [issueIndex]: true }));
    try {
      const resp = await fetch(`/api/qa/runs/${run.id}/generate-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIndex }),
      });
      if (!resp.ok) throw new Error("Failed to generate fix");
      const data = await resp.json();
      setFixResults(prev => ({ ...prev, [issueIndex]: data }));
      toast.success("AI fix generated!");
    } catch {
      toast.error("Failed to generate fix — please try again");
    } finally {
      setFixLoading(prev => ({ ...prev, [issueIndex]: false }));
    }
  }, [run, fixLoading]);

  function handleRerun() {
    if (!run) return;
    if (run.runType === "url" && run.appUrl) {
      const params = new URLSearchParams();
      params.set("url", run.appUrl);
      if (run.appDescription) params.set("desc", run.appDescription);
      setLocation(`/new?${params.toString()}`);
    } else {
      setLocation(run.runType === "url" ? "/new" : "/sast");
    }
  }

  function handleStatusUpdate(index: number, status: IssueStatus["status"]) {
    updateStatusMutation.mutate({ index, status });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
        </div>
        <p className="text-zinc-400 text-sm">Loading report…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <XCircle className="w-12 h-12 text-red-400" />
        <p className="text-zinc-300 font-semibold">Run not found</p>
        <Button asChild variant="outline" className="border-white/10 text-white rounded-xl">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-1.5" />Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const isRunning = run.status === "pending" || run.status === "running";
  const isUrl = run.runType === "url";

  return (
    <>
      {/* Share modal */}
      <AnimatePresence>
        {showShareModal && (
          <ShareModal runId={run.id} onClose={() => setShowShareModal(false)} />
        )}
      </AnimatePresence>

      <div className="max-w-4xl mx-auto w-full space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Button asChild variant="ghost" size="sm"
              className="text-zinc-500 hover:text-white pl-0 mb-3 -ml-1 gap-1 h-8">
              <Link href="/"><ArrowLeft className="w-3.5 h-3.5" />Dashboard</Link>
            </Button>
            <div className="flex items-center gap-3 flex-wrap">
              <div className={["w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                isUrl ? "bg-violet-500/14 border border-violet-500/22" : "bg-cyan-500/14 border border-cyan-500/22"].join(" ")}>
                {isUrl ? <Globe className="w-4 h-4 text-violet-400" /> : <FileCode2 className="w-4 h-4 text-cyan-400" />}
              </div>
              <div>
                <h1 className="text-lg font-display font-bold text-white leading-tight max-w-lg truncate">
                  {run.appUrl ?? run.projectName ?? "Assessment"}
                </h1>
                <p className="text-zinc-500 text-xs mt-0.5">
                  {format(new Date(run.createdAt), "MMM d, yyyy · h:mm a")} · {isUrl ? "URL Test" : "SAST Scan"}
                  {run.status === "completed" && ` · Updated ${formatDistanceToNow(new Date(run.updatedAt), { addSuffix: true })}`}
                </p>
              </div>
              <StatusBadge status={run.status} />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleRerun}
              className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />New Run
            </Button>
            {run.status === "completed" && (
              <>
                <Button variant="outline" size="sm" onClick={copyReport}
                  className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                  <Copy className="w-3.5 h-3.5" />Copy
                </Button>
                <Button variant="outline" size="sm" onClick={downloadJson}
                  className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                  <Download className="w-3.5 h-3.5" />JSON
                </Button>
                <Button variant="outline" size="sm" onClick={downloadMarkdown}
                  className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />Markdown
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={exportingPdf}
                  className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                  {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  PDF
                </Button>
                {run.runType === "sast" && (
                  <Button variant="outline" size="sm" onClick={downloadSarif}
                    className="border-white/10 bg-white/4 hover:bg-white/8 text-white rounded-xl h-9 gap-1.5">
                    <Shield className="w-3.5 h-3.5" />SARIF
                  </Button>
                )}
                <Button size="sm" onClick={() => setShowShareModal(true)}
                  className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-9 gap-1.5">
                  <Share2 className="w-3.5 h-3.5" />Share
                </Button>
              </>
            )}
          </div>
        </motion.div>

        {/* Running state */}
        <AnimatePresence>
          {isRunning && (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <ProgressAnalysis isUrl={isUrl} startedAt={run?.createdAt} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error state */}
        {run.status === "failed" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="p-5 rounded-2xl border border-red-500/18 bg-red-500/5 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-semibold text-sm">Analysis failed</p>
              <p className="text-zinc-400 text-sm mt-1">{run.errorMessage ?? "An unexpected error occurred during analysis."}</p>
              <Button size="sm" onClick={handleRerun} variant="outline"
                className="mt-3 border-red-500/20 text-red-300 hover:bg-red-500/10 rounded-xl h-8 gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" />Try again
              </Button>
            </div>
          </motion.div>
        )}

        {/* Report */}
        {run.status === "completed" && report && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
            {/* Score + Summary */}
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
              <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-white/7 bg-white/2">
                <ScoreGauge score={report.overallScore} />
                {sameTargetHistory.length > 0 && (() => {
                  const prev  = sameTargetHistory[sameTargetHistory.length - 1].score;
                  const delta = report.overallScore - prev;
                  if (delta === 0) return null;
                  return (
                    <div className={["mt-2 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1",
                      delta > 0 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-red-400 bg-red-500/10 border border-red-500/20",
                    ].join(" ")}>
                      {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} pts vs last run
                    </div>
                  );
                })()}
              </div>
              <div className="flex flex-col gap-4 p-6 rounded-2xl border border-white/7 bg-white/2">
                <div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Executive Summary</p>
                  <p className="text-zinc-300 leading-relaxed text-sm">{report.summary}</p>
                </div>
                <SeverityBar issues={report.issues} />
              </div>
            </div>

            {/* Previous scans for this target */}
            {sameTargetHistory.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl border border-white/7 bg-white/2">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-violet-500/12 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <History className="w-3 h-3 text-violet-400" />
                  </div>
                  <p className="text-xs font-semibold text-white">Score History for this Target</p>
                  <span className="text-[10px] text-zinc-500 ml-1">{sameTargetHistory.length} previous scan{sameTargetHistory.length !== 1 ? "s" : ""}</span>
                  <button onClick={handleRerun}
                    className="ml-auto flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors font-medium">
                    <RotateCcw className="w-3 h-3" />Re-scan
                  </button>
                </div>
                <div className="flex items-end gap-1.5 h-12">
                  {sameTargetHistory.map((r, i) => {
                    const pct = Math.max(8, r.score);
                    const col = r.score >= 80 ? "#10B981" : r.score >= 60 ? "#F59E0B" : r.score >= 40 ? "#F97316" : "#EF4444";
                    const isCurrent = i === sameTargetHistory.length - 1;
                    return (
                      <Link key={r.id} href={`/runs/${r.id}`}>
                        <div className="flex flex-col items-center gap-1 group cursor-pointer" title={`${format(new Date(r.createdAt), "MMM d")} — Score: ${r.score}`}>
                          <div className="text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: col }}>{r.score}</div>
                          <div className="w-6 rounded-t-sm transition-all group-hover:opacity-100"
                            style={{ height: `${(pct / 100) * 36}px`, background: col, opacity: isCurrent ? 1 : 0.4 }} />
                        </div>
                      </Link>
                    );
                  })}
                  {/* Current run bar (highlighted) */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="text-[9px] font-bold" style={{ color: report.overallScore >= 80 ? "#10B981" : report.overallScore >= 60 ? "#F59E0B" : report.overallScore >= 40 ? "#F97316" : "#EF4444" }}>
                      {report.overallScore}
                    </div>
                    <div className="w-6 rounded-t-sm relative"
                      style={{
                        height: `${Math.max(8, report.overallScore) / 100 * 36}px`,
                        background: report.overallScore >= 80 ? "#10B981" : report.overallScore >= 60 ? "#F59E0B" : report.overallScore >= 40 ? "#F97316" : "#EF4444",
                        boxShadow: `0 0 8px ${report.overallScore >= 80 ? "#10B981" : report.overallScore >= 60 ? "#F59E0B" : "#EF4444"}60`,
                      }} />
                  </div>
                  <div className="ml-2 flex flex-col justify-end">
                    <span className="text-[10px] text-zinc-500">← older</span>
                    <span className="text-[10px] text-violet-400 font-medium">now</span>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">Click a bar to view that report · Current scan highlighted</p>
              </motion.div>
            )}

            {/* Deterministic findings banner */}
            {report.deterministicFindings && (report.deterministicFindings.secretsFound > 0 || report.deterministicFindings.vulnerableDepsFound > 0) && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 flex items-start gap-3">
                <Zap className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <span className="text-red-300 font-semibold">Deterministic scanner active · </span>
                  <span className="text-red-200">
                    {report.deterministicFindings.secretsFound > 0 &&
                      `${report.deterministicFindings.secretsFound} hardcoded secret${report.deterministicFindings.secretsFound > 1 ? "s" : ""} detected`}
                    {report.deterministicFindings.secretsFound > 0 && report.deterministicFindings.vulnerableDepsFound > 0 && " · "}
                    {report.deterministicFindings.vulnerableDepsFound > 0 &&
                      `${report.deterministicFindings.vulnerableDepsFound} vulnerable dependenc${report.deterministicFindings.vulnerableDepsFound > 1 ? "ies" : "y"} found via OSV.dev`}
                  </span>
                  <span className="text-red-400/70 text-xs block mt-1">These findings are 100% accurate — not AI-generated.</span>
                </div>
              </motion.div>
            )}

            {/* Recommendations */}
            {report.recommendations.length > 0 && (
              <div className="p-5 rounded-2xl border border-white/7 bg-white/2">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <p className="text-sm font-semibold text-white">Strategic Recommendations</p>
                </div>
                <ol className="space-y-2">
                  {report.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                      <span className="w-5 h-5 rounded-md bg-emerald-500/12 border border-emerald-500/18 text-emerald-400 text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">{i + 1}</span>
                      {rec}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Intelligence Panel */}
            <IntelligencePanel
              report={report as AugmentedReport}
              issues={allIssues}
              activeOwasp={filterOwasp}
              onOwaspFilter={(code) => {
                setFilterOwasp(prev => prev === code ? null : code);
                setExpandedIssue(null);
              }}
            />

            {/* Filter / triage row */}
            <div className="space-y-2.5">

              {/* Remediation progress bar + sort */}
              {allIssues.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/7 bg-white/2 flex-wrap">
                  <ListFilter className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <button onClick={() => { setFilterStatus("all"); setExpandedIssue(null); }}
                      className={["font-medium transition-colors", filterStatus === "all" ? "text-white" : "text-zinc-500 hover:text-zinc-300"].join(" ")}>
                      {allIssues.length} total
                    </button>
                    {([
                      { key: "open"         as const, label: "open",         color: "text-zinc-400"    },
                      { key: "acknowledged" as const, label: "acknowledged", color: "text-yellow-400"  },
                      { key: "resolved"     as const, label: "resolved",     color: "text-emerald-400" },
                      { key: "wont_fix"     as const, label: "won't fix",    color: "text-zinc-500"    },
                    ] as const).map(({ key, label, color }) => issueSummary[key] > 0 && (
                      <button key={key} onClick={() => { setFilterStatus(prev => prev === key ? "all" : key); setExpandedIssue(null); }}
                        className={["font-medium transition-colors pb-px border-b", filterStatus === key ? `${color} border-current` : `${color} opacity-70 border-transparent hover:opacity-100 hover:border-current`].join(" ")}>
                        {issueSummary[key]} {label}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    <ArrowUpDown className="w-3 h-3 text-zinc-600 shrink-0" />
                    {(["severity", "effort", "owasp"] as const).map(s => (
                      <button key={s} onClick={() => setSortBy(s)}
                        className={["px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all capitalize",
                          sortBy === s ? "bg-violet-600/30 text-violet-300 border border-violet-500/30" : "text-zinc-600 hover:text-zinc-400 border border-transparent",
                        ].join(" ")}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Severity + active OWASP filter chips */}
              <div className="flex items-center gap-2 flex-wrap">
                <BarChart3 className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-xs text-zinc-500 font-medium">Severity:</span>
                {(["all", "critical", "high", "medium", "low"] as const).map((s) => {
                  const cfg = s === "all" ? null : SEV_CONFIG[s];
                  const count = s === "all" ? allIssues.length : allIssues.filter(i => i.severity === s).length;
                  return (
                    <button key={s} onClick={() => { setFilterSev(s); setExpandedIssue(null); }}
                      className={["px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all border",
                        filterSev === s && s === "all" ? "bg-violet-600 text-white border-violet-600" : "",
                        filterSev !== s ? "bg-white/4 text-zinc-400 border-white/8 hover:border-white/16 hover:text-zinc-200" : "",
                      ].join(" ")}
                      style={filterSev === s && cfg ? { background: cfg.bg, color: cfg.color, borderColor: cfg.border } : {}}>
                      {s === "all" ? `All (${count})` : `${cfg!.label} (${count})`}
                    </button>
                  );
                })}
                {filterOwasp && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-cyan-500/10 text-cyan-300 border-cyan-500/25">
                    <Target className="w-2.5 h-2.5" />{filterOwasp}
                    <button onClick={() => { setFilterOwasp(null); setExpandedIssue(null); }} className="ml-0.5 hover:text-white transition-colors" aria-label="Clear OWASP filter">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {issues.length > 0 && (
                    <button
                      onClick={downloadCsv}
                      title={`Export ${issues.length} filtered issue${issues.length !== 1 ? "s" : ""} as CSV`}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-zinc-500 hover:text-emerald-300 hover:bg-emerald-500/8 border border-transparent hover:border-emerald-500/20 transition-all">
                      <Download className="w-2.5 h-2.5" />CSV
                    </button>
                  )}
                  <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <Shield className="w-3 h-3" />Click to expand
                  </span>
                </div>
              </div>

              {/* Issue search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                <input
                  ref={issueSearchRef}
                  type="text"
                  value={issueSearch}
                  onChange={e => { setIssueSearch(e.target.value); setExpandedIssue(null); }}
                  placeholder="Search issues…  (press / to focus, j/k to navigate)"
                  className="w-full pl-9 pr-9 py-2 rounded-xl bg-white/4 border border-white/8 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/40 focus:bg-white/6 transition-all"
                />
                {issueSearch && (
                  <button onClick={() => setIssueSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {(issueSearch || filterOwasp || filterStatus !== "all") && (
                <p className="text-[11px] text-zinc-500">
                  {issues.length === 0
                    ? "No issues match your filters."
                    : `Showing ${issues.length} of ${allIssues.length} issue${allIssues.length !== 1 ? "s" : ""}`}
                </p>
              )}
            </div>

            {/* Issues */}
            <div className="space-y-2">
              {issues.length === 0 ? (
                <div className="text-center py-12 rounded-2xl border border-white/7 bg-white/2">
                  <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto mb-3" />
                  <h3 className="font-semibold text-white text-sm mb-1">
                    {filterSev === "all" && !filterOwasp && filterStatus === "all" ? "No issues found!" : "No matching issues"}
                  </h3>
                  <p className="text-zinc-500 text-xs">
                    {filterSev === "all" && !filterOwasp && filterStatus === "all" ? "Clean analysis — no issues detected." : "Try adjusting your filters."}
                  </p>
                </div>
              ) : (
                <AnimatePresence>
                  {issues.map((issue, displayIdx) => {
                    // Find actual index in allIssues for status tracking
                    const actualIndex = allIssues.indexOf(issue);
                    const cfg = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.low;
                    const Icon = cfg.icon;
                    const isExpanded = expandedIssue === displayIdx;
                    const issueStatus = issueStatusMap[actualIndex] ?? "open";
                    const isResolved = issueStatus === "resolved" || issueStatus === "wont_fix";

                    return (
                      <motion.div key={`${filterSev}-${filterOwasp ?? ""}-${filterStatus}-${displayIdx}`}
                        data-issue-idx={displayIdx}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: displayIdx * 0.03 }}
                        className={["rounded-2xl border overflow-hidden transition-opacity", isResolved ? "opacity-50" : ""].join(" ")}
                        style={{ background: cfg.bg, borderColor: cfg.border }}>
                        <button
                          className="w-full text-left flex items-start gap-3 p-4 hover:bg-white/3 transition-colors"
                          onClick={() => setExpandedIssue(isExpanded ? null : displayIdx)}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                            style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.border}` }}>
                            <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={["font-semibold text-white text-sm", isResolved ? "line-through text-zinc-500" : ""].join(" ")}>
                                {issue.title}
                              </span>
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide"
                                style={{ background: `${cfg.color}18`, color: cfg.color, borderColor: cfg.border }}>
                                {cfg.label}
                              </span>
                              {issue.detectionMethod === "deterministic" && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-red-500/30 bg-red-500/10 text-red-400">
                                  Secrets Scan
                                </span>
                              )}
                              {issue.detectionMethod === "sca-osv" && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-orange-500/30 bg-orange-500/10 text-orange-400">
                                  CVE/OSV
                                </span>
                              )}
                              {/* OWASP category badge */}
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold border font-mono hidden sm:inline-block"
                                style={{ background: "rgba(6,182,212,0.08)", color: "#06B6D4", borderColor: "rgba(6,182,212,0.2)" }}>
                                {getIssueOwaspCode(issue)}
                              </span>
                              {/* Effort badge */}
                              {issue.effortLevel && EFFORT_CONFIG[issue.effortLevel] && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold border hidden sm:inline-flex items-center gap-0.5"
                                  style={{ background: EFFORT_CONFIG[issue.effortLevel].bg, color: EFFORT_CONFIG[issue.effortLevel].color, borderColor: EFFORT_CONFIG[issue.effortLevel].border }}>
                                  <Clock className="w-2 h-2" />
                                  {EFFORT_CONFIG[issue.effortLevel].label}
                                </span>
                              )}
                              {issue.filePath && (
                                <span className="text-[10px] font-mono text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded-md truncate max-w-[200px]">
                                  {issue.filePath}
                                  {issue.lineNumber ? `:${issue.lineNumber}` : ""}
                                </span>
                              )}
                            </div>
                            <p className="text-zinc-400 text-xs mt-1.5 leading-relaxed line-clamp-2">
                              {issue.description}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 mt-1">
                            <div onClick={(e) => e.stopPropagation()}>
                              <IssueStatusButton
                                issueIndex={actualIndex}
                                runId={run.id}
                                currentStatus={issueStatus}
                                onUpdate={handleStatusUpdate}
                              />
                            </div>
                            <div className="text-zinc-600">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </div>
                          </div>
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }} className="overflow-hidden"
                              style={{ borderTop: `1px solid ${cfg.border}` }}>
                              <div className="p-4 space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="rounded-xl p-3.5 bg-white/4 border border-white/8">
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Root Cause</p>
                                    <p className="text-sm text-zinc-300 leading-relaxed">
                                      <AnnotatedText text={issue.possibleCause} />
                                    </p>
                                  </div>
                                  <div className="rounded-xl p-3.5 border"
                                    style={{ background: `${cfg.color}0C`, borderColor: cfg.border }}>
                                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: cfg.color }}>Suggested Fix</p>
                                    <p className="text-sm leading-relaxed" style={{ color: `${cfg.color}CC` }}>
                                      <AnnotatedText text={issue.suggestedFix} />
                                    </p>
                                  </div>
                                </div>
                                {issue.codeSnippet && (
                                  <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Code Snippet</p>
                                      <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(issue.codeSnippet!); toast.success("Copied"); }}
                                        className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors">
                                        <Copy className="w-3 h-3" />Copy
                                      </button>
                                    </div>
                                    <pre className="code-block text-zinc-300 text-[11px]">{issue.codeSnippet}</pre>
                                  </div>
                                )}

                                {/* AI-Generated Code Fix */}
                                <div className="border-t pt-3" style={{ borderColor: cfg.border }}>
                                  {fixResults[actualIndex] ? (
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Wand2 className="w-3.5 h-3.5 text-violet-400" />
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">AI-Generated Fix</p>
                                        <span className="text-[9px] text-violet-400 bg-violet-500/8 border border-violet-500/15 px-1.5 py-0.5 rounded-md font-mono ml-auto">
                                          {fixResults[actualIndex].language}
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(fixResults[actualIndex].fixCode); toast.success("Fix copied!"); }}
                                          className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors">
                                          <Copy className="w-3 h-3" />Copy
                                        </button>
                                      </div>
                                      <pre className="code-block text-emerald-300/90 text-[11px]">{fixResults[actualIndex].fixCode}</pre>
                                      <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-xs text-zinc-300 leading-relaxed">
                                        <span className="text-violet-300 font-semibold">Why this works: </span>
                                        {fixResults[actualIndex].explanation}
                                      </div>
                                      {fixResults[actualIndex].testSuggestion && (
                                        <div className="flex items-start gap-1.5 text-xs text-zinc-400">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                          <span>
                                            <span className="text-emerald-400 font-medium">Verify: </span>
                                            {fixResults[actualIndex].testSuggestion}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <Button size="sm" variant="outline"
                                      onClick={(e) => { e.stopPropagation(); generateFix(actualIndex); }}
                                      disabled={fixLoading[actualIndex]}
                                      className="border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 text-violet-300 hover:text-violet-200 rounded-xl h-8 gap-1.5 text-xs">
                                      {fixLoading[actualIndex]
                                        ? <><Loader2 className="w-3 h-3 animate-spin" />Generating fix…</>
                                        : <><Wand2 className="w-3 h-3" />Generate AI Fix</>
                                      }
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </>
  );
}
