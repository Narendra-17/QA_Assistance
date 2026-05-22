import { Suspense, lazy, Component, type ReactNode, useState, useEffect } from "react";
import { PageErrorBoundary } from "@/components/page-error-boundary";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { useAuth } from "@workspace/replit-auth-web";
import { Loader2, AlertTriangle, RefreshCw, Keyboard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortcutsModal } from "@/components/shortcuts-modal";
import { BackToTop } from "@/components/back-to-top";

const NotFound     = lazy(() => import("@/pages/not-found"));
const Landing      = lazy(() => import("@/pages/landing"));
const Login        = lazy(() => import("@/pages/login"));
const Register     = lazy(() => import("@/pages/register"));
const Dashboard    = lazy(() => import("@/pages/dashboard"));
const NewRun       = lazy(() => import("@/pages/new-run"));
const Report       = lazy(() => import("@/pages/report"));
const SharedReport = lazy(() => import("@/pages/shared-report"));
const Integrations = lazy(() => import("@/pages/integrations"));
const Settings     = lazy(() => import("@/pages/settings"));

function UrlTestPage() { return <NewRun initialTab="url"  />; }
function SastPage()    { return <NewRun initialTab="sast" />; }

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status !== undefined && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      staleTime:  30 * 1000,
      gcTime:  5 * 60 * 1000,
    },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  state = { hasError: false, error: undefined as Error | undefined };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[hsl(230,25%,5%)] gap-6 px-4">
          <div className="relative">
            <div className="absolute inset-0 bg-red-500/20 rounded-2xl blur-xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
          </div>
          <div className="text-center">
            <h2 className="font-display font-bold text-xl text-white mb-2">Something went wrong</h2>
            <p className="text-zinc-500 text-sm max-w-sm">{this.state.error?.message ?? "An unexpected error occurred."}</p>
          </div>
          <Button onClick={() => window.location.reload()} className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl gap-2 btn-shimmer">
            <RefreshCw className="w-4 h-4" /> Reload page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <div className="relative">
        <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-lg animate-pulse" />
        <div className="relative w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
        </div>
      </div>
    </div>
  );
}

function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider style={{ "--sidebar-width": "15rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden" style={{ background: "hsl(230,25%,5%)" }}>
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 relative">
          {/* Ambient background orbs */}
          <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute top-0 right-[10%] w-[700px] h-[500px] bg-violet-600/[0.045] rounded-full blur-[160px] orb-drift" />
            <div className="absolute bottom-[10%] left-[20%] w-[600px] h-[400px] bg-cyan-500/[0.035] rounded-full blur-[140px] orb-drift-2" />
            <div className="absolute top-[40%] right-[5%] w-[400px] h-[400px] bg-violet-800/[0.025] rounded-full blur-[120px] orb-drift-3" />
          </div>

          {/* Header */}
          <header
            className="flex h-14 shrink-0 items-center gap-3 px-4 z-10 sticky top-0 relative"
            style={{ background: "rgba(10,10,20,0.72)", backdropFilter: "blur(20px) saturate(1.4)" }}
          >
            {/* Bottom gradient line */}
            <div className="absolute bottom-0 left-0 right-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, hsl(258,85%,64%,0.25), hsl(190,88%,48%,0.15), transparent)" }} />

            <SidebarTrigger className="text-zinc-500 hover:text-zinc-200 hover:bg-white/8 transition-all h-8 w-8 rounded-lg" />
            <div className="flex-1" />
            <button
              onClick={() => document.dispatchEvent(new CustomEvent("open-shortcuts"))}
              className="text-zinc-600 hover:text-violet-300 transition-all h-8 w-8 flex items-center justify-center rounded-lg hover:bg-violet-500/10 hover:border hover:border-violet-500/20 border border-transparent"
              title="Keyboard shortcuts (?)"
              aria-label="View keyboard shortcuts"
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </header>

          <main className="flex-1 overflow-auto p-5 md:p-7 z-0 relative">
            {children}
            <BackToTop />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function ProtectedRouter() {
  const { isAuthenticated, isLoading } = useAuth();
  const [paletteOpen, setPaletteOpen]      = useState(false);
  const [shortcutsOpen, setShortcutsOpen]  = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && isAuthenticated) {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
      if (e.key === "?" && isAuthenticated && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        setShortcutsOpen(p => !p);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isAuthenticated]);

  useEffect(() => {
    function onOpen() { if (isAuthenticated) setPaletteOpen(true); }
    document.addEventListener("open-command-palette", onOpen);
    return () => document.removeEventListener("open-command-palette", onOpen);
  }, [isAuthenticated]);

  useEffect(() => {
    function onOpen() { if (isAuthenticated) setShortcutsOpen(true); }
    document.addEventListener("open-shortcuts", onOpen);
    return () => document.removeEventListener("open-shortcuts", onOpen);
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "hsl(230,25%,5%)" }}>
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/25 rounded-2xl blur-xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-2xl bg-violet-500/12 border border-violet-500/25 flex items-center justify-center shield-pulse">
              <ShieldCheck className="w-8 h-8 text-violet-400" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-violet-500"
                  style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`, opacity: 0.7 }}
                />
              ))}
            </div>
            <p className="text-zinc-600 text-xs tracking-widest uppercase">Authenticating</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/share/:token" component={SharedReport} />
          <Route path="/login"        component={Login}        />
          <Route path="/register"     component={Register}     />
          <Route                      component={Landing}      />
        </Switch>
      </Suspense>
    );
  }

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <MainLayout>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/"             component={() => <PageErrorBoundary label="Dashboard"><Dashboard /></PageErrorBoundary>}    />
            <Route path="/new"          component={() => <PageErrorBoundary label="New Run"><UrlTestPage /></PageErrorBoundary>}    />
            <Route path="/sast"         component={() => <PageErrorBoundary label="SAST Scan"><SastPage /></PageErrorBoundary>}     />
            <Route path="/runs/:id"     component={() => <PageErrorBoundary label="Report"><Report /></PageErrorBoundary>}          />
            <Route path="/integrations" component={() => <PageErrorBoundary label="Integrations"><Integrations /></PageErrorBoundary>} />
            <Route path="/settings"     component={() => <PageErrorBoundary label="Settings"><Settings /></PageErrorBoundary>}      />
            <Route path="/share/:token" component={SharedReport} />
            <Route                      component={NotFound}     />
          </Switch>
        </Suspense>
      </MainLayout>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ProtectedRouter />
          </WouterRouter>
          <Toaster
            position="bottom-right"
            theme="dark"
            toastOptions={{
              duration: 3500,
              classNames: {
                toast:       "border border-white/10 text-white font-sans rounded-2xl shadow-2xl backdrop-blur-xl",
                description: "text-zinc-400",
                success:     "!bg-emerald-950/90 !border-emerald-500/25",
                error:       "!bg-red-950/90 !border-red-500/25",
                info:        "!bg-[hsl(230,22%,11%)] !border-white/10",
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
