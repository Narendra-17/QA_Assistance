import { usePageTitle } from "@/hooks/use-page-title";
import { ShieldCheck, FileText, Eye, AlertTriangle, Lock, Mail } from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.22)" }}>
          <Icon className="w-4 h-4 text-violet-400" />
        </div>
        <h2 className="text-white font-semibold text-base">{title}</h2>
      </div>
      <div className="pl-10 space-y-2 text-zinc-400 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export default function Terms() {
  usePageTitle("Terms of Service");

  return (
    <div className="max-w-2xl mx-auto w-full space-y-8 pb-16">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(139,92,246,0.14)", border: "1px solid rgba(139,92,246,0.25)" }}>
            <FileText className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Terms of Service</h1>
            <p className="text-zinc-500 text-sm">Last updated: July 2026</p>
          </div>
        </div>

        {/* Legal warning banner */}
        <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl mt-4"
          style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-300/80 text-sm">
            <strong className="text-amber-300">Important:</strong> QA Assistant is a security testing tool.
            You must only scan applications you own or have explicit written permission to test.
            Unauthorised scanning may be illegal under the Computer Misuse Act, CFAA, or equivalent laws in your jurisdiction.
          </p>
        </div>
      </div>

      <div className="space-y-6" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1.5rem" }}>
        <Section title="1. Acceptance of Terms" icon={ShieldCheck}>
          <p>By creating an account or using QA Assistant ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
        </Section>

        <Section title="2. Permitted Use" icon={ShieldCheck}>
          <p>You may only use QA Assistant to test:</p>
          <ul className="list-disc list-inside space-y-1 text-zinc-500">
            <li>Applications you own or control</li>
            <li>Applications where you have explicit written authorisation from the owner</li>
            <li>Publicly available bug-bounty programs that explicitly permit automated scanning</li>
          </ul>
          <p className="mt-2">You must not use the Service to scan applications belonging to third parties without their express consent.</p>
        </Section>

        <Section title="3. Prohibited Activities" icon={AlertTriangle}>
          <p>You must not:</p>
          <ul className="list-disc list-inside space-y-1 text-zinc-500">
            <li>Scan systems you do not have permission to test</li>
            <li>Use scan results to attack, extort, or harm any person or organisation</li>
            <li>Attempt to circumvent rate limits, security controls, or access restrictions</li>
            <li>Upload malware, exploit code, or content that violates applicable laws</li>
            <li>Reverse-engineer or resell the Service</li>
          </ul>
        </Section>

        <Section title="4. User Data & Source Code" icon={Lock}>
          <p>Source code files uploaded for SAST scanning are processed in-memory and are never written to persistent disk storage. Files are discarded immediately after analysis completes. Scan reports (findings, scores, metadata) are stored in your account and can be deleted at any time from your dashboard.</p>
          <p className="mt-2">We do not use your source code to train AI models.</p>
        </Section>

        <Section title="5. AI-Powered Analysis" icon={ShieldCheck}>
          <p>Scan results are generated using AI models (GPT-4o). Results may contain errors, false positives, or missed vulnerabilities. QA Assistant reports are not a substitute for professional penetration testing or a comprehensive security audit. Always verify findings before acting on them.</p>
        </Section>

        <Section title="6. Account Responsibility" icon={Lock}>
          <p>You are responsible for all activity conducted under your account. Keep your credentials secure. Notify us immediately if you suspect unauthorised access to your account.</p>
        </Section>

        <Section title="7. Service Availability" icon={ShieldCheck}>
          <p>We aim for high availability but do not guarantee uninterrupted service. The Service is provided "as is" without warranty of any kind.</p>
        </Section>

        <Section title="8. Limitation of Liability" icon={AlertTriangle}>
          <p>To the maximum extent permitted by law, QA Assistant and its operators shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service, including damages resulting from acting on inaccurate scan results.</p>
        </Section>

        <Section title="9. Changes to Terms" icon={FileText}>
          <p>We may update these Terms at any time. Continued use of the Service after changes are posted constitutes acceptance of the revised Terms.</p>
        </Section>

        <Section title="10. Contact" icon={Mail}>
          <p>Questions about these Terms? Reach us at the email address in your account settings or through the platform's support channel.</p>
        </Section>
      </div>

      <div className="flex items-center gap-4 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <Link href={`${BASE}/privacy`} className="text-violet-400 hover:text-violet-300 text-sm transition-colors">Privacy Policy →</Link>
        <Link href={`${BASE}/`} className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">Back to dashboard</Link>
      </div>
    </div>
  );
}
