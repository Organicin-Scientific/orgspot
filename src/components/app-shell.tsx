"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import {
  BarChart3,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/investors", label: "Investors", icon: Users },
  { href: "/updates", label: "Updates", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

interface ShellProps {
  email: string;
  liveSending: boolean;
  environment: string;
  children: React.ReactNode;
}

export function AppShell({ email, liveSending, environment, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <SidebarBody email={email} liveSending={liveSending} environment={environment} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody email={email} liveSending={liveSending} environment={environment} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <span className="font-semibold">Investor Updates</span>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function SidebarBody({
  email,
  liveSending,
  environment,
  onNavigate,
}: Omit<ShellProps, "children"> & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  async function newUpdate() {
    setCreating(true);
    try {
      const u = await api<{ id: string }>("/api/updates", { method: "POST", body: {} });
      onNavigate?.();
      router.push(`/updates/${u.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-brand text-[13px] font-bold text-brand-foreground">O</div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">Organicin Scientific</div>
          <div className="text-xs text-muted-foreground">Investor Updates</div>
        </div>
      </div>
      <div className="px-3 pb-2">
        <Button className="w-full justify-start" onClick={newUpdate} disabled={creating}>
          <Plus />
          New Update
        </Button>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isActive(href) && "bg-sidebar-accent font-medium text-sidebar-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
      <div className="space-y-2 border-t p-3">
        {!liveSending && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-foreground">
                <FlaskConical className="size-3.5 text-warning" aria-hidden />
                Sandbox mode · {environment}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-56">
              Emails are recorded but never delivered. Live sending is only possible in production with sending enabled.
            </TooltipContent>
          </Tooltip>
        )}
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            isActive("/settings") && "bg-sidebar-accent font-medium text-sidebar-foreground",
          )}
        >
          <Settings className="size-4" aria-hidden />
          Settings
        </Link>
        <UserMenu email={email} />
      </div>
    </div>
  );
}

function UserMenu({ email }: { email: string }) {
  const { theme, setTheme } = useTheme();
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      // Full reload so no investor data survives in client memory after sign-out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-sidebar-accent">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">{email[0]}</span>
          <span className="min-w-0 flex-1 truncate text-sidebar-foreground/80">{email}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
