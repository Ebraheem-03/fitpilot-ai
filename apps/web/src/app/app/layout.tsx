import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { AppNav } from "@/features/shell/AppNav";
import { ApiError, getMe } from "@/lib/api";

async function RoleNav() {
  await connection();
  const me = await getMe().catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) redirect("/sign-in");
    throw e;
  });
  return <AppNav role={me.role} />;
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      <a
        href="#content"
        className="sr-only rounded-md bg-brand px-3 py-2 text-brand-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/app" className="font-semibold tracking-tight text-brand">
            FitPilot
          </Link>
          <div className="flex-1">
            <Suspense fallback={<div className="h-8" aria-hidden />}>
              <RoleNav />
            </Suspense>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        {children}
      </main>
    </>
  );
}
