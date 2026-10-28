import { describe, expect, it } from "vitest";
import { ExerciseContract } from "../src";

const valid = (): Record<string, any> => ({
  id: "demo_squat",
  name: "Demo Squat",
  version: 1,
  equipment: [],
  prescription: "reps",
  camera_views: ["side"],
  animation: {
    asset: "squat.glb",
    clip: "squat",
    duration_s: 4,
    phases: [
      { phase: "standing", start_s: 0, end_s: 0.5, instruction_indices: [0] },
      { phase: "descending", start_s: 0.5, end_s: 2, instruction_indices: [1] },
      { phase: "bottom", start_s: 2, end_s: 2.4, instruction_indices: [] },
      { phase: "ascending", start_s: 2.4, end_s: 3.6, instruction_indices: [1] },
      { phase: "standing", start_s: 3.6, end_s: 4, instruction_indices: [0] },
    ],
  },
  supported_capabilities: ["demo_3d", "rep_counting"],
  required_landmarks: ["left_hip"],
  ruleset_version: 1,
  phases: ["standing", "descending", "bottom", "ascending"],
  instructions: ["Stand tall.", "Sit back."],
});

type Exercise = Record<string, any>;
const issues = (mutate: (e: Exercise) => void) => {
  const e = valid();
  mutate(e);
  const result = ExerciseContract.safeParse(e);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("ExerciseContract animation timeline (FR-03)", () => {
  it("accepts a contiguous timeline that covers the clip", () => {
    expect(issues(() => {})).toEqual([]);
  });

  it("rejects a timeline that does not start at 0", () => {
    expect(
      issues((e) => {
        e.animation.phases[0]!.start_s = 0.1;
      }),
    ).toContain("animation.phases must start at 0");
  });

  it("rejects gaps and overlaps between phases", () => {
    expect(
      issues((e) => {
        e.animation.phases[1]!.start_s = 0.6;
      }),
    ).toContain("animation.phases[1] must start where phases[0] ends");
    expect(
      issues((e) => {
        e.animation.phases[1]!.start_s = 0.4;
      }),
    ).toContain("animation.phases[1] must start where phases[0] ends");
  });

  it("rejects a timeline that does not end at duration_s", () => {
    expect(
      issues((e) => {
        e.animation.duration_s = 5;
      }),
    ).toContain("animation.phases must end at duration_s");
  });

  it("rejects empty or reversed phase spans", () => {
    expect(
      issues((e) => {
        e.animation.phases[2]!.end_s = 2;
        e.animation.phases[3]!.start_s = 2;
      }),
    ).toContain("animation.phases[2] must have end_s > start_s");
  });

  it("rejects phases that are not in the exercise's phase list", () => {
    expect(
      issues((e) => {
        e.animation.phases[2]!.phase = "hold";
      }),
    ).toContain('animation.phases[2].phase "hold" is not in phases');
  });

  it("requires every listed phase to appear in the timeline", () => {
    expect(
      issues((e) => {
        e.phases.push("lockout");
      }),
    ).toContain('phase "lockout" never appears in animation.phases');
  });

  it("rejects instruction indices out of range", () => {
    expect(
      issues((e) => {
        e.animation.phases[2]!.instruction_indices = [2];
      }),
    ).toContain("animation.phases[2].instruction_indices[0] is out of range");
  });

  it("only accepts a bare .glb file name as the asset (served from /exercises/<id>/)", () => {
    for (const asset of ["../secret.glb", "a/b.glb", "squat.gltf", "https://x.io/s.glb"]) {
      expect(
        issues((e) => {
          e.animation.asset = asset;
        }).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("ExerciseContract optional demo and tracking", () => {
  it("accepts an untracked exercise with no demo", () => {
    expect(
      issues((e) => {
        e.animation = null;
        e.supported_capabilities = [];
        e.camera_views = [];
        e.required_landmarks = [];
        e.ruleset_version = null;
      }),
    ).toEqual([]);
  });

  it("defaults the optional fields when they are absent", () => {
    const {
      animation,
      supported_capabilities,
      camera_views,
      required_landmarks,
      ruleset_version,
      ...rest
    } = valid();
    (void animation, supported_capabilities, camera_views, required_landmarks, ruleset_version);
    const parsed = ExerciseContract.parse(rest);
    expect(parsed.animation).toBeNull();
    expect(parsed.supported_capabilities).toEqual([]);
    expect(parsed.ruleset_version).toBeNull();
  });

  it("requires animation when demo_3d is supported", () => {
    expect(
      issues((e) => {
        e.animation = null;
      }),
    ).toContain("animation is required when demo_3d is supported");
  });

  it("rejects an animation without the demo_3d capability", () => {
    expect(
      issues((e) => {
        e.supported_capabilities = ["rep_counting"];
      }),
    ).toContain("animation requires the demo_3d capability");
  });

  it.each(["camera_views", "required_landmarks", "ruleset_version"] as const)(
    "requires %s for a tracked exercise",
    (field) => {
      expect(
        issues((e) => {
          e[field] = field === "ruleset_version" ? null : [];
        }),
      ).toContain(`${field} is required for a tracked exercise`);
    },
  );

  it("does not demand tracking fields for a demo-only exercise", () => {
    expect(
      issues((e) => {
        e.supported_capabilities = ["demo_3d"];
        e.camera_views = [];
        e.required_landmarks = [];
        e.ruleset_version = null;
      }),
    ).toEqual([]);
  });

  it("only accepts equipment the member profile can express", () => {
    expect(issues((e) => void (e.equipment = ["dumbbells", "mat"]))).toEqual([]);
    expect(issues((e) => void (e.equipment = ["rowing_machine"]))).not.toEqual([]);
  });

  it("requires a prescription of reps or duration", () => {
    expect(issues((e) => void (e.prescription = "duration"))).toEqual([]);
    expect(issues((e) => void (e.prescription = "sets"))).not.toEqual([]);
    expect(issues((e) => void delete e.prescription)).not.toEqual([]);
  });
});
