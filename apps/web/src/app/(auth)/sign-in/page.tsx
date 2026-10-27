import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/AuthForm";

export const metadata: Metadata = { title: "Sign in · FitPilot AI" };

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
