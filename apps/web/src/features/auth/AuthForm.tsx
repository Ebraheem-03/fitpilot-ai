"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "./safe-next";

type Mode = "sign-in" | "sign-up";

const COPY: Record<
  Mode,
  { title: string; submit: string; switchText: string; switchHref: string; switchLabel: string }
> = {
  "sign-in": {
    title: "Sign in",
    submit: "Sign in",
    switchText: "New to FitPilot?",
    switchHref: "/sign-up",
    switchLabel: "Create an account",
  },
  "sign-up": {
    title: "Create your account",
    submit: "Create account",
    switchText: "Already have an account?",
    switchHref: "/sign-in",
    switchLabel: "Sign in",
  },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } =
      mode === "sign-up"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
    if (error) {
      setPending(false);
      setError(error.message);
      return;
    }
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    router.replace(next);
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending}>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={mode === "sign-up" ? 8 : undefined}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            aria-describedby={mode === "sign-up" ? "password-hint" : undefined}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
          {mode === "sign-up" && (
            <span id="password-hint" className="text-xs font-normal text-zinc-500">
              At least 8 characters.
            </span>
          )}
        </label>
        {error && (
          <p
            role="alert"
            data-testid="auth-error"
            className="text-sm text-red-700 dark:text-red-400"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          {pending ? "Please wait…" : copy.submit}
        </button>
      </form>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {copy.switchText}{" "}
        <Link href={copy.switchHref} className="font-medium underline">
          {copy.switchLabel}
        </Link>
      </p>
    </main>
  );
}
