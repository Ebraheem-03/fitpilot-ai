"use client";
import dynamic from "next/dynamic";

/** The WebGL scene is client-only and code-split so three.js never blocks the page (FR-03). */
export const LazyScene = dynamic(() => import("./AvatarScene"), { ssr: false });
