import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getMe } from "@/lib/api";
import type { Role } from "@/lib/api-types";

/** Role-gated page stub until M5 builds trainer/admin tools. The API enforces real access. */
export async function RolePlaceholder({ allowed, title }: { allowed: Role[]; title: string }) {
  await connection();
  const me = await getMe();
  if (!allowed.includes(me.role)) notFound();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted">Coming in milestone M5 (gym operations).</p>
    </div>
  );
}
