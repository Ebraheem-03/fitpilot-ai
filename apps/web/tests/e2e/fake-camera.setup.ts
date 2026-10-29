import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Page, test as setup } from "@playwright/test";
import type { FeedPlan } from "../../src/features/live-coaching/bench/feed-timeline";
import { FEEDS } from "./fake-camera";

/**
 * Renders the mannequin feeds through /dev/fake-camera and writes them as Y4M for Chrome's
 * --use-file-for-fake-video-capture. Cached by plan, so each is built once per checkout/CI job.
 */
setup("build the synthetic camera feeds", async ({ page }) => {
  setup.setTimeout(360_000);
  for (const { path, plan } of FEEDS) await build(page, path, plan);
});

async function build(page: Page, path: string, feedPlan: FeedPlan) {
  const key = `${path}.plan.json`;
  const plan = JSON.stringify(feedPlan);
  if (existsSync(path) && existsSync(key) && readFileSync(key, "utf8") === plan) return;

  await page.goto("/dev/fake-camera");
  await page.waitForFunction(() => typeof window.__fakeCamera === "function");
  const total = await page.evaluate(async (p) => {
    const feed = await window.__fakeCamera!(p);
    (window as unknown as { __feed: typeof feed }).__feed = feed;
    return feed.frameCount;
  }, feedPlan);
  expect(total).toBeGreaterThan(0);

  mkdirSync(dirname(path), { recursive: true });
  const out = createWriteStream(path);
  const { width, height, fps } = feedPlan;
  out.write(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`);
  const frameBytes = width * height * 1.5;
  for (let from = 0; from < total; from += 30) {
    const count = Math.min(30, total - from);
    const b64 = await page.evaluate(
      ([f, c]) =>
        (window as unknown as { __feed: { frames(a: number, b: number): string } }).__feed.frames(
          f,
          c,
        ),
      [from, count] as const,
    );
    const buf = Buffer.from(b64, "base64");
    for (let i = 0; i < count; i++) {
      out.write("FRAME\n");
      out.write(buf.subarray(i * frameBytes, (i + 1) * frameBytes));
    }
  }
  await new Promise<void>((resolve, reject) =>
    out.end((e?: Error | null) => (e ? reject(e) : resolve())),
  );
  writeFileSync(key, plan);
}
