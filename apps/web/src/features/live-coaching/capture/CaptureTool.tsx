"use client";
import {
  type ClipLabels,
  ExerciseContract,
  type LandmarkFixture,
} from "@fitpilot/exercise-contracts";
import { useEffect, useRef, useState } from "react";
import squatCatalog from "../../../../../../data/exercise-catalog/bodyweight_squat.json";
import { AvatarSource } from "../bench/avatar-source";
import { unpackFixtureFrame } from "../landmarks";
import { drawSkeleton } from "../skeleton";
import { defaultAssetBases, PoseWorkerClient } from "../worker/pose-client";
import type { PoseModel } from "../worker/protocol";
import { extractLandmarks, type StepSource, videoFileSource } from "./extract";
import { buildLandmarkFixture, type CapturedFrame, mannequinLabels } from "./fixture";

const squat = ExerciseContract.parse(squatCatalog);
type Status = "idle" | "extracting" | "done" | "error";
type Rep = ClipLabels["reps"][number];

declare global {
  interface Window {
    __capture?: { status: Status; fixture: LandmarkFixture | null; labels: ClipLabels | null };
  }
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * M2 S2 dev tool: turns a local recording (or the synthetic mannequin) into a landmark fixture
 * with the runtime worker, and lets a person annotate reps → labels.json. The video is only
 * read from disk into this tab; nothing is uploaded and no video is written anywhere.
 */
export function CaptureTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mannequinRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<"file" | "mannequin">("file");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [clipId, setClipId] = useState("squat_side_001");
  const [model, setModel] = useState<PoseModel>("lite");
  const [fps, setFps] = useState(30);
  const [loops, setLoops] = useState(6);
  const [blankLoop, setBlankLoop] = useState("3");
  const [mannequinView, setMannequinView] = useState<"side" | "front">("side");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [fixture, setFixture] = useState<LandmarkFixture | null>(null);

  // annotation
  const [cameraView, setCameraView] = useState<ClipLabels["camera_view"]>("side");
  const [facing, setFacing] = useState<NonNullable<ClipLabels["facing"]>>("left");
  const [supported, setSupported] = useState(true);
  const [lighting, setLighting] = useState<ClipLabels["conditions"]["lighting"]>("normal");
  const [clothing, setClothing] = useState<ClipLabels["conditions"]["clothing"]>("fitted");
  const [distance, setDistance] = useState("2.5");
  const [notes, setNotes] = useState("");
  const [annotator, setAnnotator] = useState("owner");
  const [reps, setReps] = useState<Rep[]>([]);
  const [draft, setDraft] = useState<{ start?: number; bottom?: number }>({});
  const [gaps, setGaps] = useState<[number, number][]>([]);
  const [gapStart, setGapStart] = useState<number | null>(null);
  const [autoLabels, setAutoLabels] = useState<ClipLabels | null>(null);

  const labels: ClipLabels | null = autoLabels ?? {
    format_version: 1,
    clip_id: clipId,
    exercise_id: squat.id,
    camera_view: cameraView,
    facing,
    supported,
    conditions: {
      lighting,
      clothing,
      ...(Number(distance) > 0 ? { distance_m: Number(distance) } : {}),
      ...(notes ? { notes } : {}),
    },
    reps,
    untrackable_ranges_ms: gaps,
    annotated_by: annotator,
  };

  useEffect(() => {
    window.__capture = { status, fixture, labels };
  });

  useEffect(() => () => void (videoUrl && URL.revokeObjectURL(videoUrl)), [videoUrl]);

  const nowMs = () => Math.round((videoRef.current?.currentTime ?? 0) * 1000);

  function drawOverlay() {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !fixture) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const i = Math.round(nowMs() / (1000 / fixture.source.fps));
    const lm = unpackFixtureFrame(fixture, i);
    if (lm) drawSkeleton(ctx, lm, { minVisibility: 0.6, mirrored: false });
  }

  async function extract() {
    setError("");
    setStatus("extracting");
    setProgress(0);
    setFixture(null);
    const client = new PoseWorkerClient();
    try {
      let step: StepSource;
      let kind: "recording" | "synthetic" = "recording";
      if (source === "mannequin") {
        kind = "synthetic";
        const avatar = new AvatarSource(mannequinRef.current!, 640, 480, mannequinView);
        await avatar.load(`/exercises/${squat.id}/${squat.animation!.asset}`);
        const blanks = blankLoop.split(",").filter(Boolean).map(Number);
        const clipMs = avatar.clipDurationMs;
        step = {
          width: 640,
          height: 480,
          durationMs: loops * clipMs,
          frameAt: async (t) => avatar.render(t, blanks.includes(Math.floor(t / clipMs))),
        };
        setAutoLabels(
          mannequinLabels({
            clipId,
            exerciseId: squat.id,
            animation: squat.animation!,
            loops,
            blankLoops: blanks,
            view: mannequinView,
          }),
        );
      } else {
        const video = videoRef.current;
        if (!video || !videoUrl) throw new Error("choose a video file first");
        video.pause();
        step = videoFileSource(video);
        setAutoLabels(null);
      }
      await client.init({ model, delegate: "auto", ...defaultAssetBases(location.origin) });
      const frames: CapturedFrame[] = await extractLandmarks(step, client, fps, setProgress);
      setFixture(
        buildLandmarkFixture({
          clipId,
          exerciseId: squat.id,
          kind,
          model,
          width: step.width,
          height: step.height,
          fps,
          frames,
        }),
      );
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    } finally {
      client.terminate();
    }
  }

  const detected = fixture ? fixture.frames.filter((f) => f.p).length / fixture.frames.length : 0;
  const field = "rounded border border-border px-2 py-1";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-end gap-4" aria-label="Capture settings">
        <label className="flex flex-col text-sm">
          Source
          <select
            className={field}
            value={source}
            onChange={(e) => setSource(e.target.value as "file" | "mannequin")}
          >
            <option value="file">Local video file</option>
            <option value="mannequin">Synthetic mannequin</option>
          </select>
        </label>
        {source === "file" ? (
          <label className="flex flex-col text-sm">
            Video (stays on this device)
            <input
              type="file"
              accept="video/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setVideoUrl(file ? URL.createObjectURL(file) : null);
                setFixture(null);
              }}
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col text-sm">
              Loops (one rep each)
              <input
                className={`${field} w-20`}
                type="number"
                min={1}
                max={20}
                value={loops}
                onChange={(e) => setLoops(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col text-sm">
              Camera
              <select
                className={field}
                value={mannequinView}
                onChange={(e) => setMannequinView(e.target.value as "side" | "front")}
              >
                <option value="side">side (supported)</option>
                <option value="front">front (unsupported)</option>
              </select>
            </label>
            <label className="flex flex-col text-sm">
              Hidden loops (comma-separated, 0-based)
              <input
                className={`${field} w-28`}
                value={blankLoop}
                onChange={(e) => setBlankLoop(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="flex flex-col text-sm">
          Clip id
          <input className={field} value={clipId} onChange={(e) => setClipId(e.target.value)} />
        </label>
        <label className="flex flex-col text-sm">
          Model
          <select
            className={field}
            value={model}
            onChange={(e) => setModel(e.target.value as PoseModel)}
          >
            <option value="lite">lite (runtime default)</option>
            <option value="full">full</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          fps
          <input
            className={`${field} w-20`}
            type="number"
            min={5}
            max={60}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={status === "extracting"}
          onClick={extract}
        >
          Extract landmarks
        </button>
        <p data-testid="capture-status" data-status={status} className="text-sm" aria-live="polite">
          {status === "extracting" ? `extracting ${Math.round(progress * 100)}%` : status}
          {fixture &&
            ` — ${fixture.frames.length} frames, person in ${Math.round(detected * 100)}%`}
        </p>
      </section>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-4">
        <div className="relative w-full max-w-xl">
          {/* recordings have no audio track to caption; this is a local annotation preview */}
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            controls
            muted
            playsInline
            className="w-full"
            onTimeUpdate={drawOverlay}
            onSeeked={drawOverlay}
          />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          />
        </div>
        <canvas
          ref={mannequinRef}
          width={640}
          height={480}
          className={source === "mannequin" ? "w-80 border border-border" : "hidden"}
          aria-hidden
        />
      </div>

      {source === "file" && (
        <section className="flex flex-col gap-3" aria-label="Annotation">
          <h2 className="font-semibold">Annotate</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex flex-col">
              Camera view
              <select
                className={field}
                value={cameraView}
                onChange={(e) => setCameraView(e.target.value as ClipLabels["camera_view"])}
              >
                <option value="side">side</option>
                <option value="front">front</option>
                <option value="three_quarter">three quarter</option>
              </select>
            </label>
            <label className="flex flex-col">
              Facing (in the image)
              <select
                className={field}
                value={facing}
                onChange={(e) => setFacing(e.target.value as typeof facing)}
              >
                <option value="left">left</option>
                <option value="right">right</option>
                <option value="camera">camera</option>
                <option value="away">away</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={supported}
                onChange={(e) => setSupported(e.target.checked)}
              />
              Supported setup (side view, full body)
            </label>
            <label className="flex flex-col">
              Lighting
              <select
                className={field}
                value={lighting}
                onChange={(e) => setLighting(e.target.value as typeof lighting)}
              >
                <option value="normal">normal</option>
                <option value="dim">dim</option>
                <option value="backlit">backlit</option>
              </select>
            </label>
            <label className="flex flex-col">
              Clothing
              <select
                className={field}
                value={clothing}
                onChange={(e) => setClothing(e.target.value as typeof clothing)}
              >
                <option value="fitted">fitted</option>
                <option value="loose">loose</option>
              </select>
            </label>
            <label className="flex flex-col">
              Distance (m)
              <input
                className={`${field} w-20`}
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
            </label>
            <label className="flex flex-col">
              Notes (no names)
              <input
                className={field}
                maxLength={200}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="flex flex-col">
              Annotator (initials or role)
              <input
                className={`${field} w-28`}
                maxLength={40}
                value={annotator}
                onChange={(e) => setAnnotator(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" className={field} onClick={() => setDraft({ start: nowMs() })}>
              Rep start
            </button>
            <button
              type="button"
              className={field}
              disabled={draft.start === undefined}
              onClick={() => setDraft((d) => ({ ...d, bottom: nowMs() }))}
            >
              Bottom
            </button>
            <button
              type="button"
              className={field}
              disabled={draft.bottom === undefined}
              onClick={() => {
                setReps((r) => [
                  ...r,
                  {
                    start_ms: draft.start!,
                    bottom_ms: draft.bottom!,
                    end_ms: nowMs(),
                    full_depth: true,
                  },
                ]);
                setDraft({});
              }}
            >
              Rep end
            </button>
            <button
              type="button"
              className={field}
              disabled={reps.length === 0}
              onClick={() =>
                setReps((r) =>
                  r.map((rep, i) =>
                    i === r.length - 1 ? { ...rep, full_depth: !rep.full_depth } : rep,
                  ),
                )
              }
            >
              Toggle last rep full depth
            </button>
            <button
              type="button"
              className={field}
              disabled={reps.length === 0}
              onClick={() => setReps((r) => r.slice(0, -1))}
            >
              Undo last rep
            </button>
            <button
              type="button"
              className={field}
              onClick={() => {
                if (gapStart === null) setGapStart(nowMs());
                else {
                  setGaps((g) => [...g, [gapStart, nowMs()]]);
                  setGapStart(null);
                }
              }}
            >
              {gapStart === null ? "Untrackable from here" : "Untrackable until here"}
            </button>
          </div>
          <p className="text-sm" aria-live="polite">
            {reps.length} reps
            {draft.start !== undefined && ` · marking rep from ${draft.start} ms`}
            {gaps.length > 0 && ` · untrackable: ${gaps.map(([a, b]) => `${a}–${b}`).join(", ")}`}
          </p>
          <ol className="list-decimal pl-6 text-xs">
            {reps.map((r) => (
              <li key={r.start_ms}>
                {r.start_ms} → {r.bottom_ms} → {r.end_ms} ms{r.full_depth ? "" : " (shallow)"}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex gap-3" aria-label="Export">
        <button
          type="button"
          className={field}
          disabled={!fixture}
          onClick={() => download(`${clipId}.landmarks.json`, fixture)}
        >
          Download landmarks.json
        </button>
        <button
          type="button"
          className={field}
          disabled={!labels}
          onClick={() => download(`${clipId}.labels.json`, labels)}
        >
          Download labels.json
        </button>
      </section>
    </div>
  );
}
