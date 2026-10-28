// SPIKE ONLY (M1 S0) — throwaway. /spike/avatar?t=2.2&view=side
import { SceneLoader } from "./SceneLoader";

export const instant = false;

export default async function Page({ searchParams }: PageProps<"/spike/avatar">) {
  const sp = await searchParams;
  const t = typeof sp.t === "string" ? Number(sp.t) : null;
  const view = sp.view === "side" || sp.view === "45" ? sp.view : "front";
  return (
    <main style={{ width: 640, height: 640 }}>
      <SceneLoader time={t} view={view} />
    </main>
  );
}
