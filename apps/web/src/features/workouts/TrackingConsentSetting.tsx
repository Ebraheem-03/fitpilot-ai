"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { withdrawTrackingConsent } from "./actions";

/** Profile page: whether tracking data is saved, and a way to stop (ADR-0011 §4). */
export function TrackingConsentSetting({ consentedAt }: { consentedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    const res = await withdrawTrackingConsent().catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError("We couldn't withdraw your consent. Please try again.");
  }

  return (
    <section
      aria-labelledby="tracking-data-heading"
      data-testid="tracking-consent-setting"
      className="flex flex-col gap-2 rounded-xl border border-border p-5"
    >
      <h2 id="tracking-data-heading" className="font-semibold">
        Saving your tracking data
      </h2>
      {consentedAt ? (
        <>
          <p className="text-sm">
            On. Your rep counts, rep timing, tracking quality and the measurements behind each cue
            are saved to your account after each camera set. Video and body points are never saved.
          </p>
          <p className="text-sm text-muted">
            Withdrawing stops saving from now on. Sessions already saved stay until you delete them.
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void withdraw()}
              className="rounded-md border border-border px-4 py-2 font-medium hover:bg-surface disabled:opacity-50"
            >
              Withdraw
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm">
          Off. Camera tracking works on your device, and nothing it measures is saved. You&apos;ll
          be asked before your first saved set.
        </p>
      )}
    </section>
  );
}
