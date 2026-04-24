import { Suspense, lazy, Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@workspace/replit-auth-web";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = lazy(() => import("@/pages/not-found"));
const Landing = lazy(() => import("@/pages/landing"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const NewRun = lazy(() => import("@/pages/new-run"));
const Report = lazy(() => import("@/pages/report"));
const SharedReport = lazy(() => import("@/pages/shared-report"));

function UrlTestPage() { return <NewRun initialTab="url" />; }
function SastPage() { return <NewRun initialTab="sast" />; }

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
    },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  state = { hasError: false, error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[hsl(230,25%,5%)] gap-6 px-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <div className="text-center">
            <h2 className="font-display font-bold text-xl text-white mb-2">Something went wrong</h2>
            <p className="text-zinc-500 text-sm max-w-sm">{this.state.error?.message ?? "An unexpected error occurred."}</p>
          </div>
          <Button onClick={() => window.location.reload()} className="bg-violet-600 hover:bg-violet-500 text-white rounded-xl gap-2">
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
      <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
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
          <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-violet-600/4 rounded-full blur-[140px]" />
            <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] bg-cyan-500/3 rounded-full blur-[120px]" />
          </div>

          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 px-4 backdrop-blur-xl z-10 sticky top-0"
            style={{ background: "hsl(230,25%,5%,0.85)" }}>
            <SidebarTrigger className="text-zinc-500 hover:text-zinc-200 transition-colors h-8 w-8" />
            <div className="flex-1" />
          </header>

          <main className="flex-1 overflow-auto p-5 md:p-7 z-0 relative">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function ProtectedRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "hsl(230,25%,5%)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/20 rounded-2xl blur-lg animate-pulse" />
            <div className="relative w-14 h-14 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
            </div>
          </div>
          <p className="text-zinc-500 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          {/* Public share route — accessible without login */}
          <Route path="/share/:token" component={SharedReport} />
          <Route component={Landing} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <MainLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/new" component={UrlTestPage} />
          <Route path="/sast" component={SastPage} />
          <Route path="/runs/:id" component={Report} />
          {/* Share route also available when logged in */}
          <Route path="/share/:token" component={SharedReport} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </MainLayout>
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
                toast: "border border-white/10 text-white font-sans rounded-2xl shadow-2xl backdrop-blur-xl",
                description: "text-zinc-400",
                success: "bg-emerald-950/90 border-emerald-500/20",
                error: "bg-red-950/90 border-red-500/20",
                info: "bg-[hsl(230,22%,12%)]",
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
