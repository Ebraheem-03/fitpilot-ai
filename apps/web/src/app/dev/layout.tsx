import { notFound } from "next/navigation";

/**
 * Developer tools (pose benchmark, fixture capture). Not part of the product: production builds
 * 404 unless explicitly enabled for an on-device measurement run.
 */
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_DEV_TOOLS !== "1") {
    notFound();
  }
  return <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">{children}</main>;
}
