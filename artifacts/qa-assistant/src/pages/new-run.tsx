import { useCreateQaRun, useCreateSastRun } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Globe, FileCode2, Sparkles, Upload, X, Link as LinkIcon, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useCallback } from "react";

const urlSchema = z.object({
  appUrl: z.string().url("Please enter a valid URL (e.g., https://example.com)"),
  appDescription: z.string().min(10, "Please provide at least 10 characters"),
});

const sastSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  description: z.string().min(5, "Please describe what this project does"),
});

type UrlForm = z.infer<typeof urlSchema>;
type SastForm = z.infer<typeof sastSchema>;

export default function NewRun({ initialTab = "url" }: { initialTab?: "url" | "sast" }) {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"url" | "sast">(initialTab);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const urlForm = useForm<UrlForm>({ resolver: zodResolver(urlSchema), defaultValues: { appUrl: "", appDescription: "" } });
  const sastForm = useForm<SastForm>({ resolver: zodResolver(sastSchema), defaultValues: { projectName: "", description: "" } });

  const createMutation = useCreateQaRun({
    mutation: {
      onSuccess: (data) => { toast.success("Test run created!"); setLocation(`/runs/${data.id}`); },
      onError: (err) => toast.error((err as { error?: string }).error ?? "Failed to create test run"),
    },
  });

  const sastMutation = useCreateSastRun({
    mutation: {
      onSuccess: (data) => { toast.success("SAST scan started!"); setLocation(`/runs/${data.id}`); },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : "Upload failed";
        toast.error(msg);
      },
    },
  });

  function onUrlSubmit(values: UrlForm) {
    createMutation.mutate({ data: values });
  }

  function onSastSubmit(values: SastForm) {
    if (!files.length) { toast.error("Please upload at least one source code file"); return; }
    sastMutation.mutate({ data: { projectName: values.projectName, description: values.description, files } });
  }

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(f => f.size < 5 * 1024 * 1024);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !existing.has(f.name))].slice(0, 30);
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const CODE_TYPES = ".ts,.tsx,.js,.jsx,.mjs,.py,.java,.kt,.cs,.go,.rb,.php,.c,.cpp,.h,.rs,.html,.vue,.svelte,.json,.yaml,.yml,.env,.sql,.sh,.toml,.graphql";

  return (
    <div className="max-w-3xl mx-auto w-full space-y-8">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-display font-bold text-white">New Security Assessment</h1>
        <p className="text-zinc-500 mt-1 text-sm">Choose your testing method below.</p>
      </motion.div>

      {/* Tab switcher */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="flex gap-1 p-1 rounded-2xl bg-white/4 border border-white/8 w-fit">
        {(["url", "sast"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
              tab === t
                ? "bg-violet-600 text-white shadow-lg shadow-violet-900/30"
                : "text-zinc-400 hover:text-zinc-200",
            ].join(" ")}>
            {t === "url" ? <><Globe className="w-4 h-4" /> Live URL Test</> : <><FileCode2 className="w-4 h-4" /> SAST Code Scan</>}
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        {tab === "url" ? (
          <motion.div key="url" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            <div className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
              <div className="h-1 animated-border" />
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/12 border border-violet-500/20 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-white">Live URL Testing</h2>
                    <p className="text-zinc-500 text-xs">Analyze any deployed app by URL</p>
                  </div>
                </div>

                <Form {...urlForm}>
                  <form onSubmit={urlForm.handleSubmit(onUrlSubmit)} className="space-y-6">
                    <FormField control={urlForm.control} name="appUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-200 font-medium">Application URL</FormLabel>
                        <FormDescription className="text-zinc-500 text-xs">Any publicly accessible URL including localhost.</FormDescription>
                        <FormControl>
                          <div className="relative">
                            <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                            <Input placeholder="https://your-app.com" className="pl-10 h-11 bg-white/4 border-white/10 focus-visible:border-violet-500/40 focus-visible:ring-violet-500/20 rounded-xl text-white placeholder:text-zinc-600" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={urlForm.control} name="appDescription" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-200 font-medium flex items-center gap-2">
                          Expected Behavior <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                        </FormLabel>
                        <FormDescription className="text-zinc-500 text-xs">Describe what the app does and what to look for.</FormDescription>
                        <FormControl>
                          <Textarea placeholder="This is an e-commerce site. Users can browse products, add to cart, and checkout. Check security, accessibility, and UX." rows={4} className="bg-white/4 border-white/10 focus-visible:border-violet-500/40 focus-visible:ring-violet-500/20 rounded-xl text-white placeholder:text-zinc-600 resize-none" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={createMutation.isPending} className="w-full h-12 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-lg shadow-violet-900/30 transition-all">
                      {createMutation.isPending ? "Starting analysis…" : "Run QA Assessment →"}
                    </Button>
                  </form>
                </Form>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="sast" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-cyan-500 to-teal-400" />
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/12 border border-cyan-500/20 flex items-center justify-center">
                    <FileCode2 className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-white">Static Code Analysis (SAST)</h2>
                    <p className="text-zinc-500 text-xs">Upload source files to scan for security vulnerabilities</p>
                  </div>
                </div>

                <Form {...sastForm}>
                  <form onSubmit={sastForm.handleSubmit(onSastSubmit)} className="space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                      <FormField control={sastForm.control} name="projectName" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-zinc-200 font-medium">Project Name</FormLabel>
                          <FormControl>
                            <Input placeholder="my-app" className="h-11 bg-white/4 border-white/10 focus-visible:border-cyan-500/40 focus-visible:ring-cyan-500/20 rounded-xl text-white placeholder:text-zinc-600" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={sastForm.control} name="description" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-zinc-200 font-medium flex items-center gap-2">
                            Project Description <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                          </FormLabel>
                          <FormDescription className="text-zinc-500 text-xs">Describe the tech stack and purpose for better analysis.</FormDescription>
                          <FormControl>
                            <Textarea placeholder="Node.js REST API with Express and PostgreSQL. Handles user authentication and payment processing." rows={3} className="bg-white/4 border-white/10 focus-visible:border-cyan-500/40 focus-visible:ring-cyan-500/20 rounded-xl text-white placeholder:text-zinc-600 resize-none" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    {/* Drop zone */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-200 mb-2">Source Files</label>
                      <div
                        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={[
                          "relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all",
                          isDragging ? "border-cyan-500/60 bg-cyan-500/8 shadow-[0_0_30px_rgba(6,182,212,0.12)]" : "border-white/10 bg-white/2 hover:border-white/20 hover:bg-white/4",
                        ].join(" ")}
                      >
                        <input ref={fileInputRef} type="file" multiple accept={CODE_TYPES} className="hidden"
                          onChange={(e) => e.target.files && addFiles(e.target.files)} />
                        <div className="w-12 h-12 rounded-2xl bg-cyan-500/12 border border-cyan-500/20 flex items-center justify-center mx-auto mb-3">
                          <Upload className="w-6 h-6 text-cyan-400" />
                        </div>
                        <p className="text-white font-medium text-sm">Drop files here or click to browse</p>
                        <p className="text-zinc-500 text-xs mt-1">
                          Supports .ts .js .py .java .go .php .rs .html .env .json .yaml and more · Max 5MB per file · Up to 30 files
                        </p>
                      </div>
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-zinc-400 font-medium">{files.length} file{files.length > 1 ? "s" : ""} selected</p>
                          <button type="button" onClick={() => setFiles([])} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Clear all</button>
                        </div>
                        <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                          {files.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/4 border border-white/6 text-xs">
                              <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="text-zinc-300 truncate flex-1">{f.name}</span>
                              <span className="text-zinc-600 shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                              <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                                className="text-zinc-600 hover:text-red-400 transition-colors shrink-0">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {files.length === 0 && (
                      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-500/6 border border-amber-500/15">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-zinc-400 text-xs">Upload individual source files. For a folder, select all files inside it using the file picker.</p>
                      </div>
                    )}

                    <Button type="submit" disabled={sastMutation.isPending || files.length === 0}
                      className="w-full h-12 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 hover:from-cyan-500 hover:to-teal-400 text-white font-semibold shadow-lg shadow-cyan-900/30 transition-all disabled:opacity-50">
                      {sastMutation.isPending ? "Uploading & analyzing…" : `Scan ${files.length > 0 ? files.length + " file" + (files.length > 1 ? "s" : "") : "files"} →`}
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
