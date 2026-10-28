import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  LANDMARK_STRIDE,
  POSE_LANDMARK_COUNT,
  type PoseDelegate,
  type PoseRunnerOptions,
} from "./protocol";

export interface PoseDetection {
  landmarks: Float32Array | null;
  inferMs: number;
}

/**
 * MediaPipe PoseLandmarker in VIDEO mode (§8 stage 1). Has no DOM dependency beyond
 * OffscreenCanvas, so the same class runs in the worker and, for benchmarks, on the main thread.
 */
export class PoseRunner {
  private landmarker: PoseLandmarker | null = null;
  private lastTs = -1;
  delegate: PoseDelegate = "CPU";

  /**
   * Loads the model and runs one warm-up inference, so "ready" means the first real frame won't
   * stall on shader/WASM compilation (S0: up to 7.5 s cold on WebKit + GPU).
   */
  async init(options: PoseRunnerOptions): Promise<PoseDelegate> {
    // Classic loader: Turbopack emits the worker as a classic script (importScripts works), and on
    // the main thread MediaPipe injects a plain <script>. The ES-module build fails in both (S0).
    const fileset = await FilesetResolver.forVisionTasks(options.wasmBase);
    const modelAssetPath = `${options.modelBase}/pose_landmarker_${options.model}.task`;
    const wanted: PoseDelegate =
      options.delegate === "auto" ? (hasHardwareWebGL2() ? "GPU" : "CPU") : options.delegate;
    const create = (delegate: PoseDelegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        ...(delegate === "GPU" && typeof OffscreenCanvas !== "undefined"
          ? { canvas: new OffscreenCanvas(1, 1) }
          : {}),
      });
    try {
      this.landmarker = await create(wanted);
      this.delegate = wanted;
    } catch (error) {
      if (wanted === "CPU") throw error;
      // No usable WebGL2 in this context: CPU still works, just slower (ADR-0010).
      this.landmarker = await create("CPU");
      this.delegate = "CPU";
    }
    if (typeof OffscreenCanvas !== "undefined") this.detect(new OffscreenCanvas(256, 256), 0);
    return this.delegate;
  }

  detect(frame: TexImageSource, tMs: number): PoseDetection {
    if (!this.landmarker) throw new Error("PoseRunner.detect before init");
    // VIDEO mode requires strictly increasing timestamps.
    const ts = tMs > this.lastTs ? tMs : this.lastTs + 1;
    this.lastTs = ts;
    const start = performance.now();
    const result = this.landmarker.detectForVideo(frame, ts);
    const inferMs = performance.now() - start;
    const pose = result.landmarks[0];
    if (!pose || pose.length < POSE_LANDMARK_COUNT) return { landmarks: null, inferMs };
    const out = new Float32Array(POSE_LANDMARK_COUNT * LANDMARK_STRIDE);
    for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
      const p = pose[i]!;
      out.set([p.x, p.y, p.z, p.visibility ?? 0], i * LANDMARK_STRIDE);
    }
    return { landmarks: out, inferMs };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.lastTs = -1;
  }
}

/**
 * GPU inference on a software rasteriser (SwiftShader, llvmpipe — headless CI, some VMs and old
 * devices) is far slower than CPU and starves the page (S0: ~1 fps), so "auto" picks CPU there.
 */
export function hasHardwareWebGL2(): boolean {
  if (typeof OffscreenCanvas === "undefined") return false;
  const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
  if (!gl) return false;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return !isSoftwareRenderer(renderer);
}

export const isSoftwareRenderer = (renderer: string) =>
  /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
