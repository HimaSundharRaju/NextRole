import type { ReactNode } from "react";
import { MobileNav, Sidebar } from "@/components/app-shell/nav";
import { NotificationsBell, UserMenu } from "@/components/app-shell/header-widgets";
import { unreadNotificationCount } from "@/server/data/notifications";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const unread = await unreadNotificationCount(user.id);

  return (
    <div className="flex min-h-dvh">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <MobileNav role={user.role} />
          <div className="ml-auto flex items-center gap-2">
            <NotificationsBell unread={unread} />
            <UserMenu name={user.name} email={user.email} plan={user.plan} />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
