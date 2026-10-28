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

type WorkerScope = {
  fetch: typeof fetch;
  location: { href: string; origin: string };
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: unknown;
  EventSource?: unknown;
};

/**
 * Everything the worker could use to reach the network, confined to its own origin: fetch and
 * XHR (Emscripten's loader uses XHR) are origin-checked; sockets and event streams, which the
 * worker never needs, are removed. Defence in depth against a future MediaPipe build switching
 * transport (M2 security review).
 */
export function confineNetwork(scope: WorkerScope) {
  confineFetch(scope);
  const Xhr = scope.XMLHttpRequest;
  if (Xhr) {
    const open = Xhr.prototype.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
    Xhr.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      const url = new URL(String(args[1]), scope.location.href);
      if (url.origin !== scope.location.origin) {
        throw new TypeError(`pose worker: blocked request to ${url.origin}`);
      }
      open.apply(this, args);
    } as typeof Xhr.prototype.open;
  }
  scope.WebSocket = undefined;
  scope.EventSource = undefined;
}
