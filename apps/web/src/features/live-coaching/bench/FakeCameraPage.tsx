"use client";
import { useEffect, useRef } from "react";
import { FakeCameraFeed, type FeedPlan } from "./fake-camera";

declare global {
  interface Window {
    __fakeCamera?: (plan: FeedPlan) => Promise<FakeCameraFeed>;
  }
}

/** Exposes the feed builder to Playwright (tests/e2e/fake-camera.setup.ts). Dev-only route. */
export function FakeCameraPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    window.__fakeCamera = (plan) => FakeCameraFeed.create(canvasRef.current!, plan);
  }, []);
  return <canvas ref={canvasRef} className="w-80 border border-border" aria-hidden />;
}
