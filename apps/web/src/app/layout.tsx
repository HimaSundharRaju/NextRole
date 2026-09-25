import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GetTargetRole — find, tailor and land your next role",
    template: "%s · GetTargetRole",
  },
  description:
    "GetTargetRole finds jobs the moment they go live, writes polished resumes tailored to each role, and tracks every application.",
  applicationName: "GetTargetRole",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d14" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request so it can carry the CSP nonce set in proxy.ts.
  await connection();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
