export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface Landmark extends Point {
  /** MediaPipe visibility in [0,1]; how likely the point is visible in-frame. */
  visibility: number;
}

/**
 * Angle at joint B formed by A–B–C, in degrees (blueprint §8):
 *   θ = acos( (A−B)·(C−B) / (|A−B| |C−B|) )
 * Uses 2D image-plane coordinates by default; MediaPipe z is noisy for single-camera input.
 * Returns null for degenerate input (coincident points) instead of NaN.
 */
export function jointAngle(a: Point, b: Point, c: Point, use3d = false): number | null {
  const ax = a.x - b.x;
  const ay = a.y - b.y;
  const az = use3d ? (a.z ?? 0) - (b.z ?? 0) : 0;
  const cx = c.x - b.x;
  const cy = c.y - b.y;
  const cz = use3d ? (c.z ?? 0) - (b.z ?? 0) : 0;

  const magA = Math.hypot(ax, ay, az);
  const magC = Math.hypot(cx, cy, cz);
  if (magA < 1e-9 || magC < 1e-9) return null;

  const cos = (ax * cx + ay * cy + az * cz) / (magA * magC);
  // clamp for floating-point drift outside [-1, 1]
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}
