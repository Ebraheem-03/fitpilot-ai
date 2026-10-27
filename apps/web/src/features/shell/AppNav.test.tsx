// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/api-types";
import { AppNav } from "./AppNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/profile" }));

afterEach(cleanup);

function links(role: Role) {
  render(<AppNav role={role} />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  return within(nav)
    .getAllByRole("link")
    .map((a) => a.textContent);
}

describe("AppNav", () => {
  it.each<[Role, string[]]>([
    ["member", ["Home", "Profile"]],
    ["trainer", ["Home", "Profile", "My members"]],
    ["gym_admin", ["Home", "Profile", "My members", "Gym admin"]],
    ["platform_admin", ["Home", "Profile", "My members", "Gym admin"]],
  ])("%s sees %j", (role, expected) => {
    expect(links(role)).toEqual(expected);
  });

  it("marks the current page for assistive tech", () => {
    render(<AppNav role="member" />);
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });
});
