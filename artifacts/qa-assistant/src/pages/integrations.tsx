import { useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key, Plus, Trash2, Copy, Eye, EyeOff, Check, Loader2,
  Github, Terminal, AlertTriangle, Clock, Shield, Zap, ChevronDown, ChevronUp,
  Info, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface NewKey extends ApiKey {
  key: string; // plaintext — shown once
}

// ─── GitHub Action YAML ───────────────────────────────────────────────────────

function buildGithubActionYaml(baseUrl: string): string {
  return `name: QA Assistant Security Scan

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  qa-scan:
    name: SAST Security Scan
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Upload files to QA Assistant
        id: upload
        run: |
          # Collect source files (skip build artifacts and dependencies)
          FILES=$(find . \\
            -not -path './.git/*' \\
            -not -path './node_modules/*' \\
            -not -path './dist/*' \\
            -not -path './.next/*' \\
            -not -path './build/*' \\
            -not -path './.cache/*' \\
            -type f \\
            \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\
               -o -name "*.py" -o -name "*.go" -o -name "*.java" -o -name "*.php" \\
               -o -name "*.rb" -o -name "*.rs" -o -name "*.sh" \\
               -o -name "package.json" -o -name "requirements.txt" \\
               -o -name "go.mod" -o -name "Gemfile" -o -name "Cargo.toml" \\
               -o -name ".env.example" \\
            \\) 2>/dev/null | head -30)

          ARGS=()
          for f in $FILES; do
            ARGS+=(-F "files=@$f;filename=$(realpath --relative-to=. "$f")")
          done

          RESPONSE=$(curl -sf \\
            -H "Authorization: Bearer \${{ secrets.QA_API_KEY }}" \\
            -F "projectName=\${{ github.repository }}" \\
            -F "description=Automated CI scan of \${{ github.ref }}" \\
            "\${ARGS[@]}" \\
            "${baseUrl}/api/qa/sast")

          echo "Response: $RESPONSE"
          RUN_ID=$(echo "$RESPONSE" | jq -r '.id')
          echo "run_id=$RUN_ID" >> $GITHUB_OUTPUT

      - name: Wait for analysis to complete
        run: |
          for i in $(seq 1 24); do
            STATUS=$(curl -sf \\
              -H "Authorization: Bearer \${{ secrets.QA_API_KEY }}" \\
              "${baseUrl}/api/qa/runs/\${{ steps.upload.outputs.run_id }}" \\
              | jq -r '.status')
            echo "[$i/24] Status: $STATUS"
            if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then break; fi
            sleep 5
          done

      - name: Download SARIF report
        run: |
          curl -sf \\
            -H "Authorization: Bearer \${{ secrets.QA_API_KEY }}" \\
            "${baseUrl}/api/qa/runs/\${{ steps.upload.outputs.run_id }}/sarif" \\
            -o qa-results.sarif

      - name: Upload SARIF to GitHub Code Scanning
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: qa-results.sarif
          category: qa-assistant
`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CodeBlock({ code, language = "yaml" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="relative rounded-xl overflow-hidden border border-white/8">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/6" style={{ background: "rgba(255,255,255,0.03)" }}>
        <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">{language}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="code-block overflow-x-auto text-[11px] max-h-80 text-zinc-300 leading-relaxed">{code}</pre>
    </div>
  );
}

function KeyCard({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke: (id: string) => void }) {
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date();
  return (
    <div className={["flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-colors",
      isExpired ? "border-red-500/15 bg-red-500/4" : "border-white/7 bg-white/2"].join(" ")}>
      <div className={["w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
        isExpired ? "bg-red-500/12 border border-red-500/20" : "bg-violet-500/12 border border-violet-500/20"].join(" ")}>
        <Key className={`w-4 h-4 ${isExpired ? "text-red-400" : "text-violet-400"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{apiKey.name}</span>
          {isExpired && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border border-red-500/30 bg-red-500/10 text-red-400">
              Expired
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <code className="text-[11px] font-mono text-zinc-500">{apiKey.keyPrefix}••••••••••••••••••••••••</code>
          <span className="text-zinc-700 text-[10px]">·</span>
          <span className="text-[11px] text-zinc-600">
            Created {formatDistanceToNow(new Date(apiKey.createdAt), { addSuffix: true })}
          </span>
          {apiKey.lastUsedAt && (
            <>
              <span className="text-zinc-700 text-[10px]">·</span>
              <span className="text-[11px] text-zinc-600">
                Last used {formatDistanceToNow(new Date(apiKey.lastUsedAt), { addSuffix: true })}
              </span>
            </>
          )}
          {apiKey.expiresAt && (
            <>
              <span className="text-zinc-700 text-[10px]">·</span>
              <span className={`text-[11px] flex items-center gap-1 ${isExpired ? "text-red-400" : "text-zinc-600"}`}>
                <Clock className="w-3 h-3" />
                {isExpired ? "Expired" : "Expires"} {format(new Date(apiKey.expiresAt), "MMM d, yyyy")}
              </span>
            </>
          )}
        </div>
      </div>
      <button
        onClick={() => onRevoke(apiKey.id)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
        title="Revoke key"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function NewKeyBanner({ apiKey, onDismiss }: { apiKey: NewKey; onDismiss: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(apiKey.key).then(() => {
      setCopied(true);
      toast.success("API key copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/6 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
          <Check className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1">
          <p className="text-emerald-300 font-semibold text-sm">API key created — save it now!</p>
          <p className="text-emerald-400/60 text-xs mt-0.5">
            This key will never be shown again. Copy it and store it securely (e.g. GitHub → Settings → Secrets).
          </p>
        </div>
        <button onClick={onDismiss} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 px-3 py-2.5 rounded-xl border border-white/8 bg-white/4 font-mono text-xs text-zinc-300 truncate">
          {revealed ? apiKey.key : "qak_••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
        </div>
        <button onClick={() => setRevealed(v => !v)}
          className="px-3 py-2.5 rounded-xl border border-white/8 bg-white/4 text-zinc-400 hover:text-zinc-200 transition-colors">
          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <Button size="sm" onClick={copy}
          className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl gap-1.5 shrink-0">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          Copy
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Create key modal ─────────────────────────────────────────────────────────

function CreateKeyModal({ onClose, onCreate }: { onClose: () => void; onCreate: (key: NewKey) => void }) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const expiryOptions = [
    { label: "No expiry", days: null },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "1 year", days: 365 },
  ];

  async function create() {
    if (!name.trim()) { toast.error("Enter a key name"); return; }
    setLoading(true);
    try {
      const resp = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), ...(expiry ? { expiresInDays: expiry } : {}) }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to create key");
      }
      const newKey = await resp.json() as NewKey;
      onCreate(newKey);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-2xl"
        style={{ background: "hsl(230,25%,10%)" }}>
        <h3 className="font-display font-bold text-white mb-5 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Plus className="w-3.5 h-3.5 text-violet-400" />
          </div>
          Create API Key
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Key Name</label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. GitHub Actions — main repo"
              className="bg-white/4 border-white/10 focus-visible:border-violet-500/40 text-white placeholder:text-zinc-600 rounded-xl"
              onKeyDown={e => e.key === "Enter" && create()}
              autoFocus
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Expiry</label>
            <div className="grid grid-cols-4 gap-1.5">
              {expiryOptions.map(opt => (
                <button key={String(opt.days)} onClick={() => setExpiry(opt.days)}
                  className={["py-2 rounded-xl text-xs font-medium border transition-all", expiry === opt.days
                    ? "bg-violet-600 border-violet-500 text-white"
                    : "bg-white/4 border-white/8 text-zinc-400 hover:border-white/16 hover:text-white"
                  ].join(" ")}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1 border-white/10 bg-white/4 text-white rounded-xl">Cancel</Button>
            <Button onClick={create} disabled={loading || !name.trim()}
              className="flex-1 bg-violet-600 hover:bg-violet-500 text-white rounded-xl gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              Create Key
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Integrations() {
  usePageTitle("CI/CD Integrations");
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKey, setNewKey] = useState<NewKey | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [showYaml, setShowYaml] = useState(false);

  const baseUrl = window.location.origin;

  const { data: keysData, isLoading } = useQuery<{ keys: ApiKey[] }>({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const resp = await fetch("/api/keys");
      if (!resp.ok) throw new Error("Failed to fetch keys");
      return resp.json();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const resp = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("Failed to revoke key");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked");
      setRevokeId(null);
    },
    onError: () => { toast.error("Failed to revoke key"); setRevokeId(null); },
  });

  function handleNewKey(key: NewKey) {
    queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    setNewKey(key);
  }

  const yamlContent = buildGithubActionYaml(baseUrl);

  return (
    <>
      {/* Create key modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateKeyModal onClose={() => setShowCreateModal(false)} onCreate={handleNewKey} />
        )}
      </AnimatePresence>

      {/* Revoke confirm */}
      <AlertDialog open={!!revokeId} onOpenChange={o => !o && setRevokeId(null)}>
        <AlertDialogContent className="border-white/10 rounded-2xl" style={{ background: "hsl(230,24%,9%)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-display">Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Any CI/CD pipeline using this key will immediately stop working. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/4 text-white hover:bg-white/8 rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => revokeId && revokeMutation.mutate(revokeId)}
              className="bg-red-600 hover:bg-red-500 text-white rounded-xl">
              {revokeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-3xl mx-auto w-full space-y-6">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-display font-bold text-white">CI/CD Integration</h1>
          <p className="text-zinc-500 mt-0.5 text-sm">Connect QA Assistant to your GitHub Actions pipeline for automated security scanning on every push.</p>
        </motion.div>

        {/* How it works */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-3">
          {[
            { icon: Key, color: "#8B5CF6", label: "1. Create API Key", desc: "Generate a key below and add it to GitHub Secrets as QA_API_KEY" },
            { icon: Github, color: "#E2E8F0", label: "2. Add the Action", desc: "Copy the GitHub Action YAML and commit it to .github/workflows/" },
            { icon: Zap, color: "#06B6D4", label: "3. Get SARIF Reports", desc: "Results appear in GitHub's Security → Code scanning alerts automatically" },
          ].map((step, i) => (
            <div key={i} className="p-4 rounded-2xl border border-white/7 bg-white/2">
              <step.icon className="w-5 h-5 mb-3" style={{ color: step.color }} />
              <p className="text-white text-xs font-semibold mb-1">{step.label}</p>
              <p className="text-zinc-500 text-[11px] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </motion.div>

        {/* New key banner */}
        <AnimatePresence>
          {newKey && (
            <NewKeyBanner apiKey={newKey} onDismiss={() => setNewKey(null)} />
          )}
        </AnimatePresence>

        {/* API Keys section */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          className="rounded-2xl border border-white/7 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/6"
            style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-2.5">
              <Key className="w-4 h-4 text-violet-400" />
              <h2 className="font-display font-bold text-white text-sm">API Keys</h2>
              {keysData && (
                <span className="px-2 py-0.5 rounded-full bg-white/6 text-zinc-400 text-[11px] font-medium">
                  {keysData.keys.length} / 20
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => setShowCreateModal(true)}
              className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl h-8 gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" />New Key
            </Button>
          </div>
          <div className="p-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
              </div>
            ) : !keysData?.keys.length ? (
              <div className="text-center py-10">
                <Key className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
                <p className="text-zinc-500 text-sm font-medium">No API keys yet</p>
                <p className="text-zinc-700 text-xs mt-0.5">Create one to start automating scans</p>
              </div>
            ) : (
              <AnimatePresence>
                {keysData.keys.map(key => (
                  <motion.div key={key.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}>
                    <KeyCard apiKey={key} onRevoke={setRevokeId} />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
          <div className="px-5 py-3 border-t border-white/5 flex items-start gap-2 text-[11px] text-zinc-600"
            style={{ background: "rgba(255,255,255,0.01)" }}>
            <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Keys are hashed with SHA-256 — we store only the hash, not the plaintext. Treat each key like a password.
          </div>
        </motion.div>

        {/* GitHub Action YAML */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="rounded-2xl border border-white/7 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-4 border-b border-white/6 hover:bg-white/2 transition-colors"
            style={{ background: "rgba(255,255,255,0.02)" }}
            onClick={() => setShowYaml(v => !v)}
          >
            <div className="flex items-center gap-2.5">
              <Github className="w-4 h-4 text-zinc-300" />
              <h2 className="font-display font-bold text-white text-sm">GitHub Action Workflow</h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                SARIF output
              </span>
            </div>
            {showYaml ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
          </button>
          <AnimatePresence>
            {showYaml && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="p-3 rounded-xl border border-amber-500/15 bg-amber-500/5 flex items-start gap-2.5 text-xs text-amber-300">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <strong>Before adding this file:</strong> create a GitHub secret named{" "}
                      <code className="font-mono bg-white/8 px-1 rounded">QA_API_KEY</code> with your API key value.
                      Go to <em>GitHub → Repository → Settings → Secrets and variables → Actions</em>.
                    </div>
                  </div>
                  <CodeBlock code={yamlContent} language="yaml (.github/workflows/qa-scan.yml)" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl border border-white/7 bg-white/2">
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">What it does</p>
                      <ul className="space-y-1.5 text-[11px] text-zinc-400">
                        {[
                          "Runs on every push and pull request",
                          "Uploads up to 30 source files",
                          "Waits for AI analysis to complete (~30s)",
                          "Downloads SARIF 2.1.0 report",
                          "Uploads to GitHub Code Scanning",
                        ].map((item, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3 rounded-xl border border-white/7 bg-white/2">
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Requirements</p>
                      <ul className="space-y-1.5 text-[11px] text-zinc-400">
                        {[
                          { text: "GitHub Actions enabled", ok: true },
                          { text: "QA_API_KEY secret set", ok: false },
                          { text: "curl + jq (pre-installed on ubuntu-latest)", ok: true },
                          { text: "Advanced Security (for private repos)", ok: false },
                          { text: "write permission: security-events", ok: true },
                        ].map((item, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            {item.ok
                              ? <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                              : <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />}
                            {item.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* CLI section */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="rounded-2xl border border-white/7 p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <h2 className="font-display font-bold text-white text-sm">CLI / curl</h2>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Run a SAST scan</p>
              <CodeBlock
                language="bash"
                code={`# Upload a file and get a run ID
curl -X POST \\
  -H "Authorization: Bearer qak_your_key_here" \\
  -F "files=@src/index.ts" \\
  -F "projectName=My Project" \\
  -F "description=Manual scan" \\
  "${baseUrl}/api/qa/sast"`}
              />
            </div>
            <div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Poll for results</p>
              <CodeBlock
                language="bash"
                code={`curl -H "Authorization: Bearer qak_your_key_here" \\
  "${baseUrl}/api/qa/runs/<run-id>"`}
              />
            </div>
            <div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Download SARIF report</p>
              <CodeBlock
                language="bash"
                code={`curl -H "Authorization: Bearer qak_your_key_here" \\
  "${baseUrl}/api/qa/runs/<run-id>/sarif" \\
  -o results.sarif`}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
