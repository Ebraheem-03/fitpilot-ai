import { Document, NodeIO, type Node } from "@gltf-transform/core";
import { Matrix4 } from "three";
import type { ClipDefinition } from "./clips/types.ts";
import { buildPrimitives, type MaterialName } from "./mesh.ts";
import type { Pose } from "./pose.ts";
import { BONES, type BoneName, restWorldPosition } from "./skeleton.ts";

export const SAMPLE_RATE = 30;

const MATERIALS: Record<
  MaterialName,
  { color: [number, number, number, number]; roughness: number }
> = {
  body: { color: [0.74, 0.77, 0.82, 1], roughness: 0.55 },
  joint: { color: [0.22, 0.25, 0.3, 1], roughness: 0.45 },
  visor: { color: [0.05, 0.55, 0.75, 1], roughness: 0.25 },
};

/** Builds the mannequin with one animation per clip. Output is deterministic for a given input. */
export async function buildGlb(clips: ClipDefinition[]): Promise<Uint8Array> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = "@fitpilot/avatar";
  const buffer = doc.createBuffer();
  const scene = doc.createScene("Scene");
  doc.getRoot().setDefaultScene(scene);

  const nodes = new Map<BoneName, Node>();
  for (const def of BONES) {
    const node = doc.createNode(def.name).setTranslation([...def.offset]);
    nodes.set(def.name, node);
    if (def.parent) nodes.get(def.parent)!.addChild(node);
  }
  const root = nodes.get("root")!;

  const inverseBind = new Float32Array(BONES.length * 16);
  BONES.forEach((def, i) => {
    const m = new Matrix4().makeTranslation(...restWorldPosition(def.name)).invert();
    inverseBind.set(m.elements, i * 16);
  });
  const skin = doc
    .createSkin("mannequin")
    .setSkeleton(root)
    .setInverseBindMatrices(
      doc.createAccessor().setType("MAT4").setArray(inverseBind).setBuffer(buffer),
    );
  for (const def of BONES) skin.addJoint(nodes.get(def.name)!);

  const mesh = doc.createMesh("mannequin");
  for (const prim of buildPrimitives()) {
    const spec = MATERIALS[prim.material];
    const material = doc
      .createMaterial(prim.material)
      .setBaseColorFactor(spec.color)
      .setRoughnessFactor(spec.roughness)
      .setMetallicFactor(0);
    const accessor = (
      type: "VEC3" | "VEC4" | "SCALAR",
      array: Float32Array | Uint8Array | Uint16Array,
    ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setMaterial(material)
        .setIndices(accessor("SCALAR", prim.indices))
        .setAttribute("POSITION", accessor("VEC3", prim.positions))
        .setAttribute("NORMAL", accessor("VEC3", prim.normals))
        .setAttribute("JOINTS_0", accessor("VEC4", prim.joints))
        .setAttribute("WEIGHTS_0", accessor("VEC4", prim.weights)),
    );
  }
  const body = doc.createNode("mannequin_mesh").setMesh(mesh).setSkin(skin);
  scene.addChild(root).addChild(body);

  for (const clip of clips) addClip(doc, clip, nodes, buffer);
  return new NodeIO().writeBinary(doc);
}

function addClip(
  doc: Document,
  clip: ClipDefinition,
  nodes: Map<BoneName, Node>,
  buffer: ReturnType<Document["createBuffer"]>,
) {
  const frames = Math.round(clip.duration_s * SAMPLE_RATE) + 1;
  const times = new Float32Array(frames);
  const poses: Pose[] = [];
  for (let f = 0; f < frames; f++) {
    times[f] = f / SAMPLE_RATE;
    poses.push(clip.pose(clip.depthAt(times[f]!)));
  }
  const input = doc.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
  const animation = doc.createAnimation(clip.name);
  const channel = (node: Node, path: "rotation" | "translation", values: Float32Array) => {
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setInterpolation("LINEAR")
      .setOutput(
        doc
          .createAccessor()
          .setType(path === "rotation" ? "VEC4" : "VEC3")
          .setArray(values)
          .setBuffer(buffer),
      );
    animation
      .addSampler(sampler)
      .addChannel(
        doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
      );
  };

  const animated = BONES.filter((def) => poses.some((p) => p.rotations[def.name]));
  for (const def of animated) {
    const values = new Float32Array(frames * 4);
    poses.forEach((pose, f) => {
      const q = pose.rotations[def.name];
      values.set(q ? [q.x, q.y, q.z, q.w] : [0, 0, 0, 1], f * 4);
    });
    channel(nodes.get(def.name)!, "rotation", values);
  }
  const hips = new Float32Array(frames * 3);
  poses.forEach((pose, f) => hips.set([pose.hips.x, pose.hips.y, pose.hips.z], f * 3));
  channel(nodes.get("hips")!, "translation", hips);
}
