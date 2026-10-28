import {
  AnimationMixer,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Synthetic frame source (pose benchmark, capture tool, e2e camera feed): the M1 squat mannequin rendered side-on into a
 * 640×480 canvas. No real person, deterministic, works on any device without a camera.
 */
export class AvatarSource {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 640 / 480, 0.1, 20);
  private mixer: AnimationMixer | null = null;
  private model: Object3D | null = null;
  private duration = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(640, 480, false);
    this.scene.background = new Color("#d8dbe0");
    this.scene.add(new HemisphereLight("#ffffff", "#8a8f98", 1.3));
    const sun = new DirectionalLight("#ffffff", 1.7);
    sun.position.set(2.5, 4, 3);
    this.scene.add(sun);
    this.camera.position.set(3.4, 1.0, 0);
    this.camera.lookAt(0, 0.85, 0);
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.scene.add(gltf.scene);
    this.model = gltf.scene;
    const clip = gltf.animations[0];
    if (!clip) throw new Error(`${url} has no animation clip`);
    this.mixer = new AnimationMixer(gltf.scene);
    this.mixer.clipAction(clip).play();
    this.duration = clip.duration;
  }

  get clipDurationMs(): number {
    return this.duration * 1000;
  }

  /** Renders the pose at `tMs` (looping) and returns the canvas; `hidden` renders an empty room. */
  render(tMs: number, hidden = false): HTMLCanvasElement {
    if (this.model) this.model.visible = !hidden;
    this.mixer?.setTime((tMs / 1000) % this.duration);
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
