"use client";
import { useState } from "react";
import { setTrackingConsent } from "./actions";

export const CONSENT_COPY =
  "We'll save your rep counts, rep timing, tracking quality and the measurements behind each cue to your account — never video or body points.";

/**
 * One-time, explicit consent before the first tracked set (ADR-0011 §4). Declining is a real
 * choice: tracking works the same on this device, nothing tracked is saved.
 */
export function TrackingConsentStep({
  onDecision,
}: {
  onDecision: (saveTrackingData: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    const res = await setTrackingConsent().catch(() => null);
    setBusy(false);
    if (res?.ok) onDecision(true);
    else setError("We couldn't record your choice. Please try again, or choose not to save.");
  }

  return (
    <div
      role="group"
      aria-labelledby="consent-heading"
      data-testid="tracking-consent"
      className="flex flex-col gap-3 rounded-xl border border-border p-5"
    >
      <h3 id="consent-heading" className="font-semibold">
        Save your tracking data?
      </h3>
      <p className="text-sm">{CONSENT_COPY}</p>
      <p className="text-sm text-muted">
        Saved only after the camera stops. You can change your mind any time on your profile page.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void agree()}
          className="rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-50"
        >
          Save my tracking data
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecision(false)}
          className="rounded-md border border-border px-4 py-2 font-medium hover:bg-surface disabled:opacity-50"
        >
          Don&apos;t save — track only on this device
        </button>
      </div>
    </div>
  );
}
