/**
 * Privacy guard for the pose worker (principle 5, ADR-0010 §9). MediaPipe Tasks posts usage
 * metrics to odml.pa.googleapis.com from inside the worker, and has no switch to turn that off
 * (S7 e2e caught it). The worker only ever needs its own origin (vendored WASM + model), so every
 * cross-origin request is refused before it leaves the device.
 */
export function confineFetch(scope: {
  fetch: typeof fetch;
  location: { href: string; origin: string };
}) {
  const ownFetch = scope.fetch.bind(scope);
  scope.fetch = (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, scope.location.href);
    if (url.origin !== scope.location.origin) {
      return Promise.reject(new TypeError(`pose worker: blocked request to ${url.origin}`));
    }
    return ownFetch(input, init);
  };
}
