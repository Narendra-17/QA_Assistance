import { usePageTitle } from "@/hooks/use-page-title";
import { Eye, Lock, Database, Share2, FileText, Mail, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
          <Icon className="w-4 h-4 text-cyan-400" />
        </div>
        <h2 className="text-white font-semibold text-base">{title}</h2>
      </div>
      <div className="pl-10 space-y-2 text-zinc-400 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export default function Privacy() {
  usePageTitle("Privacy Policy");

  return (
    <div className="max-w-2xl mx-auto w-full space-y-8 pb-16">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
            <Eye className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Privacy Policy</h1>
            <p className="text-zinc-500 text-sm">Last updated: July 2026</p>
          </div>
        </div>
      </div>

      <div className="space-y-6" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1.5rem" }}>
        <Section title="1. What We Collect" icon={Database}>
          <p>We collect the following information when you use QA Assistant:</p>
          <ul className="list-disc list-inside space-y-1 text-zinc-500">
            <li><strong className="text-zinc-400">Account data:</strong> email address and hashed password (never stored in plain text)</li>
            <li><strong className="text-zinc-400">Scan metadata:</strong> URLs submitted for DAST scanning, project names, scan timestamps, and results</li>
            <li><strong className="text-zinc-400">Usage data:</strong> scan counts, session identifiers (stored server-side, not in cookies with content)</li>
            <li><strong className="text-zinc-400">Source code:</strong> files uploaded for SAST scanning (processed in-memory, never persisted to disk)</li>
          </ul>
        </Section>

        <Section title="2. How We Use Your Data" icon={ShieldCheck}>
          <p>We use collected data to:</p>
          <ul className="list-disc list-inside space-y-1 text-zinc-500">
            <li>Deliver scan results and maintain your scan history</li>
            <li>Enforce rate limits and prevent abuse</li>
            <li>Maintain a legal audit trail of DAST scan targets (required for legal compliance)</li>
            <li>Send password reset emails when requested</li>
          </ul>
          <p className="mt-2">We do not sell your data to third parties, use it for advertising, or use your source code to train AI models.</p>
        </Section>

        <Section title="3. Source Code Handling" icon={Lock}>
          <p>Files uploaded for SAST analysis are held in server memory only for the duration of the scan (typically under 60 seconds). They are never written to disk, never stored in the database, and are garbage-collected immediately after analysis. Only the scan report (findings and metadata) is persisted.</p>
        </Section>

        <Section title="4. DAST Audit Logging" icon={FileText}>
          <p>When you submit a URL for DAST scanning, the target URL and your user ID are logged with a timestamp for legal compliance purposes. This log is used solely to demonstrate that scans were performed with user authorisation and is not shared externally except when required by law.</p>
        </Section>

        <Section title="5. AI Processing" icon={Share2}>
          <p>Scan prompts (including anonymised page metadata and source code snippets) are sent to OpenAI's GPT-4o API for analysis. This processing is governed by <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 transition-colors underline">OpenAI's Privacy Policy</a>. We use API settings that prevent your data from being used for model training.</p>
        </Section>

        <Section title="6. Data Retention" icon={Database}>
          <p>Scan reports are retained until you delete them. You can delete individual runs from your dashboard or delete your account to remove all associated data. Sessions expire after 7 days of inactivity.</p>
        </Section>

        <Section title="7. Security" icon={Lock}>
          <p>We protect your data using industry-standard measures: bcrypt password hashing (12 rounds), encrypted HTTPS connections, HTTP-only session cookies, and security headers (HSTS, CSP, X-Frame-Options). Our API implements rate limiting and SSRF protection.</p>
        </Section>

        <Section title="8. Your Rights" icon={ShieldCheck}>
          <p>Depending on your jurisdiction, you may have rights to access, correct, or delete your personal data. To exercise these rights, delete your account from Settings, or contact us directly.</p>
        </Section>

        <Section title="9. Changes to This Policy" icon={FileText}>
          <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy with a new effective date.</p>
        </Section>

        <Section title="10. Contact" icon={Mail}>
          <p>For privacy-related questions or requests, contact us through the platform's support channel or the email address in your account settings.</p>
        </Section>
      </div>

      <div className="flex items-center gap-4 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <Link href={`${BASE}/terms`} className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors">Terms of Service →</Link>
        <Link href={`${BASE}/`} className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">Back to dashboard</Link>
      </div>
    </div>
  );
}
