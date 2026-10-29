// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateState } from "./generate-state";

const action = vi.fn<(prev: GenerateState, form: FormData) => Promise<GenerateState>>();
vi.mock("./actions", () => ({
  generatePlanAction: (prev: GenerateState, form: FormData) => action(prev, form),
}));

const { GenerateButton } = await import("./GenerateButton");

const keyOf = (call: number) => action.mock.calls[call]![1].get("idempotency_key");

beforeEach(() => {
  action.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GenerateButton", () => {
  it("offers Generate first and Regenerate once a plan exists", () => {
    const { rerender } = render(<GenerateButton hasPlan={false} />);
    expect(screen.getByRole("button", { name: "Generate my plan" })).toBeTruthy();
    rerender(<GenerateButton hasPlan />);
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeTruthy();
  });

  it("disables the button and says the coach is working while pending", async () => {
    let finish!: (s: GenerateState) => void;
    action.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<GenerateButton hasPlan={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate my plan" }));
    const busy = await screen.findByRole("button", { name: "Building your plan…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("working on it");
    await act(async () => finish({ status: "idle" }));
    expect(screen.getByRole("button", { name: "Generate my plan" })).toBeTruthy();
  });

  it("confirms a new plan", async () => {
    action.mockResolvedValue({
      status: "done",
      planStatus: "active",
      planId: "p1",
      version: 3,
      replayed: false,
    });
    render(<GenerateButton hasPlan />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    expect((await screen.findByTestId("generate-done")).textContent).toContain("version 3");
  });

  it("says a trainer needs to check a plan that failed validation, and links to why", async () => {
    action.mockResolvedValue({
      status: "done",
      planStatus: "needs_review",
      planId: "abc",
      version: 2,
      replayed: false,
    });
    render(<GenerateButton hasPlan />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    const note = await screen.findByTestId("generate-needs-review");
    expect(note.textContent).toContain("trainer to check");
    expect(screen.getByRole("link", { name: "See why" }).getAttribute("href")).toBe(
      "/app/plan/abc",
    );
  });

  it("coach_busy: shows the wait, disables the button, and re-enables it after the countdown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    action.mockResolvedValue({ status: "error", code: "coach_busy", retryAfterS: 3 });
    render(<GenerateButton hasPlan={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate my plan" }));
    expect((await screen.findByTestId("generate-error-coach_busy")).textContent).toContain(
      "The coach is busy, try again in 3 s.",
    );
    const waiting = screen.getByRole("button", { name: /available in 3 s/ });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(3100));
    const ready = screen.getByRole("button", { name: "Generate my plan" });
    expect((ready as HTMLButtonElement).disabled).toBe(false);
  });

  it("ai_unavailable: says so, offers no plan, and the button stays usable", async () => {
    action.mockResolvedValue({ status: "error", code: "ai_unavailable", retryAfterS: null });
    render(<GenerateButton hasPlan={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate my plan" }));
    expect((await screen.findByTestId("generate-error-ai_unavailable")).textContent).toContain(
      "isn't available right now",
    );
    expect(screen.queryByTestId("generate-done")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Generate my plan" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("profile_required: links to onboarding", async () => {
    action.mockResolvedValue({ status: "error", code: "profile_required", retryAfterS: null });
    render(<GenerateButton hasPlan={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate my plan" }));
    const link = await screen.findByRole("link", { name: "Set up your profile" });
    expect(link.getAttribute("href")).toBe("/app/onboarding");
  });

  it("keeps one idempotency key across failed retries and uses a new one after a plan was returned", async () => {
    action
      .mockResolvedValueOnce({ status: "error", code: "unknown", retryAfterS: null })
      .mockResolvedValueOnce({
        status: "done",
        planStatus: "active",
        planId: "p1",
        version: 1,
        replayed: false,
      })
      .mockResolvedValueOnce({
        status: "done",
        planStatus: "active",
        planId: "p2",
        version: 2,
        replayed: false,
      });
    render(<GenerateButton hasPlan={false} />);
    const click = () => userEvent.click(screen.getByRole("button", { name: /plan/i }));
    await click();
    await screen.findByTestId("generate-error-unknown");
    await click();
    await screen.findByTestId("generate-done");
    await click();
    await screen.findByText(/version 2/);

    const [first, second, third] = [keyOf(0), keyOf(1), keyOf(2)];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first); // retry of the same intent replays instead of duplicating
    expect(third).not.toBe(second); // a deliberate regeneration gets its own key
  });
});
