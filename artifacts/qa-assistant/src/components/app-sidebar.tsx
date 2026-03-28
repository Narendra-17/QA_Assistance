import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, PlusCircle, ShieldCheck, FileCode2,
  Globe, LogOut, BarChart3, Settings,
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
  { title: "Dashboard", url: "/", icon: LayoutDashboard, desc: "Overview & recent runs" },
  { title: "New URL Test", url: "/new", icon: Globe, desc: "Test a live application" },
  { title: "New SAST Scan", url: "/sast", icon: FileCode2, desc: "Scan source code files" },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean).map(s => s![0]).join("").toUpperCase() || "U";

  return (
    <Sidebar className="border-r border-[hsl(230,20%,11%)] bg-[hsl(230,28%,6%)]">
      {/* Logo */}
      <SidebarHeader className="px-5 py-5 border-b border-[hsl(230,20%,11%)]">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="absolute inset-0 bg-violet-500/20 rounded-xl blur-sm transition-all group-hover:blur-md" />
            <div className="relative bg-violet-500/15 p-2 rounded-xl border border-violet-500/25 transition-all group-hover:border-violet-500/45">
              <ShieldCheck className="w-5 h-5 text-violet-400" />
            </div>
          </div>
          <div>
            <div className="font-display font-extrabold text-base text-white tracking-tight">
              QA<span className="text-violet-400">Assistant</span>
            </div>
            <div className="text-[10px] text-zinc-500 font-medium tracking-wider uppercase">Security Platform</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 mb-2 text-[10px] font-semibold tracking-widest text-zinc-600 uppercase">
            Testing
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url}>
                        <div className={[
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-all duration-150 group",
                          isActive
                            ? "bg-violet-500/12 text-violet-300 border border-violet-500/20"
                            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent",
                        ].join(" ")}>
                          <div className={[
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all",
                            isActive ? "bg-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.3)]" : "bg-white/5 group-hover:bg-white/8",
                          ].join(" ")}>
                            <item.icon className={cn("w-4 h-4", isActive ? "text-violet-400" : "")} />
                          </div>
                          <span className="font-medium text-sm">{item.title}</span>
                          {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400" />}
                        </div>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* User footer */}
      <SidebarFooter className="px-3 py-4 border-t border-[hsl(230,20%,11%)]">
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/3 border border-white/6 mb-2">
          <Avatar className="h-8 w-8 border border-violet-500/30">
            <AvatarImage src={user?.profileImageUrl ?? ""} />
            <AvatarFallback className="bg-violet-500/20 text-violet-300 text-xs font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold text-white truncate">{user?.firstName} {user?.lastName}</span>
            <span className="text-xs text-zinc-500 truncate">{user?.email || "Developer"}</span>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl w-full text-zinc-500 hover:text-red-400 hover:bg-red-500/8 transition-all text-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
