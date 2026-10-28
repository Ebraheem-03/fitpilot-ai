import { describe, expect, it, vi } from "vitest";
import { confineFetch, confineNetwork } from "./confine-fetch";

function scope() {
  const real = vi.fn(async () => new Response("ok"));
  const s = {
    fetch: real as unknown as typeof fetch,
    location: {
      href: "http://localhost:3000/_next/static/chunks/pose.worker.js",
      origin: "http://localhost:3000",
    },
  };
  confineFetch(s);
  return { s, real };
}

describe("confineFetch (pose worker privacy guard)", () => {
  it("blocks MediaPipe's usage-metrics upload", async () => {
    const { s, real } = scope();
    await expect(
      s.fetch("https://odml.pa.googleapis.com/v1/log", { method: "POST", body: "x" }),
    ).rejects.toThrow("blocked request to https://odml.pa.googleapis.com");
    expect(real).not.toHaveBeenCalled();
  });

  it("blocks any other origin, including Request objects", async () => {
    const { s, real } = scope();
    await expect(s.fetch(new Request("https://example.com/x"))).rejects.toThrow(TypeError);
    expect(real).not.toHaveBeenCalled();
  });

  it("lets the vendored runtime and model load from our origin", async () => {
    const { s, real } = scope();
    await s.fetch("http://localhost:3000/mediapipe/models/pose_landmarker_lite.task");
    await s.fetch("/mediapipe/wasm/vision_wasm_internal.wasm");
    expect(real).toHaveBeenCalledTimes(2);
  });
});

describe("confineNetwork", () => {
  class FakeXhr {
    opened: string[] = [];
    open(_method: string, url: string) {
      this.opened.push(url);
    }
  }

  function worker() {
    const s = {
      fetch: vi.fn(async () => new Response("ok")) as unknown as typeof fetch,
      location: { href: "http://localhost:3000/w.js", origin: "http://localhost:3000" },
      XMLHttpRequest: FakeXhr as unknown as typeof XMLHttpRequest,
      WebSocket: class {} as unknown,
      EventSource: class {} as unknown,
    };
    confineNetwork(s);
    return s;
  }

  it("refuses cross-origin XHR but allows our own runtime files", () => {
    const s = worker();
    const xhr = new (s.XMLHttpRequest as unknown as typeof FakeXhr)();
    expect(() => xhr.open("POST", "https://odml.pa.googleapis.com/v1/log")).toThrow("blocked");
    xhr.open("GET", "/mediapipe/wasm/vision_wasm_internal.wasm");
    expect(xhr.opened).toEqual(["/mediapipe/wasm/vision_wasm_internal.wasm"]);
  });

  it("removes sockets and event streams", () => {
    const s = worker();
    expect(s.WebSocket).toBeUndefined();
    expect(s.EventSource).toBeUndefined();
  });
});
