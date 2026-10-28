import { Matrix4, Quaternion, Vector3 } from "three";
import { BONES, type BoneName, boneDef } from "./skeleton.ts";

/** Local bone rotations (identity when absent) plus the hips translation in root space. */
export interface Pose {
  rotations: Partial<Record<BoneName, Quaternion>>;
  hips: Vector3;
}

export interface WorldPose {
  position: Record<BoneName, Vector3>;
  rotation: Record<BoneName, Quaternion>;
}

/** Forward kinematics: world position + rotation of every bone origin. */
export function forwardKinematics(pose: Pose): WorldPose {
  const position = {} as Record<BoneName, Vector3>;
  const rotation = {} as Record<BoneName, Quaternion>;
  for (const def of BONES) {
    const local = pose.rotations[def.name] ?? new Quaternion();
    const offset = def.name === "hips" ? pose.hips.clone() : new Vector3(...def.offset);
    if (!def.parent) {
      position[def.name] = offset;
      rotation[def.name] = local.clone();
      continue;
    }
    const parentRot = rotation[def.parent];
    position[def.name] = offset.applyQuaternion(parentRot).add(position[def.parent]);
    rotation[def.name] = parentRot.clone().multiply(local);
  }
  return { position, rotation };
}

/** Local rotation that gives `world` under a parent whose world rotation is `parentWorld`. */
export function toLocal(parentWorld: Quaternion, world: Quaternion): Quaternion {
  return parentWorld.clone().invert().multiply(world);
}

/**
 * World rotation of a limb bone whose rest frame is identity, whose child sits along its -Y,
 * pointing from `from` to `to`, with its +Z axis turned as close to `forward` as possible.
 */
export function limbRotation(from: Vector3, to: Vector3, forward: Vector3): Quaternion {
  const y = from.clone().sub(to).normalize();
  const z = forward
    .clone()
    .sub(y.clone().multiplyScalar(forward.dot(y)))
    .normalize();
  const x = y.clone().cross(z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/**
 * Analytic two-bone IK. Returns the middle joint (knee/elbow) for a chain of lengths `a`, `b`
 * from `root` towards `target`, bending towards `pole`. The target is pulled in when it is
 * out of reach, so the chain never stretches.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  a: number,
  b: number,
  pole: Vector3,
): { joint: Vector3; end: Vector3 } {
  const toTarget = target.clone().sub(root);
  const d = Math.min(toTarget.length(), a + b - 1e-4);
  const dir = toTarget.normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(a * a - along * along, 0));
  const bend = pole
    .clone()
    .sub(dir.clone().multiplyScalar(pole.dot(dir)))
    .normalize();
  const joint = root
    .clone()
    .add(dir.clone().multiplyScalar(along))
    .add(bend.multiplyScalar(height));
  const end = root.clone().add(dir.multiplyScalar(d));
  return { joint, end };
}

export const restLength = (bone: BoneName): number => new Vector3(...boneDef(bone).offset).length();
