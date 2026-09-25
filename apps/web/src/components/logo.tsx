import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      {/* A target with an arrow in the bullseye; keep in sync with app/icon.svg. */}
      <path
        d="M20.63 16.18A7.5 7.5 0 1 1 15.82 11.37"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M13.5 18.5 24 8M21 8.6V11h2.4M24 5.6V8h2.4"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="13.5" cy="18.5" r="2.3" fill="white" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}
    >
      <LogoMark />
      <span className="text-lg">GetTargetRole</span>
    </Link>
  );
}
