// @vitest-environment jsdom
import type { SessionEvent } from "@fitpilot/exercise-contracts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveCoachProps, SetOutbox } from "../live-coaching/LiveCoach";

const captured = vi.hoisted(() => ({ port: undefined as SetOutbox | undefined }));
vi.mock("../live-coaching/LiveCoach", () => ({
  LiveCoach: (props: LiveCoachProps) => {
    captured.port = props.outbox;
    return null;
  },
}));
vi.mock("./actions", () => ({ setTrackingConsent: vi.fn(), sendEvents: vi.fn() }));
const outboxes = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./outbox/browser", () => ({ getOutbox: () => outboxes.current }));

const { LiveSessionCoach } = await import("./LiveSessionCoach");
const exercise = { id: "bodyweight_squat", name: "Squat", required_landmarks: [] as const };
const manual = {
  type: "set_logged",
  session_id: "s",
  exercise_id: "bodyweight_squat",
  occurred_at: "2026-01-01T00:00:00.000Z",
  idempotency_key: "k-0000000001",
  set_index: 0,
  reps: 5,
} as SessionEvent;
const fake = () => ({
  enqueue: vi.fn(async () => {}),
  holdWhile: vi.fn(),
  idle: vi.fn(async () => {}),
  flush: vi.fn(async () => "sent"),
});

afterEach(cleanup);

describe("LiveSessionCoach outbox port", () => {
  it("resolves the member's outbox at call time, so a replaced outbox is never written to after it is disposed", async () => {
    const first = fake();
    outboxes.current = first;
    render(<LiveSessionCoach exercise={exercise} sessionId="s" userId="u" />);
    const port = captured.port!;

    const second = fake(); // e.g. resumeOutbox swapped the memory-only outbox for the real one
    outboxes.current = second;
    port.enqueue([manual], true);
    port.holdWhile(true);
    await port.idle();
    await port.flush("s");

    expect(first.enqueue).not.toHaveBeenCalled();
    expect(first.holdWhile).not.toHaveBeenCalled();
    expect(second.enqueue).toHaveBeenCalledTimes(1);
    expect(second.holdWhile).toHaveBeenCalledWith(true);
    expect(second.flush).toHaveBeenCalledWith("s");
  });
});
