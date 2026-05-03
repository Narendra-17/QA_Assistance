import { useCreateQaRun, useCreateSastRun } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Globe, FileCode2, Sparkles, Upload, X, Link as LinkIcon, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback, useEffect } from "react";

const urlSchema = z.object({
  appUrl: z.string().url("Enter a valid URL (e.g., https://example.com)"),
  appDescription: z.string().min(10, "Provide at least 10 characters describing the app"),
});

const sastSchema = z.object({
  projectName: z.string().min(1, "Project name is required").max(80, "Keep it under 80 characters"),
  description: z.string().min(5, "Describe what the project does").max(1000, "Keep it under 1000 characters"),
});

type UrlForm = z.infer<typeof urlSchema>;
type SastForm = z.infer<typeof sastSchema>;

const CHECKS = [
  { label: "Security headers" },
  { label: "XSS & injection" },
  { label: "Accessibility" },
  { label: "Performance" },
];

const SAST_CHECKS = [
  { label: "SQL injection" },
  { label: "Hardcoded secrets" },
  { label: "IaC misconfigurations" },
  { label: "Insecure dependencies" },
  { label: "Shell script risks" },
  { label: "Container security" },
];

const CODE_TYPES = [
  // JS / TS
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts",
  // Python
  ".py", ".pyw", ".pyi",
  // JVM
  ".java", ".kt", ".kts", ".groovy", ".scala",
  // .NET
  ".cs", ".vb", ".fs", ".fsx",
  // Go / Rust / C family
  ".go", ".rs", ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp",
  // Ruby / PHP / Perl / Lua
  ".rb", ".rake", ".php", ".phtml", ".pl", ".pm", ".lua",
  // Mobile
  ".swift", ".m", ".mm", ".dart",
  // Functional
  ".hs", ".ex", ".exs", ".erl", ".r",
  // Shell / scripting
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".psd1", ".bat", ".cmd",
  // Web / templates
  ".html", ".htm", ".vue", ".svelte",
  ".css", ".scss", ".sass", ".less",
  ".twig", ".ejs", ".hbs", ".mustache", ".pug",
  // Markup & data
  ".xml", ".xsl", ".svg",
  ".json", ".jsonc",
  ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".properties",
  ".env",
  // SQL / GraphQL
  ".sql", ".prisma", ".graphql", ".gql",
  // IaC
  ".tf", ".tfvars", ".hcl", ".bicep",
  // Build
  ".gradle",
  // Other
  ".md", ".mdx", ".proto", ".zig", ".lock", ".mod",
].join(",");

