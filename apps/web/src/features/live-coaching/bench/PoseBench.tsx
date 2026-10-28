"use client";
import { useEffect, useRef, useState } from "react";
import { AvatarSource } from "./avatar-source";
import { BENCH_MATRIX, type BenchRow, type FrameSource, runBenchConfig } from "./run-bench";

type Status = "idle" | "loading" | "running" | "done" | "error";

declare global {
  interface Window {
    __poseBench?: { status: Status; rows: BenchRow[]; env: Record<string, string> };
  }
}

const COLUMNS: (keyof BenchRow)[] = [
  "thread",
  "model",
  "delegate",
  "actualDelegate",
  "transport",
  "initMs",
  "firstResultMs",
  "processedFps",
  "inferP50",
  "inferP95",
  "latencyP50",
  "latencyP95",
  "captureP50",
  "mainRafFps",
  "longTasks",
  "longTaskMs",
  "detectionRate",
  "error",
];

/**
 * M2 S0 spike harness (ADR-0010): runs PoseLandmarker over a frame source for each config in
 * BENCH_MATRIX and reports fps, inference/latency percentiles and main-thread smoothness.
 * Dev-only page; frames never leave the browser.
 */
export function PoseBench() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<"avatar" | "camera">("avatar");
  const [seconds, setSeconds] = useState(8);
  const [status, setStatus] = useState<Status>("idle");
  const [current, setCurrent] = useState("");
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    window.__poseBench = {
      status,
      rows,
      env: {
        userAgent: navigator.userAgent,
        cores: String(navigator.hardwareConcurrency ?? "?"),
        crossOriginIsolated: String(self.crossOriginIsolated),
      },
    };
  }, [status, rows]);

  async function run() {
    setRows([]);
    setError("");
    setStatus("loading");
    let frameSource: FrameSource;
    let cleanup = () => {};
    try {
      if (source === "avatar") {
        const avatar = new AvatarSource(canvasRef.current!);
        await avatar.load("/exercises/bodyweight_squat/squat.glb");
        frameSource = (t) => avatar.render(t);
        cleanup = () => avatar.dispose();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        frameSource = () => video;
        cleanup = () => {
          for (const track of stream.getTracks()) track.stop();
          video.srcObject = null;
        };
      }
      setStatus("running");
      const out: BenchRow[] = [];
      for (const cfg of BENCH_MATRIX) {
        setCurrent(`${cfg.thread} · ${cfg.model} · ${cfg.delegate} · ${cfg.transport}`);
        out.push(await runBenchConfig(cfg, frameSource, seconds * 1000));
        setRows([...out]);
      }
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    } finally {
      cleanup();
      setCurrent("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm">
          Source
          <select
            className="rounded border border-border px-2 py-1"
            value={source}
            onChange={(e) => setSource(e.target.value as "avatar" | "camera")}
          >
            <option value="avatar">3D mannequin (synthetic)</option>
            <option value="camera">Camera</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Seconds per config
          <input
            className="w-24 rounded border border-border px-2 py-1"
            type="number"
            min={2}
            max={60}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={status === "loading" || status === "running"}
          onClick={run}
        >
          Run benchmark
        </button>
        <p data-testid="bench-status" data-status={status} className="text-sm">
          {status}
          {current && ` — ${current}`}
        </p>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-4">
        <canvas ref={canvasRef} width={640} height={480} className="w-80 border border-border" />
        <video ref={videoRef} muted playsInline className="w-80 border border-border" />
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} className="px-2 text-left">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {COLUMNS.map((c) => (
                  <td key={c} className="px-2">
                    {String(row[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <pre className="overflow-x-auto text-xs">{JSON.stringify(rows, null, 1)}</pre>
      )}
    </div>
  );
}
