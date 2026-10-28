import { AvatarSource } from "./avatar-source";

/**
 * Builds the e2e camera feed (ADR-0010 §8): the mannequin squatting, as raw I420 frames that
 * Playwright writes to a .y4m for Chrome's --use-file-for-fake-video-capture. Ground truth is
 * known: a standing lead-in, then one rep per loop, with "hidden" loops showing an empty room.
 */
export interface FeedPlan {
  width: number;
  height: number;
  fps: number;
  leadInMs: number;
  loops: number;
  hiddenLoops: number[];
}

export class FakeCameraFeed {
  private readonly scratch: CanvasRenderingContext2D;

  private constructor(
    private readonly avatar: AvatarSource,
    readonly plan: FeedPlan,
  ) {
    const c = document.createElement("canvas");
    c.width = plan.width;
    c.height = plan.height;
    this.scratch = c.getContext("2d", { willReadFrequently: true })!;
  }

  static async create(canvas: HTMLCanvasElement, plan: FeedPlan) {
    const avatar = new AvatarSource(canvas, plan.width, plan.height);
    await avatar.load("/exercises/bodyweight_squat/squat.glb");
    return new FakeCameraFeed(avatar, plan);
  }

  get frameCount() {
    const loopMs = this.avatar.clipDurationMs;
    return Math.round(((this.plan.leadInMs + this.plan.loops * loopMs) / 1000) * this.plan.fps);
  }

  /** Frames [from, from + count) as concatenated I420 planes, base64-encoded. */
  frames(from: number, count: number): string {
    const { width: w, height: h, fps, leadInMs, hiddenLoops } = this.plan;
    const loopMs = this.avatar.clipDurationMs;
    const size = w * h * 1.5;
    const out = new Uint8Array(size * count);
    for (let i = 0; i < count; i++) {
      const t = ((from + i) * 1000) / fps;
      const clipT = t - leadInMs;
      const canvas =
        clipT < 0
          ? this.avatar.render(0)
          : this.avatar.render(clipT, hiddenLoops.includes(Math.floor(clipT / loopMs)));
      this.scratch.drawImage(canvas, 0, 0, w, h);
      toI420(this.scratch.getImageData(0, 0, w, h).data, w, h, out.subarray(i * size));
    }
    let binary = "";
    for (let i = 0; i < out.length; i += 0x8000) {
      binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
}

/** RGBA → I420 (BT.601, limited range), chroma averaged over 2×2 blocks. */
function toI420(rgba: Uint8ClampedArray, w: number, h: number, out: Uint8Array) {
  const u0 = w * h;
  const v0 = u0 + (w / 2) * (h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[y * w + x] =
        16 + (65.481 * rgba[i]! + 128.553 * rgba[i + 1]! + 24.966 * rgba[i + 2]!) / 255;
    }
  }
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const i = ((y + dy) * w + x + dx) * 4;
        r += rgba[i]!;
        g += rgba[i + 1]!;
        b += rgba[i + 2]!;
      }
      r /= 4;
      g /= 4;
      b /= 4;
      const o = (y / 2) * (w / 2) + x / 2;
      out[u0 + o] = 128 + (-37.797 * r - 74.203 * g + 112 * b) / 255;
      out[v0 + o] = 128 + (112 * r - 93.786 * g - 18.214 * b) / 255;
    }
  }
}
