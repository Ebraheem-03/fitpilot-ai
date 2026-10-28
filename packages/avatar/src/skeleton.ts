/**
 * Mannequin skeleton (metres, glTF Y-up, character faces +Z so its left side is +X).
 * Every bone's rest rotation is identity, so rest world positions are cumulative offsets and
 * the bind pose is this table. Joint origins line up with the MediaPipe landmarks of the same
 * body part (thigh_l origin = left_hip, shin_l = left_knee, foot_l = left_ankle, …) so M2 can
 * compare tracked and demonstrated joints.
 */
export type BoneName =
  | "root"
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | `${"upper_arm" | "forearm" | "hand" | "thigh" | "shin" | "foot"}_${"l" | "r"}`;

export type Vec3 = readonly [number, number, number];

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  offset: Vec3;
}

export const SEGMENT_LENGTHS = {
  upperArm: 0.29,
  forearm: 0.26,
  thigh: 0.42,
  shin: 0.4,
} as const;

/** Ankle joint height above the floor; the foot mesh bottom sits exactly on y = 0. */
export const ANKLE_HEIGHT = 0.08;

const side = (s: "l" | "r"): BoneDef[] => {
  const x = s === "l" ? 1 : -1;
  return [
    { name: `upper_arm_${s}`, parent: "chest", offset: [0.19 * x, 0.19, 0] },
    { name: `forearm_${s}`, parent: `upper_arm_${s}`, offset: [0, -SEGMENT_LENGTHS.upperArm, 0] },
    { name: `hand_${s}`, parent: `forearm_${s}`, offset: [0, -SEGMENT_LENGTHS.forearm, 0] },
    { name: `thigh_${s}`, parent: "hips", offset: [0.095 * x, -0.05, 0] },
    { name: `shin_${s}`, parent: `thigh_${s}`, offset: [0, -SEGMENT_LENGTHS.thigh, 0] },
    { name: `foot_${s}`, parent: `shin_${s}`, offset: [0, -SEGMENT_LENGTHS.shin, 0] },
  ];
};

/** Parents always precede children. */
export const BONES: readonly BoneDef[] = [
  { name: "root", parent: null, offset: [0, 0, 0] },
  { name: "hips", parent: "root", offset: [0, 0.95, 0] },
  { name: "spine", parent: "hips", offset: [0, 0.1, 0] },
  { name: "chest", parent: "spine", offset: [0, 0.2, 0] },
  { name: "neck", parent: "chest", offset: [0, 0.21, 0] },
  { name: "head", parent: "neck", offset: [0, 0.09, 0] },
  ...side("l"),
  ...side("r"),
];

export function boneDef(name: BoneName): BoneDef {
  const def = BONES.find((b) => b.name === name);
  if (!def) throw new Error(`unknown bone ${name}`);
  return def;
}

/** Rest-pose world position of a bone's origin. */
export function restWorldPosition(name: BoneName): [number, number, number] {
  const p: [number, number, number] = [0, 0, 0];
  for (let def: BoneDef | null = boneDef(name); def;) {
    p[0] += def.offset[0];
    p[1] += def.offset[1];
    p[2] += def.offset[2];
    def = def.parent ? boneDef(def.parent) : null;
  }
  return p;
}
