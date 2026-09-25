import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo className="mb-10" />
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        It may have been removed, or you may not have access to it.
      </p>
      <Link href="/dashboard" className={`${buttonVariants()} mt-6`}>
        Go to dashboard
      </Link>
    </div>
  );
}
