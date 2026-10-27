import { z } from "zod";
import { LANDMARK_NAMES } from "./landmarks";

export const CameraView = z.enum(["side", "front", "front_45"]);

export const Capability = z.enum([
  "pose_tracking",
  "rep_counting",
  "phase_detection",
  "rule_based_feedback",
]);

/** Blueprint §13 exercise contract. The exercise catalogue is the source of truth (principle 2). */
export const ExerciseContract = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  version: z.number().int().positive(),
  equipment: z.array(z.string()),
  target_muscles: z.array(z.string()).default([]),
  camera_views: z.array(CameraView).min(1),
  animation_asset: z.string().regex(/\.glb$/),
  supported_capabilities: z.array(Capability).min(1),
  required_landmarks: z.array(z.enum(LANDMARK_NAMES)).min(1),
  ruleset_version: z.number().int().positive(),
  phases: z.array(z.string()).min(2),
  instructions: z.array(z.string()).min(1),
  technique_considerations: z.array(z.string()).default([]),
});

export type ExerciseContract = z.infer<typeof ExerciseContract>;
export type CameraView = z.infer<typeof CameraView>;
