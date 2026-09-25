import type { Metadata } from "next";
import { ResetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;
  const value = typeof token === "string" && !error ? token : null;
  return <ResetPasswordForm token={value} />;
}
