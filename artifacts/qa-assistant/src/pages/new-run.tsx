import { useCreateQaRun, useCreateSastRun } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Globe, FileCode2, Sparkles, Upload, X, Link as LinkIcon, AlertCircle, ShieldCheck, Clock } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
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
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts",
  ".py", ".pyw", ".pyi",
  ".java", ".kt", ".kts", ".groovy", ".scala",
  ".cs", ".vb", ".fs", ".fsx",
  ".go", ".rs", ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp",
  ".rb", ".rake", ".php", ".phtml", ".pl", ".pm", ".lua",
  ".swift", ".m", ".mm", ".dart",
  ".hs", ".ex", ".exs", ".erl", ".r",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".psd1", ".bat", ".cmd",
  ".html", ".htm", ".vue", ".svelte",
  ".css", ".scss", ".sass", ".less",
  ".twig", ".ejs", ".hbs", ".mustache", ".pug",
  ".xml", ".xsl", ".svg",
  ".json", ".jsonc",
  ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".properties",
  ".env",
  ".sql", ".prisma", ".graphql", ".gql",
  ".tf", ".tfvars", ".hcl", ".bicep",
  ".gradle",
  ".md", ".mdx", ".proto", ".zig", ".lock", ".mod",
].join(",");

const RECENT_URLS_KEY = "qa_recent_urls";
function getRecentUrls(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_URLS_KEY) ?? "[]") as string[]; } catch { return []; }
}
function saveRecentUrl(url: string) {
  const urls = [url, ...getRecentUrls().filter(u => u !== url)].slice(0, 5);
  localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(urls));
}
function removeRecentUrl(url: string) {
  localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(getRecentUrls().filter(u => u !== url)));
}

