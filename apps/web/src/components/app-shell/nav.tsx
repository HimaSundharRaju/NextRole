"use client";

import {
  Briefcase,
  FileText,
  Headset,
  KanbanSquare,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Send,
  Settings,
  Shield,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/resumes", label: "Resumes", icon: FileText },
  { href: "/applications", label: "Applications", icon: KanbanSquare },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function NavItem({
  href,
  label,
  icon: Icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary-soft text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}

function NavLinks({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const staff = [
    ...(role === "specialist" || role === "admin"
      ? [{ href: "/specialist", label: "Concierge board", icon: UsersRound }]
      : []),
    ...(role === "support" || role === "admin"
      ? [{ href: "/care", label: "Customer care", icon: Headset }]
      : []),
    ...(role === "admin" ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
  ];
  return (
    <nav className="flex flex-col gap-1" aria-label="App">
      {LINKS.map((link) => (
        <NavItem key={link.href} {...link} onNavigate={onNavigate} />
      ))}
      {staff.length > 0 ? (
        <>
          <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Staff
          </p>
          {staff.map((link) => (
            <NavItem key={link.href} {...link} onNavigate={onNavigate} />
          ))}
        </>
      ) : null}
    </nav>
  );
}

/** Help is always one click away, at the bottom of the menu. */
function SupportLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavItem href="/support" label="Contact support" icon={LifeBuoy} onNavigate={onNavigate} />
  );
}

export function Sidebar({ role }: { role: string }) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo href="/dashboard" />
      </div>
      <div className="flex-1 px-3 py-2">
        <NavLinks role={role} />
      </div>
      <div className="border-t border-border px-3 py-3">
        <SupportLink />
      </div>
    </aside>
  );
}

export function MobileNav({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 flex">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          />
          <div className="relative z-10 flex w-64 flex-col bg-card p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Logo href="/dashboard" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks role={role} onNavigate={() => setOpen(false)} />
            <div className="mt-auto border-t border-border pt-3">
              <SupportLink onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
