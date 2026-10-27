"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/api-types";
import { navFor } from "./nav";

export function AppNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="flex flex-wrap gap-1">
        {navFor(role).map(({ href, label }) => {
          const current = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  current ? "bg-surface text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
