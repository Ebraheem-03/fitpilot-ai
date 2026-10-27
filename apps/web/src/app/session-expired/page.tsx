import type { Metadata } from "next";
import { SignOutButton } from "@/features/auth/SignOutButton";

export const metadata: Metadata = { title: "Session expired · FitPilot AI" };

// Neutral page (neither /app nor an auth page) so the proxy never redirects away from it.
export default function SessionExpiredPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Please sign in again</h1>
      <p className="text-muted">
        We couldn&apos;t verify your session with FitPilot. Signing out and back in usually fixes
        this.
      </p>
      <SignOutButton />
    </main>
  );
}