export default function NewRun({ initialTab = "url" }: { initialTab?: "url" | "sast" }) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const prefillUrl = searchParams.get("url") ?? "";
  const prefillDesc = searchParams.get("desc") ?? "";
  const isPrefilledUrl = !!prefillUrl;

  usePageTitle("New Assessment");
  const [tab, setTab] = useState<"url" | "sast">(isPrefilledUrl ? "url" : initialTab);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [recentUrls, setRecentUrls]   = useState<string[]>([]);
  const [showRecent, setShowRecent]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const urlForm = useForm<UrlForm>({ resolver: zodResolver(urlSchema), defaultValues: { appUrl: prefillUrl, appDescription: prefillDesc } });
  const sastForm = useForm<SastForm>({ resolver: zodResolver(sastSchema), defaultValues: { projectName: "", description: "" } });

  useEffect(() => {
    if (prefillUrl) urlForm.setValue("appUrl", prefillUrl, { shouldDirty: false, shouldTouch: false, shouldValidate: true });
    if (prefillDesc) urlForm.setValue("appDescription", prefillDesc, { shouldDirty: false, shouldTouch: false, shouldValidate: true });
  }, [prefillUrl, prefillDesc, urlForm]);

  useEffect(() => { setRecentUrls(getRecentUrls()); }, []);

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
    saveRecentUrl(values.appUrl);
    setRecentUrls(getRecentUrls());
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
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold text-white">New Security Assessment</h1>
        <p className="text-zinc-500 mt-0.5 text-sm">AI-powered analysis by GPT-4o — results in under 30 seconds.</p>
      </motion.div>

      {/* Tab switcher */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}
        className="flex gap-1 p-1 rounded-2xl w-fit relative"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {(["url", "sast"] as const).map((t) => {
          const isActive = tab === t;
          const isViolet = t === "url";
          return (
            <button key={t} onClick={() => setTab(t)}
              className={[
                "relative flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 overflow-hidden",
                isActive ? "text-white" : "text-zinc-400 hover:text-zinc-200",
              ].join(" ")}
              style={isActive ? {
                background: isViolet
                  ? "linear-gradient(135deg, hsl(258,85%,58%), hsl(258,80%,50%))"
                  : "linear-gradient(135deg, hsl(190,88%,42%), hsl(190,80%,36%))",
                boxShadow: isViolet
                  ? "0 2px 16px rgba(139,92,246,0.4), 0 1px 0 rgba(255,255,255,0.1) inset"
                  : "0 2px 16px rgba(6,182,212,0.3), 0 1px 0 rgba(255,255,255,0.1) inset",
              } : {}}
            >
              {/* Shimmer on active */}
              {isActive && (
                <span className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-white/12 to-transparent -skew-x-12 translate-x-[-100%] animate-none" />
              )}
              {t === "url"
                ? <><Globe className="w-3.5 h-3.5" />Live URL Test</>
                : <><FileCode2 className="w-3.5 h-3.5" />SAST Code Scan</>}
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {tab === "url" ? (
          <motion.div key="url" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div
              className="rounded-2xl overflow-hidden relative"
              style={{
                background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              }}
            >
              {/* Animated top border */}
              <div className="h-0.5 animated-border" />

              {/* Subtle violet glow in corner */}
              <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none"
                style={{ background: "radial-gradient(circle at 100% 0%, rgba(139,92,246,0.06), transparent 70%)" }} />

              <div className="p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(139,92,246,0.14)", border: "1px solid rgba(139,92,246,0.25)", boxShadow: "0 0 16px rgba(139,92,246,0.15)" }}>
                    <Globe className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-white text-sm">Live URL Testing</h2>
                    <p className="text-zinc-500 text-xs">Analyze any publicly accessible app</p>
                  </div>
                </div>

                {/* Check badges */}
                <div className="flex flex-wrap gap-1.5">
                  {CHECKS.map((c, i) => (
                    <motion.span
                      key={c.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                      style={{
                        background: "rgba(139,92,246,0.08)",
                        border: "1px solid rgba(139,92,246,0.18)",
                        color: "rgb(196,181,253)",
                      }}
                    >
                      <ShieldCheck className="w-3 h-3" />{c.label}
                    </motion.span>
                  ))}
                </div>

                <Form {...urlForm}>
                  <form onSubmit={urlForm.handleSubmit(onUrlSubmit)} className="space-y-4">
                    <FormField control={urlForm.control} name="appUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Application URL</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                            <Input
                              placeholder="https://your-app.com" autoFocus
                              className="pl-10 h-11 border-white/8 focus-visible:border-violet-500/45 focus-visible:ring-0 rounded-xl text-white placeholder:text-zinc-600 text-sm transition-all"
                              style={{ background: "rgba(255,255,255,0.04)" }}
                              {...field}
                              onFocus={() => setShowRecent(recentUrls.length > 0)}
                              onBlur={() => { field.onBlur(); setTimeout(() => setShowRecent(false), 150); }}
                            />
                            <AnimatePresence>
                              {showRecent && recentUrls.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                  transition={{ duration: 0.14 }}
                                  className="absolute top-full left-0 right-0 mt-1.5 rounded-xl border overflow-hidden z-20"
                                  style={{
                                    background: "hsl(230,24%,9%)",
                                    border: "1px solid rgba(255,255,255,0.09)",
                                    boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
                                  }}
                                >
                                  <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-600 uppercase tracking-widest border-b border-white/5 flex items-center gap-1.5">
                                    <Clock className="w-3 h-3" />Recent
                                  </div>
                                  {recentUrls.map(url => (
                                    <div key={url} className="flex items-center hover:bg-white/4 group transition-colors">
                                      <button
                                        type="button"
                                        className="flex-1 text-left px-3 py-2.5 text-sm text-zinc-300 hover:text-white transition-colors truncate"
                                        onMouseDown={() => {
                                          urlForm.setValue("appUrl", url, { shouldValidate: true });
                                          setShowRecent(false);
                                        }}
                                      >
                                        {url}
                                      </button>
                                      <button
                                        type="button"
                                        className="px-3 py-2.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          removeRecentUrl(url);
                                          const updated = getRecentUrls();
                                          setRecentUrls(updated);
                                          if (updated.length === 0) setShowRecent(false);
                                        }}
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />

                    <FormField control={urlForm.control} name="appDescription" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
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
                          <Textarea
                            placeholder="E.g., e-commerce site where users browse products, add to cart, and checkout. Check for XSS, missing auth, and performance issues."
                            rows={4} maxLength={1000}
                            className="border-white/8 focus-visible:border-violet-500/45 focus-visible:ring-0 rounded-xl text-white placeholder:text-zinc-600 resize-none text-sm transition-all"
                            style={{ background: "rgba(255,255,255,0.04)" }}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />

                    <button
                      type="submit"
                      disabled={createMutation.isPending}
                      className="relative w-full h-12 rounded-xl font-semibold text-white overflow-hidden transition-all gap-2 disabled:opacity-60 disabled:cursor-not-allowed group"
                      style={{
                        background: "linear-gradient(135deg, hsl(258,85%,60%), hsl(258,85%,52%))",
                        boxShadow: !createMutation.isPending ? "0 4px 24px rgba(139,92,246,0.38), 0 1px 0 rgba(255,255,255,0.1) inset" : "none",
                      }}
                    >
                      <span className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700 ease-in-out" />
                      <span className="relative flex items-center justify-center gap-2">
                        {createMutation.isPending
                          ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Starting analysis…</>
                          : "Run QA Assessment →"}
                      </span>
                    </button>
                  </form>
                </Form>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="sast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div
              className="rounded-2xl overflow-hidden relative"
              style={{
                background: "linear-gradient(145deg, hsl(230,22%,8%), hsl(230,22%,7%))",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              }}
            >
              {/* Animated cyan border */}
              <div className="h-0.5 animated-border-cyan" />

              {/* Subtle cyan glow */}
              <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none"
                style={{ background: "radial-gradient(circle at 100% 0%, rgba(6,182,212,0.05), transparent 70%)" }} />

              <div className="p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.22)", boxShadow: "0 0 16px rgba(6,182,212,0.12)" }}>
                    <FileCode2 className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-white text-sm">Static Code Analysis (SAST)</h2>
                    <p className="text-zinc-500 text-xs">Scan source files for vulnerabilities</p>
                  </div>
                </div>

                {/* Check badges */}
                <div className="flex flex-wrap gap-1.5">
                  {SAST_CHECKS.map((c, i) => (
                    <motion.span
                      key={c.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.04 }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
                      style={{
                        background: "rgba(6,182,212,0.08)",
                        border: "1px solid rgba(6,182,212,0.18)",
                        color: "rgb(103,232,249)",
                      }}
                    >
                      <ShieldCheck className="w-3 h-3" />{c.label}
                    </motion.span>
                  ))}
                </div>

                <Form {...sastForm}>
                  <form onSubmit={sastForm.handleSubmit(onSastSubmit)} className="space-y-4">
                    <FormField control={sastForm.control} name="projectName" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Project Name</FormLabel>
                        <FormControl>
                          <Input placeholder="my-api" autoFocus
                            className="h-11 border-white/8 focus-visible:border-cyan-500/40 focus-visible:ring-0 rounded-xl text-white placeholder:text-zinc-600 text-sm transition-all"
                            style={{ background: "rgba(255,255,255,0.04)" }}
                            {...field} />
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />

                    <FormField control={sastForm.control} name="description" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
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
                            rows={3} maxLength={1000}
                            className="border-white/8 focus-visible:border-cyan-500/40 focus-visible:ring-0 rounded-xl text-white placeholder:text-zinc-600 resize-none text-sm transition-all"
                            style={{ background: "rgba(255,255,255,0.04)" }}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-red-400 text-xs" />
                      </FormItem>
                    )} />

                    {/* Drop zone */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Source Files</label>
                        {files.length > 0 && (
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {files.length} file{files.length !== 1 ? "s" : ""} · {(totalSize / 1024).toFixed(0)} KB
                          </span>
                        )}
                      </div>
                      <div
                        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className="relative border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all duration-250 overflow-hidden"
                        style={isDragging ? {
                          borderColor: "rgba(6,182,212,0.6)",
                          background: "rgba(6,182,212,0.06)",
                          boxShadow: "0 0 40px rgba(6,182,212,0.12), inset 0 0 30px rgba(6,182,212,0.04)",
                        } : {
                          borderColor: "rgba(255,255,255,0.1)",
                          background: "rgba(255,255,255,0.02)",
                        }}
                        onMouseEnter={e => {
                          if (!isDragging) {
                            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.16)";
                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isDragging) {
                            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)";
                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                          }
                        }}
                      >
                        <input ref={fileInputRef} type="file" multiple accept={CODE_TYPES} className="hidden"
                          onChange={(e) => e.target.files && addFiles(e.target.files)} />

                        {/* Drag overlay dots */}
                        {isDragging && (
                          <div className="absolute inset-0 pointer-events-none"
                            style={{
                              backgroundImage: "radial-gradient(circle, rgba(6,182,212,0.18) 1px, transparent 1px)",
                              backgroundSize: "20px 20px",
                            }} />
                        )}

                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-3 transition-all duration-200"
                          style={{
                            background: isDragging ? "rgba(6,182,212,0.18)" : "rgba(6,182,212,0.1)",
                            border: isDragging ? "1px solid rgba(6,182,212,0.4)" : "1px solid rgba(6,182,212,0.2)",
                          }}
                        >
                          <Upload className={`w-5 h-5 text-cyan-400 transition-transform duration-200 ${isDragging ? "scale-110 -translate-y-0.5" : ""}`} />
                        </div>
                        <p className="text-white font-semibold text-sm">
                          {isDragging ? "Release to upload" : "Drop files or click to browse"}
                        </p>
                        <p className="text-zinc-500 text-xs mt-1">
                          Source code · Shell scripts · IaC (.tf/.hcl) · Dockerfiles · Config files
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
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.03 }}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
                                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                              >
                                <FileCode2 className="w-3.5 h-3.5 text-cyan-400/70 shrink-0" />
                                <span className="text-zinc-300 text-xs truncate flex-1">{f.name}</span>
                                <span className="text-zinc-600 text-[10px] shrink-0 font-mono">{(f.size / 1024).toFixed(0)}KB</span>
                                <button type="button"
                                  onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors shrink-0 p-0.5 rounded hover:bg-red-500/10">
                                  <X className="w-3 h-3" />
                                </button>
                              </motion.div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {files.length === 0 && (
                      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl"
                        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.14)" }}>
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-amber-400/80 text-xs">Upload source files above to enable the scan button.</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={sastMutation.isPending || files.length === 0}
                      className="relative w-full h-12 rounded-xl font-semibold text-white overflow-hidden transition-all disabled:opacity-55 disabled:cursor-not-allowed group"
                      style={{
                        background: "linear-gradient(135deg, hsl(190,88%,40%), hsl(190,80%,34%))",
                        boxShadow: (!sastMutation.isPending && files.length > 0) ? "0 4px 24px rgba(6,182,212,0.35), 0 1px 0 rgba(255,255,255,0.1) inset" : "none",
                      }}
                    >
                      <span className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700 ease-in-out" />
                      <span className="relative flex items-center justify-center gap-2">
                        {sastMutation.isPending
                          ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Uploading & scanning…</>
                          : "Run SAST Scan →"}
                      </span>
                    </button>
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
