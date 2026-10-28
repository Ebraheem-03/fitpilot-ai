// @vitest-environment jsdom
import { ExerciseContract } from "@fitpilot/exercise-contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExerciseCard } from "./ExerciseCard";
import { canTrackLive, ExerciseGuide } from "./ExerciseGuide";

// The real viewer needs WebGL; these tests are about what the page decides to show.
vi.mock("../exercise-viewer/ExerciseDemo", () => ({
  ExerciseDemo: ({ exercise }: { exercise: { name: string } }) => (
    <div data-testid="exercise-viewer">3D viewer for {exercise.name}</div>
  ),
}));

const catalogDir = join(process.cwd(), "../../data/exercise-catalog");
const catalogue = readdirSync(catalogDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ExerciseContract.parse(JSON.parse(readFileSync(join(catalogDir, f), "utf8"))));
const byId = (id: string) => catalogue.find((e) => e.id === id)!;

afterEach(cleanup);

describe("ExerciseGuide", () => {
  it("shows the 3D viewer and the camera link for the squat", () => {
    render(<ExerciseGuide exercise={byId("bodyweight_squat")} />);
    expect(screen.getByTestId("exercise-viewer")).toBeTruthy();
    expect(screen.queryByTestId("no-demo")).toBeNull();
    expect(screen.getByRole("link", { name: /camera/i }).getAttribute("href")).toBe(
      "/app/exercises/bodyweight_squat/live",
    );
  });

  it.each(["push_up", "plank", "dumbbell_biceps_curl", "glute_bridge", "reverse_lunge"])(
    "%s: says there is no 3D demo, lists the written steps and offers no camera link",
    (id) => {
      const exercise = byId(id);
      render(<ExerciseGuide exercise={exercise} />);
      expect(screen.getByTestId("no-demo").textContent).toContain("No 3D demo yet");
      expect(screen.queryByTestId("exercise-viewer")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
      const steps = screen.getByTestId("exercise-steps").querySelectorAll("li");
      expect(steps).toHaveLength(exercise.instructions.length);
    },
  );

  it("never offers the camera for an exercise the catalogue does not track, even with an analyzer id", () => {
    expect(canTrackLive({ id: "bodyweight_squat", supported_capabilities: ["demo_3d"] })).toBe(
      false,
    );
    expect(canTrackLive(byId("bodyweight_squat"))).toBe(true);
    expect(canTrackLive(byId("push_up"))).toBe(false);
  });
});

describe("ExerciseCard", () => {
  it("tags the squat as demo + camera tracking", () => {
    render(<ExerciseCard exercise={byId("bodyweight_squat")} />);
    const tags = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(tags).toEqual(["Counted in reps", "3D demo", "Camera tracking"]);
  });

  it("is honest about an exercise with no demo and no tracking", () => {
    render(<ExerciseCard exercise={byId("plank")} />);
    const tags = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(tags).toEqual(["Held for time", "No 3D demo yet"]);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/app/exercises/plank");
    expect(screen.getByText(/None \(bodyweight\)/)).toBeTruthy();
  });

  it("lists the equipment a dumbbell exercise needs", () => {
    render(<ExerciseCard exercise={byId("dumbbell_row")} />);
    expect(screen.getByText(/Equipment: Dumbbells/)).toBeTruthy();
  });
});
