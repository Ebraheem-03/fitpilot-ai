import {
  type BufferGeometry,
  CapsuleGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { BONES, type BoneName, restWorldPosition } from "./skeleton";

/**
 * Rigid-skinned mannequin: every part follows exactly one bone (weight 1), and spheres at
 * the joints hide the seams. No soft skin weights means no candy-wrapper artefacts and a
 * mesh that is fully described by this file.
 */
export type MaterialName = "body" | "joint" | "visor";

interface Part {
  bone: BoneName;
  material: MaterialName;
  geometry: BufferGeometry;
}

const at = (bone: BoneName, dx = 0, dy = 0, dz = 0) => {
  const [x, y, z] = restWorldPosition(bone);
  return new Vector3(x + dx, y + dy, z + dz);
};

function ellipsoid(center: Vector3, radii: Vector3): BufferGeometry {
  return new SphereGeometry(1, 24, 16).applyMatrix4(
    new Matrix4().compose(center, new Quaternion(), radii),
  );
}

function capsule(from: Vector3, to: Vector3, radius: number): BufferGeometry {
  const axis = to.clone().sub(from);
  const length = Math.max(axis.length() - 2 * radius, 0.001);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize());
  const mid = from.clone().add(to).multiplyScalar(0.5);
  return new CapsuleGeometry(radius, length, 6, 16).applyMatrix4(
    new Matrix4().compose(mid, rotation, new Vector3(1, 1, 1)),
  );
}

function parts(): Part[] {
  const list: Part[] = [
    {
      bone: "hips",
      material: "body",
      geometry: ellipsoid(at("hips", 0, -0.03), new Vector3(0.16, 0.1, 0.11)),
    },
    {
      bone: "spine",
      material: "body",
      geometry: ellipsoid(at("spine", 0, 0.08), new Vector3(0.135, 0.12, 0.095)),
    },
    {
      bone: "chest",
      material: "body",
      geometry: ellipsoid(at("chest", 0, 0.09, 0.005), new Vector3(0.18, 0.15, 0.105)),
    },
    { bone: "neck", material: "joint", geometry: capsule(at("neck", 0, -0.02), at("head"), 0.045) },
    {
      bone: "head",
      material: "body",
      geometry: ellipsoid(at("head", 0, 0.1, 0.01), new Vector3(0.09, 0.115, 0.1)),
    },
    // Visor so the facing direction reads at a glance.
    {
      bone: "head",
      material: "visor",
      geometry: ellipsoid(at("head", 0, 0.105, 0.075), new Vector3(0.07, 0.028, 0.035)),
    },
  ];
  for (const s of ["l", "r"] as const) {
    list.push(
      {
        bone: `upper_arm_${s}`,
        material: "joint",
        geometry: ellipsoid(at(`upper_arm_${s}`), new Vector3(0.06, 0.06, 0.06)),
      },
      {
        bone: `upper_arm_${s}`,
        material: "body",
        geometry: capsule(at(`upper_arm_${s}`), at(`forearm_${s}`), 0.048),
      },
      {
        bone: `forearm_${s}`,
        material: "joint",
        geometry: ellipsoid(at(`forearm_${s}`), new Vector3(0.045, 0.045, 0.045)),
      },
      {
        bone: `forearm_${s}`,
        material: "body",
        geometry: capsule(at(`forearm_${s}`), at(`hand_${s}`), 0.04),
      },
      {
        bone: `hand_${s}`,
        material: "body",
        geometry: ellipsoid(at(`hand_${s}`, 0, -0.065), new Vector3(0.03, 0.07, 0.045)),
      },
      {
        bone: `thigh_${s}`,
        material: "body",
        geometry: capsule(at(`thigh_${s}`), at(`shin_${s}`), 0.072),
      },
      {
        bone: `shin_${s}`,
        material: "joint",
        geometry: ellipsoid(at(`shin_${s}`), new Vector3(0.062, 0.062, 0.062)),
      },
      {
        bone: `shin_${s}`,
        material: "body",
        geometry: capsule(at(`shin_${s}`), at(`foot_${s}`), 0.055),
      },
      // Bottom of the foot is exactly y = 0 at rest (ankle 0.08 − 0.04 − 0.04).
      {
        bone: `foot_${s}`,
        material: "body",
        geometry: ellipsoid(at(`foot_${s}`, 0, -0.04, 0.055), new Vector3(0.05, 0.04, 0.12)),
      },
    );
  }
  return list;
}

export interface Primitive {
  material: MaterialName;
  positions: Float32Array;
  normals: Float32Array;
  joints: Uint8Array;
  weights: Float32Array;
  indices: Uint16Array;
}

/** One primitive per material; JOINTS_0 indexes into BONES order (= the skin's joint order). */
export function buildPrimitives(): Primitive[] {
  const byMaterial = new Map<MaterialName, Part[]>();
  for (const part of parts()) {
    byMaterial.set(part.material, [...(byMaterial.get(part.material) ?? []), part]);
  }
  return [...byMaterial].map(([material, list]) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const joints: number[] = [];
    const weights: number[] = [];
    const indices: number[] = [];
    for (const { bone, geometry } of list) {
      const base = positions.length / 3;
      const pos = geometry.getAttribute("position");
      const nor = geometry.getAttribute("normal");
      const jointIndex = BONES.findIndex((b) => b.name === bone);
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        joints.push(jointIndex, 0, 0, 0);
        weights.push(1, 0, 0, 0);
      }
      const index = geometry.getIndex();
      if (!index) throw new Error("expected indexed geometry");
      for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    }
    return {
      material,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      joints: new Uint8Array(joints),
      weights: new Float32Array(weights),
      indices: new Uint16Array(indices),
    };
  });
}