export default function NewRun({ initialTab = "url" }: { initialTab?: "url" | "sast" }) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const prefillUrl = searchParams.get("url") ?? "";
  const prefillDesc = searchParams.get("desc") ?? "";
  const isPrefilledUrl = !!prefillUrl;

  const [tab, setTab] = useState<"url" | "sast">(isPrefilledUrl ? "url" : initialTab);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const urlForm = useForm<UrlForm>({ resolver: zodResolver(urlSchema), defaultValues: { appUrl: prefillUrl, appDescription: prefillDesc } });
  const sastForm = useForm<SastForm>({ resolver: zodResolver(sastSchema), defaultValues: { projectName: "", description: "" } });

  useEffect(() => {
    if (prefillUrl) urlForm.setValue("appUrl", prefillUrl, { shouldDirty: false, shouldTouch: false, shouldValidate: true });
    if (prefillDesc) urlForm.setValue("appDescription", prefillDesc, { shouldDirty: false, shouldTouch: false, shouldValidate: true });
  }, [prefillUrl, prefillDesc, urlForm]);

  const descValue = urlForm.watch("appDescription");
  const sastDescValue = sastForm.watch("description");

  const createMutation = useCreateQaRun({
    mutation: {
      onSuccess: (data) => { toast.success("Analysis started!"); setLocation(`/runs/${data.id}`); },
      onError: (err) => toast.error((err as { error?: string }).error ?? "Failed to start test run"),
    },
  });

  const sastMutation = useCreateSastRun({
    mutation: {
      onSuccess: (data) => { toast.success("SAST scan started!"); setLocation(`/runs/${data.id}`); },
      onError: (err) => { toast.error(err instanceof Error ? err.message : "Upload failed"); },
    },
  });

  function onUrlSubmit(values: UrlForm) {
    createMutation.mutate({ data: values });
  }

  function onSastSubmit(values: SastForm) {
    if (!files.length) { toast.error("Upload at least one source file"); return; }
    sastMutation.mutate({ data: { projectName: values.projectName, description: values.description, files } });
  }

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(f => {
      if (f.size >= 5 * 1024 * 1024) { toast.error(`${f.name} exceeds 5MB limit`); return false; }
      return true;
    });
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !existing.has(f.name))].slice(0, 30);
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="max-w-2xl mx-auto w-full space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold text-white">New Security Assessment</h1>
        <p className="text-zinc-500 mt-0.5 text-sm">AI-powered analysis powered by GPT-4o — results in under 30 seconds.</p>
      </motion.div>

      {/* Tab switcher */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}
        className="flex gap-1 p-1 rounded-2xl bg-white/4 border border-white/8 w-fit">
        {(["url", "sast"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[
              "flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold transition-all",
              tab === t
                ? t === "url" ? "bg-violet-600 text-white shadow-lg shadow-violet-900/30" : "bg-cyan-600 text-white shadow-lg shadow-cyan-900/30"
                : "text-zinc-400 hover:text-zinc-200",
            ].join(" ")}>
            {t === "url"
              ? <><Globe className="w-3.5 h-3.5" />Live URL Test</>
              : <><FileCode2 className="w-3.5 h-3.5" />SAST Code Scan</>}
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        {tab === "url" ? (
          <motion.div key="url" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="rounded-2xl border border-white/10 bg-white/2 overflow-hidden">
              <div className="h-0.5 animated-border" />
              <div className="p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/12 border border-violet-500/22 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-white text-sm">Live URL Testing</h2>
                    <p className="text-zinc-500 text-xs">Analyze any publicly accessible app</p>
                  </div>
                </div>

                {/* What gets checked */}
                <div className="flex flex-wrap gap-2">
                  {CHECKS.map(c => (
                    <span key={c.label} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-violet-500/8 border border-violet-500/14 text-violet-300">
                      <ShieldCheck className="w-3 h-3" />{c.label}
                    </span>
                  ))}
                </div>

                <Form {...urlForm}>
                  <form onSubmit={urlForm.handleSubmit(onUrlSubmit)} className="space-y-4">
                    <FormField control={urlForm.control} name="appUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Application URL</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                            <Input placeholder="https://your-app.com" autoFocus
                              className="pl-10 h-11 bg-white/4 border-white/10 focus-visible:border-violet-500/40 focus-visible:ring-violet-500/15 rounded-xl text-white placeholder:text-zinc-600 text-sm" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />
                    <FormField control={urlForm.control} name="appDescription" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-zinc-300 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            Expected Behavior <Sparkles className="w-3 h-3 text-violet-400" />
                          </FormLabel>
                          <span className={`text-[10px] font-mono tabular-nums ${descValue.length > 800 ? "text-amber-400" : "text-zinc-600"}`}>
                            {descValue.length}/1000
                          </span>
                        </div>
                        <FormDescription className="text-zinc-600 text-xs">
                          Describe the app's purpose so the AI knows what to test.
                        </FormDescription>
                        <FormControl>
                          <Textarea placeholder="E.g., e-commerce site where users browse products, add to cart, and checkout. Check for XSS, missing auth, and performance issues."
                            rows={4}
                            maxLength={1000}
                            className="bg-white/4 border-white/10 focus-visible:border-violet-500/40 focus-visible:ring-violet-500/15 rounded-xl text-white placeholder:text-zinc-600 resize-none text-sm"
                            {...field} />
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={createMutation.isPending}
                      className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-lg shadow-violet-900/25 transition-all gap-2">
                      {createMutation.isPending
                        ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Starting analysis…</>
                        : "Run QA Assessment →"}
                    </Button>
                  </form>
                </Form>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="sast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="rounded-2xl border border-white/10 bg-white/2 overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-cyan-500 to-teal-400" />
              <div className="p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/12 border border-cyan-500/22 flex items-center justify-center shrink-0">
                    <FileCode2 className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-white text-sm">Static Code Analysis (SAST)</h2>
                    <p className="text-zinc-500 text-xs">Scan source files for vulnerabilities</p>
                  </div>
                </div>

                {/* What gets checked */}
                <div className="flex flex-wrap gap-2">
                  {SAST_CHECKS.map(c => (
                    <span key={c.label} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-cyan-500/8 border border-cyan-500/14 text-cyan-300">
                      <ShieldCheck className="w-3 h-3" />{c.label}
                    </span>
                  ))}
                </div>

                <Form {...sastForm}>
                  <form onSubmit={sastForm.handleSubmit(onSastSubmit)} className="space-y-4">
                    <FormField control={sastForm.control} name="projectName" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Project Name</FormLabel>
                        <FormControl>
                          <Input placeholder="my-api" autoFocus
                            className="h-11 bg-white/4 border-white/10 focus-visible:border-cyan-500/40 focus-visible:ring-cyan-500/15 rounded-xl text-white placeholder:text-zinc-600 text-sm" {...field} />
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />
                    <FormField control={sastForm.control} name="description" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-zinc-300 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            Project Description <Sparkles className="w-3 h-3 text-cyan-400" />
                          </FormLabel>
                          <span className={`text-[10px] font-mono tabular-nums ${sastDescValue.length > 800 ? "text-amber-400" : "text-zinc-600"}`}>
                            {sastDescValue.length}/1000
                          </span>
                        </div>
                        <FormDescription className="text-zinc-600 text-xs">
                          Tech stack and purpose improves analysis quality.
                        </FormDescription>
                        <FormControl>
                          <Textarea
                            placeholder="Node.js REST API with Express and PostgreSQL. Handles user auth and payment processing."
                            rows={3}
                            maxLength={1000}
                            className="bg-white/4 border-white/10 focus-visible:border-cyan-500/40 focus-visible:ring-cyan-500/15 rounded-xl text-white placeholder:text-zinc-600 resize-none text-sm"
                            {...field} />
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />

                    {/* Drop zone */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Source Files</label>
                        {files.length > 0 && (
                          <span className="text-[10px] text-zinc-500">{files.length} file{files.length !== 1 ? "s" : ""} · {(totalSize / 1024).toFixed(0)} KB</span>
                        )}
                      </div>
                      <div
                        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={[
                          "relative border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all duration-200",
                          isDragging
                            ? "border-cyan-500/55 bg-cyan-500/7 shadow-[0_0_30px_rgba(6,182,212,0.1)]"
                            : "border-white/10 bg-white/2 hover:border-white/18 hover:bg-white/3",
                        ].join(" ")}
                      >
                        <input ref={fileInputRef} type="file" multiple accept={CODE_TYPES} className="hidden"
                          onChange={(e) => e.target.files && addFiles(e.target.files)} />
                        <div className="w-11 h-11 rounded-xl bg-cyan-500/12 border border-cyan-500/22 flex items-center justify-center mx-auto mb-2.5">
                          <Upload className={`w-5 h-5 text-cyan-400 transition-transform duration-200 ${isDragging ? "scale-110" : ""}`} />
                        </div>
                        <p className="text-white font-semibold text-sm">
                          {isDragging ? "Release to upload" : "Drop files or click to browse"}
                        </p>
                        <p className="text-zinc-500 text-xs mt-1">
                          Source code · Shell scripts · IaC (.tf/.hcl) · Dockerfiles · Config files · and more
                        </p>
                        <p className="text-zinc-600 text-[10px] mt-0.5">Max 5 MB per file · Up to 30 files</p>
                      </div>
                    </div>

                    {/* File list */}
                    <AnimatePresence>
                      {files.length > 0 && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs text-zinc-400 font-medium">Selected files</p>
                            <button type="button" onClick={() => setFiles([])}
                              className="text-xs text-zinc-600 hover:text-red-400 transition-colors">Clear all</button>
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                            {files.map((f, i) => (
                              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/4 border border-white/6">
                                <FileCode2 className="w-3.5 h-3.5 text-cyan-400/70 shrink-0" />
                                <span className="text-zinc-300 text-xs truncate flex-1">{f.name}</span>
                                <span className="text-zinc-600 text-[10px] shrink-0 font-mono">{(f.size / 1024).toFixed(0)}KB</span>
                                <button type="button"
                                  onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors shrink-0">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {files.length === 0 && (
                      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/6 border border-amber-500/12">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-zinc-500 text-xs">Upload individual files. To scan a folder, select all files inside it using the file picker.</p>
                      </div>
                    )}

                    <Button type="submit" disabled={sastMutation.isPending || files.length === 0}
                      className="w-full h-11 rounded-xl text-white font-semibold shadow-lg shadow-cyan-900/25 transition-all gap-2 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #0891b2, #0d9488)" }}>
                      {sastMutation.isPending
                        ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Uploading & analyzing…</>
                        : `Scan ${files.length > 0 ? `${files.length} file${files.length !== 1 ? "s" : ""}` : "files"} →`}
                    </Button>
                  </form>
                </Form>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
