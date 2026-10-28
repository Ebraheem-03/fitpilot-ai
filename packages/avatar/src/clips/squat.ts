import { Quaternion, Vector3 } from "three";
import { forwardKinematics, limbRotation, type Pose, solveTwoBone, toLocal } from "../pose";
import { ANKLE_HEIGHT, SEGMENT_LENGTHS } from "../skeleton";
import type { MotionDefinition } from "./types";

const deg = (d: number) => (d * Math.PI) / 180;
const aboutX = (rad: number) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rad);
const aboutY = (rad: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad);

/**
 * Bodyweight squat, authored as a function of depth s ∈ [0, 1] (0 standing, 1 thighs about
 * parallel). The feet are IK targets fixed on the floor, so they cannot slide or clip by
 * construction; the hips sit back while the trunk hinges forward and the arms reach forward
 * to keep the centre of mass over the mid-foot.
 */
export const SQUAT_PARAMS = {
  stanceHalfWidth: 0.14,
  toeOut: deg(12),
  standingHipHeight: 0.945,
  hipDrop: 0.45,
  hipBack: 0.2,
  pelvisTilt: deg(18),
  spineFlex: deg(10),
  chestFlex: deg(8),
  neckExtend: deg(-12),
  headExtend: deg(-10),
  armRaise: deg(85),
  elbowBend: deg(12),
} as const;

export function squatPose(s: number): Pose {
  const p = SQUAT_PARAMS;
  const hips = new Vector3(0, p.standingHipHeight - p.hipDrop * s, -p.hipBack * s);
  const rotations: Pose["rotations"] = {
    hips: aboutX(p.pelvisTilt * s),
    spine: aboutX(p.spineFlex * s),
    chest: aboutX(p.chestFlex * s),
    neck: aboutX(p.neckExtend * s),
    head: aboutX(p.headExtend * s),
  };
  const trunk = forwardKinematics({ rotations, hips });

  for (const side of ["l", "r"] as const) {
    const x = side === "l" ? 1 : -1;
    // Legs: ankle pinned on the floor, knee tracks over the toes.
    const yaw = aboutY(p.toeOut * x);
    const toes = new Vector3(0, 0, 1).applyQuaternion(yaw);
    const hip = trunk.position[`thigh_${side}`];
    const ankle = new Vector3(p.stanceHalfWidth * x, ANKLE_HEIGHT, 0);
    const { joint: knee, end } = solveTwoBone(
      hip,
      ankle,
      SEGMENT_LENGTHS.thigh,
      SEGMENT_LENGTHS.shin,
      toes,
    );
    const thighWorld = limbRotation(hip, knee, toes);
    const shinWorld = limbRotation(knee, end, toes);
    rotations[`thigh_${side}`] = toLocal(trunk.rotation.hips, thighWorld);
    rotations[`shin_${side}`] = toLocal(thighWorld, shinWorld);
    rotations[`foot_${side}`] = toLocal(shinWorld, yaw);

    // Arms: raised forward in world space as a counterbalance, regardless of trunk lean.
    const armWorld = aboutX(-p.armRaise * s);
    rotations[`upper_arm_${side}`] = toLocal(trunk.rotation.chest, armWorld);
    rotations[`forearm_${side}`] = aboutX(-p.elbowBend * s);
  }
  return { rotations, hips };
}

/** Depth per phase; timings come from the catalogue's `animation.phases` (principle 2). */
export const SQUAT_MOTION: MotionDefinition = {
  pose: squatPose,
  phaseDepth: {
    standing: [0, 0],
    descending: [0, 1],
    bottom: [1, 1],
    ascending: [1, 0],
  },
};
