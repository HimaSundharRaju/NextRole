"use client";

import { Bell, Briefcase, CalendarClock, Info, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { fetchNotifications, markNotificationsRead } from "@/app/(app)/shell-actions";
import { Avatar } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";
import { cn, initials, timeAgo } from "@/lib/utils";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
};

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onOutside]);
  return ref;
}

export function NotificationsBell({ unread }: { unread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  // Unread count the user has already seen (by opening the menu); new arrivals show again.
  const [seenUnread, setSeenUnread] = useState<number | null>(null);
  const count = seenUnread === unread ? 0 : unread;
  const [, startTransition] = useTransition();
  const ref = useClickOutside(() => setOpen(false));

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      startTransition(async () => {
        const result = await fetchNotifications({});
        if (result.ok) setItems(result.data);
        if (count > 0) {
          setSeenUnread(unread);
          await markNotificationsRead({});
          router.refresh();
        }
      });
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="relative rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={count ? `Notifications (${count} unread)` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            Notifications
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              items.map((item) => {
                const Icon =
                  item.type === "job_match"
                    ? Briefcase
                    : item.type === "follow_up"
                      ? CalendarClock
                      : Info;
                const content = (
                  <div
                    className={cn(
                      "flex gap-3 px-4 py-3 hover:bg-muted",
                      !item.read && "bg-primary-soft/40",
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.body ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {timeAgo(item.createdAt)}
                      </p>
                    </div>
                  </div>
                );
                return item.link.startsWith("/") ? (
                  <Link
                    key={item.id}
                    href={item.link}
                    onClick={() => setOpen(false)}
                    className="block"
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={item.id}>{content}</div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function UserMenu({ name, email, plan }: { name: string; email: string; plan: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full p-1 hover:bg-muted"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <Avatar label={initials(name)} />
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            <p className="mt-1 text-xs capitalize text-primary">{plan} plan</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm hover:bg-muted"
          >
            Settings
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger hover:bg-muted"
            onClick={async () => {
              await authClient.signOut();
              router.replace("/sign-in");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
