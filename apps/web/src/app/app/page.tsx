// Placeholder signed-in landing; S7 (#13) replaces it with the role-aware app shell.
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { createClient } from "@/lib/supabase/server";

async function Session() {
  await connection(); // per-request: reads the session cookie
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/sign-in");
  return (
    <div className="flex items-center justify-between gap-4">
      <p>You are signed in.</p>
      <SignOutButton />
    </div>
  );
}

export default function AppHome() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">FitPilot</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Session />
      </Suspense>
    </main>
  );
}
