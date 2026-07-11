import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Store, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { navigationGroups, getFlatNavigation, getRouteTitle, isGroupActive } from "@/config/navigation";
import { useBootstrap } from "@/hooks/useAdminQueries";
import { filterNavigationByPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { flushActivityQueue, recordActivity } from "@/lib/activityAudit";
import { useAppStore } from "@/store/appStore";

function AppShell({ children }) {
  const { data } = useBootstrap();
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAppStore((state) => state.session);
  const selectedOutletId = useAppStore((state) => state.selectedOutletId);
  const setSelectedOutletId = useAppStore((state) => state.setSelectedOutletId);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const logout = useAppStore((state) => state.logout);
  const [openGroups, setOpenGroups] = useState(() =>
    navigationGroups.reduce((result, item) => {
      if (item.children) result[item.label] = true;
      return result;
    }, {})
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const allowedOutlets = data?.outlets?.filter((outlet) => outlet.status === "active" && session?.outlet_ids?.includes(outlet.id)) || [];
  const isMultiOutlet = allowedOutlets.length > 1;
  const activeLabel = getRouteTitle(location.pathname);
  const visibleNavigationGroups = filterNavigationByPermission(navigationGroups, session);
  const flatNavigation = getFlatNavigation(visibleNavigationGroups);

  useEffect(() => {
    flushActivityQueue().catch(() => {});
    recordActivity({
      module: "navigation",
      action: "page_open",
      entityType: "route",
      entityId: location.pathname,
      description: `Membuka halaman ${activeLabel}.`,
      metadata: { path: location.pathname }
    });
  }, [activeLabel, location.pathname]);

  async function handleLogout() {
    await recordActivity({ module: "auth", action: "logout", entityType: "user", entityId: session?.id, description: `${session?.name || "User"} logout dari Admin Web.` });
    logout();
    navigate("/login", { replace: true });
  }

  function handleOutletChange(nextOutletId) {
    const previousOutletId = selectedOutletId;
    setSelectedOutletId(nextOutletId);
    recordActivity({
      module: "navigation",
      action: "outlet_switch",
      entityType: "outlet",
      entityId: nextOutletId,
      outletId: nextOutletId === "all" ? null : nextOutletId,
      description: "Mengganti outlet aktif Admin Web.",
      metadata: { previous_outlet_id: previousOutletId, next_outlet_id: nextOutletId }
    });
  }

  function toggleGroup(label) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label]
    }));
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-[#405063] bg-[#2C3947] text-white transition-all duration-200 lg:flex lg:flex-col",
          sidebarCollapsed ? "w-[72px]" : "w-[272px]"
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-white/10", sidebarCollapsed ? "justify-center px-0" : "gap-3 px-4")}>
          <img src="/barokah-mark.svg" alt="Barokah" className="h-9 w-9 rounded-md" />
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">Barokah Admin</p>
              <p className="truncate text-[11px] text-white/60">POS Management</p>
            </div>
          ) : null}
        </div>

        <nav className={cn("flex-1 overflow-y-auto scrollbar-thin", sidebarCollapsed ? "px-3 py-3" : "p-3")}>
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-1">
              {visibleNavigationGroups.map((group) => {
                const GroupIcon = group.icon;
                const active = isGroupActive(group, location.pathname);

                if (!group.children) {
                  return (
                    <Tooltip key={group.to}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={group.label}
                          onClick={() => navigate(group.to)}
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-0 leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#2C3947]",
                            active ? "bg-primary text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <span className="flex h-5 w-5 items-center justify-center">
                            <GroupIcon className="block h-4 w-4 shrink-0" />
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">{group.label}</TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <DropdownMenu key={group.label}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={group.label}
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-0 leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#2C3947]",
                              active ? "bg-primary text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            <span className="flex h-5 w-5 items-center justify-center">
                              <GroupIcon className="block h-4 w-4 shrink-0" />
                            </span>
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right">{group.label}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent side="right" align="start" sideOffset={10} className="min-w-60">
                      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {group.children.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = location.pathname === child.to;
                        return (
                          <DropdownMenuItem
                            key={child.to}
                            onSelect={() => navigate(child.to)}
                            className={cn("gap-2", childActive && "bg-primary text-white focus:bg-primary focus:text-white")}
                          >
                            <ChildIcon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{child.label}</span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {visibleNavigationGroups.map((group) => {
                const GroupIcon = group.icon;
                const active = isGroupActive(group, location.pathname);

                if (!group.children) {
                  return (
                    <NavLink
                      key={group.to}
                      to={group.to}
                      onClick={() => setMobileSidebarOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex h-10 items-center gap-3 rounded-md px-3 text-[12px] font-medium transition-colors",
                          isActive ? "bg-primary text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                        )
                      }
                    >
                      <GroupIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{group.label}</span>
                    </NavLink>
                  );
                }

                const isOpen = openGroups[group.label] || active;

                return (
                  <div key={group.label} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      className={cn(
                        "flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-[12px] font-semibold transition-colors",
                        active ? "bg-white/10 text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <GroupIcon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen ? (
                      <div className="space-y-1 pl-4">
                        {group.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <NavLink
                              key={child.to}
                              to={child.to}
                              onClick={() => setMobileSidebarOpen(false)}
                              className={({ isActive }) =>
                                cn(
                                  "flex h-9 items-center gap-3 rounded-md px-3 text-[12px] font-medium transition-colors",
                                  isActive ? "bg-primary text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
                                )
                              }
                            >
                              <ChildIcon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{child.label}</span>
                            </NavLink>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </nav>

        <div className="border-t border-white/10 p-3">
          <Button
            variant="ghost"
            className={cn("w-full text-white/72 hover:bg-white/10 hover:text-white", sidebarCollapsed ? "justify-center px-0" : "justify-start")}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!sidebarCollapsed ? "Ringkas sidebar" : null}
          </Button>
        </div>
      </aside>

      <div className={cn("fixed inset-0 z-50 lg:hidden", mobileSidebarOpen ? "pointer-events-auto" : "pointer-events-none")}>
        <button
          type="button"
          aria-label="Tutup menu"
          className={cn(
            "absolute inset-0 bg-[#2C3947]/45 backdrop-blur-sm transition-opacity",
            mobileSidebarOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileSidebarOpen(false)}
        />
        <aside
          className={cn(
            "relative flex h-full w-[min(84vw,292px)] flex-col border-r border-white/10 bg-[#2C3947] text-white shadow-2xl transition-transform duration-200",
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
            <img src="/barokah-mark.svg" alt="Barokah" className="h-9 w-9 rounded-md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">Barokah Admin</p>
              <p className="truncate text-[11px] text-white/60">POS Management</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-white/72 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Tutup menu</span>
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
              {visibleNavigationGroups.map((group) => {
                const GroupIcon = group.icon;
                const active = isGroupActive(group, location.pathname);

                if (!group.children) {
                  return (
                    <NavLink
                      key={group.to}
                      to={group.to}
                      className={({ isActive }) =>
                        cn(
                          "flex h-10 items-center gap-3 rounded-md px-3 text-[12px] font-medium transition-colors",
                          isActive ? "bg-primary text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                        )
                      }
                    >
                      <GroupIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{group.label}</span>
                    </NavLink>
                  );
                }

                const isOpen = openGroups[group.label] || active;

                return (
                  <div key={group.label} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      className={cn(
                        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[12px] font-semibold transition-colors",
                        active ? "bg-white/10 text-white" : "text-white/72 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <GroupIcon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen ? (
                      <div className="space-y-1 pl-4">
                        {group.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <NavLink
                              key={child.to}
                              to={child.to}
                              className={({ isActive }) =>
                                cn(
                                  "flex h-9 items-center gap-3 rounded-md px-3 text-[12px] font-medium transition-colors",
                                  isActive ? "bg-primary text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
                                )
                              }
                            >
                              <ChildIcon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{child.label}</span>
                            </NavLink>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </nav>
        </aside>
      </div>

      <div className={cn("min-h-screen transition-all duration-200 lg:pl-[272px]", sidebarCollapsed && "lg:pl-[72px]")}>
        <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
          <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu />
                <span className="sr-only">Buka menu</span>
              </Button>
              <div className="min-w-0">
                <p className="truncate text-[11px] text-muted-foreground">Admin Panel / {activeLabel}</p>
                <h1 className="truncate text-[20px] font-semibold">{activeLabel}</h1>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={selectedOutletId} onValueChange={handleOutletChange}>
                <SelectTrigger className="min-w-[220px] max-w-[300px] whitespace-nowrap sm:w-64 [&>span]:truncate [&>span]:whitespace-nowrap">
                  <Store className="mr-2 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Pilih outlet" />
                </SelectTrigger>
                <SelectContent>
                  {isMultiOutlet ? <SelectItem value="all">Semua Outlet</SelectItem> : null}
                  {allowedOutlets.map((outlet) => (
                    <SelectItem key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut />
                Logout
              </Button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto border-t px-4 py-2 lg:hidden">
            {flatNavigation.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-[12px] font-medium",
                      isActive ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] p-4 lg:p-5">{children}</main>
      </div>
    </div>
  );
}

export { AppShell };
