"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";

function GoogleButton({ callbackURL }: { callbackURL: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          await authClient.signIn.social({ provider: "google", callbackURL });
          setLoading(false);
        }}
      >
        Continue with Google
      </Button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

export function SignInForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (signInError) {
      setLoading(false);
      setError(
        signInError.status === 403
          ? "Please verify your email address first — we've sent you a link."
          : signInError.status === 429
            ? "Too many attempts. Please wait a minute and try again."
            : "That email and password don't match. Please try again.",
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to continue your search.</p>
      <div className="mt-6">
        {googleEnabled ? <GoogleButton callbackURL={next} /> : null}
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" className="w-full" loading={loading}>
            Sign in
          </Button>
        </form>
        <div className="mt-5 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
          <Link
            href={`/sign-up${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-medium text-primary"
          >
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: signUpError } = await authClient.signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password,
      callbackURL: "/onboarding",
    });
    setLoading(false);
    if (signUpError) {
      setError(
        signUpError.status === 429
          ? "Too many sign-ups from this network. Please try again later."
          : (signUpError.message ?? "We couldn't create your account. Please try again."),
      );
      return;
    }
    if (!data?.token) {
      setCheckEmail(true);
      return;
    }
    router.replace("/onboarding");
    router.refresh();
  }

  if (checkEmail) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent you a link to verify your email. Open it to finish setting up GetTargetRole.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Start free. It takes about two minutes to set up.
      </p>
      <div className="mt-6">
        {googleEnabled ? <GoogleButton callbackURL="/onboarding" /> : null}
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Full name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required maxLength={100} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters.">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" className="w-full" loading={loading}>
            Create account
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });
    setLoading(false);
    // Same message whether or not the account exists, so emails can't be enumerated.
    setSent(true);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {sent ? (
        <p className="mt-3 text-sm text-muted-foreground">
          If an account exists for that email, we&apos;ve sent a reset link. It expires in one hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm">
        <Link href="/sign-in" className="text-primary">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    setLoading(true);
    const { error: resetError } = await authClient.resetPassword({
      newPassword,
      token: token ?? "",
    });
    setLoading(false);
    if (resetError) {
      setError("This reset link is invalid or has expired. Please request a new one.");
      return;
    }
    router.replace("/sign-in");
  }

  if (!token) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Link expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This reset link is invalid. Please request a new one.
        </p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-primary">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="New password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" className="w-full" loading={loading}>
          Update password
        </Button>
      </form>
    </div>
  );
}
