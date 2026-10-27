"use client";

// SPIKE (S0, #6): throwaway sign-up / sign-in page. Not for merge.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SpikeAuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(mode: "sign-up" | "sign-in") {
    setError(null);
    const supabase = createClient();
    const { error } =
      mode === "sign-up"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    if (error) return setError(error.message);
    router.push("/spike/me");
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-3 p-8">
      <h1 className="text-xl font-semibold">Auth spike</h1>
      <label className="flex flex-col gap-1">
        Email
        <input
          className="rounded border p-2"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        Password
        <input
          className="rounded border p-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button className="rounded border px-3 py-2" onClick={() => submit("sign-up")}>
          Sign up
        </button>
        <button className="rounded border px-3 py-2" onClick={() => submit("sign-in")}>
          Sign in
        </button>
      </div>
      {error && (
        <p role="alert" data-testid="auth-error">
          {error}
        </p>
      )}
    </main>
  );
}
