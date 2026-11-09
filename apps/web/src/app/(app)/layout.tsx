import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/shell";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
