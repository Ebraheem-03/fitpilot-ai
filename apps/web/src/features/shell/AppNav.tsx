"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/api-types";
import { navFor } from "./nav";

export function AppNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="-mx-1 -my-1 flex gap-0.5 overflow-x-auto px-1 py-1 sm:flex-wrap sm:gap-1 sm:overflow-visible">
        {navFor(role).map(({ href, label }) => {
          const current = pathname === href || (href !== "/app" && pathname.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`block rounded-md px-2 py-1.5 text-sm font-medium whitespace-nowrap sm:px-3 ${
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
