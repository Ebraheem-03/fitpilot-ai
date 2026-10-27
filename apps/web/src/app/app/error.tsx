"use client";

// Backend or network failure inside the app: say so plainly, never show partial/invented data.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted">
        We couldn&apos;t reach FitPilot right now. Your saved data is safe.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-brand px-4 py-2 font-medium text-brand-foreground hover:bg-brand-hover"
      >
        Try again
      </button>
    </div>
  );
}
