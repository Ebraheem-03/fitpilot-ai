import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoseWorkerClient } from "./pose-client";
import { isSoftwareRenderer } from "./pose-runner";
import type { FromWorker, ToWorker } from "./protocol";

/** Stands in for pose.worker: records messages, lets the test reply or crash it. */
class FakeWorker {
  static last: FakeWorker;
  sent: ToWorker[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: ToWorker, transfer: Transferable[] = []) {
    this.sent.push(message);
    this.transfers.push(transfer);
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: FromWorker) {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
}

const options = { model: "lite", delegate: "auto", wasmBase: "/w", modelBase: "/m" } as const;
const frame = () => ({ close: vi.fn() }) as unknown as ImageBitmap;

describe("PoseWorkerClient", () => {
  beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
  afterEach(() => vi.unstubAllGlobals());

  async function ready() {
    const client = new PoseWorkerClient();
    const init = client.init(options);
    FakeWorker.last.reply({ type: "ready", delegate: "CPU", initMs: 5 });
    await expect(init).resolves.toEqual({ delegate: "CPU", initMs: 5 });
    return { client, worker: FakeWorker.last };
  }

  it("rejects init when the worker reports a load failure", async () => {
    const client = new PoseWorkerClient();
    const init = client.init(options);
    FakeWorker.last.reply({ type: "error", stage: "init", message: "model 404" });
    await expect(init).rejects.toThrow("model 404");
  });

  it("rejects init and stops the worker when it crashes before ready", async () => {
    const client = new PoseWorkerClient();
    const init = client.init(options);
    FakeWorker.last.onerror?.({ message: "wasm failed to load" } as ErrorEvent);
    await expect(init).rejects.toThrow("wasm failed to load");
    expect(FakeWorker.last.terminated).toBe(true);
  });

  it("is not left busy when posting a frame throws", async () => {
    const { client, worker } = await ready();
    worker.postMessage = () => {
      throw new DOMException("detached", "DataCloneError");
    };
    await expect(client.detect(frame(), 1)).rejects.toThrow("detached");
    expect(client.busy).toBe(false);
  });

  it("transfers the frame and is busy until its result arrives", async () => {
    const { client, worker } = await ready();
    const f = frame();
    const pending = client.detect(f, 33);
    expect(worker.transfers.at(-1)).toEqual([f]);
    expect(client.busy).toBe(true);
    const landmarks = new Float32Array(132);
    worker.reply({ type: "result", id: 0, tMs: 33, landmarks, inferMs: 12 });
    await expect(pending).resolves.toMatchObject({ id: 0, landmarks, inferMs: 12 });
    expect(client.busy).toBe(false);
  });

  it("rejects only the failed frame on a per-frame error", async () => {
    const { client, worker } = await ready();
    const pending = client.detect(frame(), 1);
    worker.reply({ type: "error", stage: "frame", id: 0, message: "bad frame" });
    await expect(pending).rejects.toThrow("bad frame");
    expect(client.busy).toBe(false);
  });

  it("rejects in-flight frames and notifies when the worker crashes", async () => {
    const { client, worker } = await ready();
    const crashed = vi.fn();
    client.crashHandler = crashed;
    const pending = client.detect(frame(), 1);
    worker.onerror?.({ message: "out of memory" } as ErrorEvent);
    await expect(pending).rejects.toThrow("out of memory");
    expect(crashed).toHaveBeenCalledWith(expect.objectContaining({ message: "out of memory" }));
  });

  it("terminate closes the worker without reporting a crash", async () => {
    const { client, worker } = await ready();
    const crashed = vi.fn();
    client.crashHandler = crashed;
    const pending = client.detect(frame(), 1);
    client.terminate();
    await expect(pending).rejects.toThrow("terminated");
    expect(worker.sent.at(-1)).toEqual({ type: "close" });
    expect(worker.terminated).toBe(true);
    expect(crashed).not.toHaveBeenCalled();
  });
});

describe("isSoftwareRenderer", () => {
  it.each([
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
    "llvmpipe (LLVM 15.0.7, 256 bits)",
    "Microsoft Basic Render Driver",
  ])("treats %s as software", (r) => expect(isSoftwareRenderer(r)).toBe(true));

  it.each([
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
    "Apple GPU",
    "Adreno (TM) 642L",
  ])("treats %s as hardware", (r) => expect(isSoftwareRenderer(r)).toBe(false));
});
