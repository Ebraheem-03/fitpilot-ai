import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/AuthForm";

export const metadata: Metadata = { title: "Create account · FitPilot AI" };

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
