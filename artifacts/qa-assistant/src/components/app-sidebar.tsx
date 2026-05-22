import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShieldCheck, FileCode2, Globe, LogOut,
  ChevronRight, Zap, Search, CheckCircle2, Loader2, AlertCircle, Clock, Settings,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarHeader,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@workspace/replit-auth-web";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useListQaRuns } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";

const NAV_ITEMS = [
  { title: "Dashboard",     url: "/",     icon: LayoutDashboard, desc: "Overview & history" },
  { title: "New URL Test",  url: "/new",  icon: Globe,           desc: "Test a live app"    },
  { title: "New SAST Scan", url: "/sast", icon: FileCode2,       desc: "Scan source code"   },
] as const;

const BOTTOM_NAV_ITEMS = [
  { title: "CI/CD",     url: "/integrations", icon: Zap,      desc: "API keys & GitHub Actions", accent: "cyan"   },
  { title: "Settings",  url: "/settings",     icon: Settings, desc: "Account & security",         accent: "violet" },
] as const;

function RunStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 shrink-0" />;
  if (status === "failed")    return <AlertCircle  className="w-2.5 h-2.5 text-red-400 shrink-0"     />;
  if (status === "running" || status === "pending") return <Loader2 className="w-2.5 h-2.5 text-blue-400 animate-spin shrink-0" />;
  return <Clock className="w-2.5 h-2.5 text-zinc-600 shrink-0" />;
}

