import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/shell";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/server/session";

/**
 * Support pages work signed in or out: someone locked out of their account can still write to us.
 * Signed in they sit inside the app; signed out they get a plain header.
 */
export default async function SupportLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user) return <AppShell user={user}>{children}</AppShell>;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-6">
        <Logo />
        <Link href="/sign-in" className={buttonVariants({ variant: "secondary" })}>
          Sign in
        </Link>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
