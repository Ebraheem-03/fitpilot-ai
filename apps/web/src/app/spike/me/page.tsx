// SPIKE (S0, #6): server component calls FastAPI with the user's access token. Not for merge.
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

async function WhoAmI() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/spike");
  // getClaims verified identity above; getSession only supplies the raw token to forward.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/spike/whoami`, {
    headers: { Authorization: `Bearer ${session?.access_token}` },
    cache: "no-store",
  });
  const body: unknown = await res.json();

  return (
    <pre data-testid="whoami" className="rounded border p-4 text-sm">
      {JSON.stringify({ status: res.status, sub_matches: claims.claims.sub, body }, null, 2)}
    </pre>
  );
}

export default function SpikeMePage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-4 text-xl font-semibold">API whoami</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <WhoAmI />
      </Suspense>
    </main>
  );
}