export function AppSidebar() {
  const { user, logout }   = useAuth();
  const [location]         = useLocation();
  const { data: runsData, refetch } = useListQaRuns();
  const recentRuns   = runsData?.runs?.slice(0, 4) ?? [];
  const runningCount = (runsData?.runs ?? []).filter(r => r.status === "running" || r.status === "pending").length;

  useEffect(() => {
    if (runningCount === 0) return;
    const t = setInterval(() => void refetch(), 3000);
    return () => clearInterval(t);
  }, [runningCount, refetch]);

  const initials     = [user?.firstName, user?.lastName].filter(Boolean).map(s => s![0]).join("").toUpperCase() || "U";
  const displayName  = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Developer";

  function openPalette() {
    document.dispatchEvent(new CustomEvent("open-command-palette"));
  }

  return (
    <Sidebar
      className="border-r border-white/[0.06]"
      style={{ background: "hsl(230,28%,4.5%)" }}
    >
      {/* Logo area */}
      <SidebarHeader className="px-4 py-4 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-3 group focus-visible:outline-none mb-3">
          <div className="relative shrink-0">
            {/* Outer ambient glow */}
            <div className="absolute inset-[-4px] bg-violet-500/12 rounded-2xl blur-md transition-all group-hover:bg-violet-500/20 group-hover:blur-lg" />
            {/* Shield container */}
            <div className="relative bg-gradient-to-br from-violet-500/20 to-violet-600/10 p-2.5 rounded-xl border border-violet-500/30 transition-all group-hover:border-violet-400/45 group-hover:from-violet-500/25 shield-pulse">
              <ShieldCheck className="text-violet-400" style={{ width: "1.125rem", height: "1.125rem" }} />
            </div>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-display font-extrabold text-sm text-white tracking-tight leading-none">
              QA<span className="gradient-text">Assistant</span>
            </span>
            <span className="text-[10px] text-zinc-600 tracking-widest uppercase mt-0.5 font-medium">Security Platform</span>
          </div>
        </Link>

        {/* Search / Command palette */}
        <button
          onClick={openPalette}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-xl border text-xs group transition-all duration-200"
          style={{
            background: "rgba(255,255,255,0.03)",
            borderColor: "rgba(255,255,255,0.07)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.055)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.25)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
          }}
        >
          <Search className="w-3.5 h-3.5 shrink-0 text-zinc-600 group-hover:text-violet-400 transition-colors" />
          <span className="flex-1 text-left text-zinc-600 group-hover:text-zinc-400 transition-colors">Search…</span>
          <kbd className="text-[9px] font-mono bg-white/5 border border-white/8 rounded px-1.5 py-0.5 leading-none select-none text-zinc-600">⌘K</kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="px-2.5 py-3">
        {/* Main nav */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 mb-1.5 text-[9px] font-bold tracking-[0.18em] text-zinc-600 uppercase">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link href={item.url} className="focus-visible:outline-none block">
                            <div className={[
                              "relative flex items-center gap-3 px-2.5 py-2 rounded-xl w-full transition-all duration-150 group",
                              isActive
                                ? "bg-gradient-to-r from-violet-500/14 to-violet-600/5 text-violet-300 border border-violet-500/22"
                                : "text-zinc-400 hover:text-zinc-200 border border-transparent",
                            ].join(" ")}
                            style={!isActive ? {
                              "--hover-bg": "rgba(255,255,255,0.045)",
                            } as React.CSSProperties : {}}
                            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.045)"; }}
                            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = ""; }}
                            >
                              {/* Left accent glow for active */}
                              {isActive && (
                                <span className="absolute left-0 top-[15%] bottom-[15%] w-[3px] rounded-r-full bg-gradient-to-b from-violet-400 to-violet-600"
                                  style={{ boxShadow: "0 0 8px rgba(139,92,246,0.9), 0 0 20px rgba(139,92,246,0.3)" }} />
                              )}
                              <div className={[
                                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                                isActive
                                  ? "bg-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
                                  : "bg-white/[0.04] group-hover:bg-white/[0.07]",
                              ].join(" ")}>
                                <item.icon className={`w-3.5 h-3.5 ${isActive ? "text-violet-400" : "text-zinc-500 group-hover:text-zinc-300 transition-colors"}`} />
                              </div>
                              <span className={`font-medium text-[13px] flex-1 ${isActive ? "text-violet-200" : ""}`}>{item.title}</span>
                              {isActive && <ChevronRight className="w-3 h-3 text-violet-500/70 ml-auto shrink-0" />}
                            </div>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">{item.desc}</TooltipContent>
                      </Tooltip>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Integrations & Settings */}
        <SidebarGroup className="mt-1">
          <SidebarGroupLabel className="px-2 mb-1.5 text-[9px] font-bold tracking-[0.18em] text-zinc-600 uppercase">
            Integrations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {BOTTOM_NAV_ITEMS.map((item) => {
                const isActive = location === item.url;
                const isCyan = item.accent === "cyan";
                const activeGrad  = isCyan
                  ? "bg-gradient-to-r from-cyan-500/12 to-cyan-600/4 text-cyan-300 border border-cyan-500/20"
                  : "bg-gradient-to-r from-violet-500/12 to-violet-600/4 text-violet-300 border border-violet-500/20";
                const accentBar   = isCyan
                  ? "bg-gradient-to-b from-cyan-400 to-cyan-600"
                  : "bg-gradient-to-b from-violet-400 to-violet-600";
                const accentGlow  = isCyan
                  ? "0 0 8px rgba(6,182,212,0.9), 0 0 20px rgba(6,182,212,0.3)"
                  : "0 0 8px rgba(139,92,246,0.9), 0 0 20px rgba(139,92,246,0.3)";
                const iconActive  = isCyan
                  ? "bg-cyan-500/18 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                  : "bg-violet-500/18 shadow-[0_0_12px_rgba(139,92,246,0.25)]";
                const iconColor   = isCyan ? "text-cyan-400" : "text-violet-400";
                const textColor   = isCyan ? "text-cyan-200" : "text-violet-200";
                const chevronColor = isCyan ? "text-cyan-500/70" : "text-violet-500/70";
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link href={item.url} className="focus-visible:outline-none block">
                            <div className={[
                              "relative flex items-center gap-3 px-2.5 py-2 rounded-xl w-full transition-all duration-150 group",
                              isActive ? activeGrad : "text-zinc-400 hover:text-zinc-200 border border-transparent",
                            ].join(" ")}
                            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.045)"; }}
                            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = ""; }}
                            >
                              {isActive && (
                                <span className={`absolute left-0 top-[15%] bottom-[15%] w-[3px] rounded-r-full ${accentBar}`}
                                  style={{ boxShadow: accentGlow }} />
                              )}
                              <div className={[
                                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                                isActive ? iconActive : "bg-white/[0.04] group-hover:bg-white/[0.07]",
                              ].join(" ")}>
                                <item.icon className={`w-3.5 h-3.5 ${isActive ? iconColor : "text-zinc-500 group-hover:text-zinc-300 transition-colors"}`} />
                              </div>
                              <span className={`font-medium text-[13px] flex-1 ${isActive ? textColor : ""}`}>{item.title}</span>
                              {isActive && <ChevronRight className={`w-3 h-3 ${chevronColor} ml-auto shrink-0`} />}
                            </div>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">{item.desc}</TooltipContent>
                      </Tooltip>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Recent scans */}
        {recentRuns.length > 0 && (
          <SidebarGroup className="mt-1">
            <SidebarGroupLabel className="px-2 mb-1.5 text-[9px] font-bold tracking-[0.18em] text-zinc-600 uppercase">
              Recent Scans
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-0.5">
                {recentRuns.map((run) => {
                  const isUrl    = run.runType === "url";
                  const isActive = location === `/runs/${run.id}`;
                  const label    = run.appUrl ?? run.projectName ?? "Unnamed scan";

                  return (
                    <SidebarMenuItem key={run.id}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link href={`/runs/${run.id}`} className="focus-visible:outline-none block">
                              <div className={[
                                "relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl w-full transition-all duration-150 group",
                                isActive
                                  ? "text-violet-300 border border-violet-500/16"
                                  : "text-zinc-500 hover:text-zinc-300 border border-transparent",
                              ].join(" ")}
                              style={isActive ? { background: "rgba(139,92,246,0.07)" } : {}}
                              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.035)"; }}
                              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = ""; }}
                              >
                                <div className={[
                                  "w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all",
                                  isUrl ? "bg-violet-500/10" : "bg-cyan-500/10",
                                ].join(" ")}>
                                  {isUrl
                                    ? <Globe className="w-2.5 h-2.5 text-violet-400/70" />
                                    : <FileCode2 className="w-2.5 h-2.5 text-cyan-400/70" />}
                                </div>
                                <span className="text-[12px] truncate flex-1 leading-none">{label}</span>
                                <RunStatusIcon status={run.status} />
                              </div>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs max-w-[200px] truncate">
                            {label} · {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                          </TooltipContent>
                        </Tooltip>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* User footer */}
      <SidebarFooter className="px-2.5 py-3 border-t border-white/[0.06]">
        {/* Scan quota pill */}
        {runsData?.runs != null && (
          <div className="px-1 mb-2.5">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-zinc-600 font-medium">Scan quota</span>
              <span className="font-mono tabular-nums"
                style={{
                  color: runsData.runs.length >= 450 ? "#EF4444"
                    : runsData.runs.length >= 400 ? "#F59E0B" : "#71717a",
                }}>
                {runsData.runs.length} / 500
              </span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min((runsData.runs.length / 500) * 100, 100)}%`,
                  background: runsData.runs.length >= 450 ? "#EF4444"
                    : runsData.runs.length >= 400 ? "#F59E0B" : "#8B5CF6",
                }}
              />
            </div>
          </div>
        )}

        {/* User card */}
        <div
          className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl mb-1.5 relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(6,182,212,0.04))",
            border: "1px solid rgba(139,92,246,0.16)",
          }}
        >
          {/* Subtle background sheen */}
          <div className="absolute inset-0 opacity-30"
            style={{ background: "radial-gradient(ellipse at 0% 50%, rgba(139,92,246,0.1), transparent 70%)" }} />

          <div className="relative shrink-0">
            <Avatar className="h-7 w-7 border border-violet-500/30 shadow-[0_0_8px_rgba(139,92,246,0.2)]">
              <AvatarImage src={user?.profileImageUrl ?? ""} />
              <AvatarFallback className="bg-violet-500/20 text-violet-300 text-[10px] font-bold">{initials}</AvatarFallback>
            </Avatar>
            {/* Online dot */}
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-[1.5px] border-[hsl(230,28%,4.5%)]" />
          </div>
          <div className="flex flex-col min-w-0 flex-1 relative">
            <span className="text-[13px] font-semibold text-white truncate leading-none">{displayName}</span>
            <span className="text-[10px] text-zinc-500 truncate mt-0.5">{user?.email ?? "Developer"}</span>
          </div>
        </div>

        <button
          onClick={logout}
          className="flex items-center gap-2 px-2.5 py-2 rounded-xl w-full text-zinc-600 transition-all text-[13px] group"
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = "rgb(248,113,113)";
            (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.07)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.15)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = "";
            (e.currentTarget as HTMLElement).style.background = "";
            (e.currentTarget as HTMLElement).style.borderColor = "";
          }}
          style={{ border: "1px solid transparent" }}
        >
          <LogOut className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Sign Out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
