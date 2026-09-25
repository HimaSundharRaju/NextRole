import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { SignUpForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <SignUpForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />;
}
