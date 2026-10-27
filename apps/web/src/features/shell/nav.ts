import type { Role } from "@/lib/api-types";

export type NavItem = { href: string; label: string };

const MEMBER: NavItem[] = [
  { href: "/app", label: "Home" },
  { href: "/app/profile", label: "Profile" },
];
const TRAINER: NavItem = { href: "/app/trainer", label: "My members" };
const GYM_ADMIN: NavItem = { href: "/app/admin", label: "Gym admin" };

/** Navigation shown per role (blueprint §2). Cosmetic only: the API enforces access. */
export function navFor(role: Role): NavItem[] {
  switch (role) {
    case "member":
      return MEMBER;
    case "trainer":
      return [...MEMBER, TRAINER];
    case "gym_admin":
    case "platform_admin":
      return [...MEMBER, TRAINER, GYM_ADMIN];
  }
}
