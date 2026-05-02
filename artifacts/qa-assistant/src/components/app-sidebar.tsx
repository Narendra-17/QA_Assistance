import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShieldCheck, FileCode2, Globe, LogOut, ChevronRight, Zap,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarHeader,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@workspace/replit-auth-web";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { title: "Dashboard",      url: "/",            icon: LayoutDashboard, desc: "Overview & history" },
  { title: "New URL Test",   url: "/new",         icon: Globe,           desc: "Test a live app" },
  { title: "New SAST Scan",  url: "/sast",        icon: FileCode2,       desc: "Scan source code" },
] as const;

const BOTTOM_NAV_ITEMS = [
  { title: "CI/CD",          url: "/integrations", icon: Zap,             desc: "API keys & GitHub Actions" },
] as const;

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean).map(s => s![0]).join("").toUpperCase() || "U";

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Developer";

  return (
    <Sidebar className="border-r border-white/5" style={{ background: "hsl(230,28%,5.5%)" }}>
      {/* Logo */}
      <SidebarHeader className="px-4 py-4 border-b border-white/5">
        <Link href="/" className="flex items-center gap-3 group focus-visible:outline-none">
          <div className="relative shrink-0">
            <div className="absolute inset-0 bg-violet-500/18 rounded-xl blur-sm transition-all group-hover:blur-md group-hover:bg-violet-500/22" />
            <div className="relative bg-violet-500/12 p-2 rounded-xl border border-violet-500/22 transition-all group-hover:border-violet-500/40">
              <ShieldCheck className="w-4.5 h-4.5 text-violet-400" style={{ width: "1.125rem", height: "1.125rem" }} />
            </div>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-display font-extrabold text-sm text-white tracking-tight leading-none">
              QA<span className="text-violet-400">Assistant</span>
            </span>
            <span className="text-[10px] text-zinc-600 tracking-widest uppercase mt-0.5">Security Platform</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2.5 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 mb-1.5 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
            Testing
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
                          <Link href={item.url} className="focus-visible:outline-none">
                            <div className={[
                              "flex items-center gap-3 px-2.5 py-2 rounded-xl w-full transition-all duration-150 group",
                              isActive
                                ? "bg-violet-500/10 text-violet-300 border border-violet-500/18"
                                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent",
                            ].join(" ")}>
                              <div className={[
                                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                                isActive
                                  ? "bg-violet-500/18 shadow-[0_0_10px_rgba(139,92,246,0.25)]"
                                  : "bg-white/5 group-hover:bg-white/8",
                              ].join(" ")}>
                                <item.icon className={`w-3.5 h-3.5 ${isActive ? "text-violet-400" : ""}`} />
                              </div>
                              <span className="font-medium text-[13px] flex-1">{item.title}</span>
                              {isActive && (
                                <ChevronRight className="w-3 h-3 text-violet-500 ml-auto" />
                              )}
                            </div>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          {item.desc}
                        </TooltipContent>
                      </Tooltip>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Integrations group */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 mb-1.5 text-[10px] font-bold tracking-widest text-zinc-600 uppercase">
            Integrations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {BOTTOM_NAV_ITEMS.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link href={item.url} className="focus-visible:outline-none">
                            <div className={[
                              "flex items-center gap-3 px-2.5 py-2 rounded-xl w-full transition-all duration-150 group",
                              isActive
                                ? "bg-violet-500/10 text-violet-300 border border-violet-500/18"
                                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent",
                            ].join(" ")}>
                              <div className={[
                                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                                isActive
                                  ? "bg-violet-500/18 shadow-[0_0_10px_rgba(139,92,246,0.25)]"
                                  : "bg-white/5 group-hover:bg-white/8",
                              ].join(" ")}>
                                <item.icon className={`w-3.5 h-3.5 ${isActive ? "text-violet-400" : ""}`} />
                              </div>
                              <span className="font-medium text-[13px] flex-1">{item.title}</span>
                              {isActive && (
                                <ChevronRight className="w-3 h-3 text-violet-500 ml-auto" />
                              )}
                            </div>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          {item.desc}
                        </TooltipContent>
                      </Tooltip>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* User footer */}
      <SidebarFooter className="px-2.5 py-3 border-t border-white/5">
        <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl bg-white/3 border border-white/6 mb-1.5">
          <Avatar className="h-7 w-7 shrink-0 border border-violet-500/25">
            <AvatarImage src={user?.profileImageUrl ?? ""} />
            <AvatarFallback className="bg-violet-500/18 text-violet-300 text-[10px] font-bold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[13px] font-semibold text-white truncate leading-none">{displayName}</span>
            <span className="text-[10px] text-zinc-500 truncate mt-0.5">{user?.email ?? "Developer"}</span>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 px-2.5 py-2 rounded-xl w-full text-zinc-600 hover:text-red-400 hover:bg-red-500/7 transition-all text-[13px] group"
        >
          <LogOut className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Sign Out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
