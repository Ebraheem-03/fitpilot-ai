import type { SessionEvent } from "@fitpilot/exercise-contracts";

/** One queued event. The key is the event's own idempotency_key, so enqueueing twice is a no-op. */
export interface OutboxRecord {
  key: string;
  sessionId: string;
  /** insertion order, tie-breaker after occurred_at */
  seq: number;
  occurredAt: string;
  event: SessionEvent;
  state: "pending" | "quarantined";
  /** why it was quarantined: a code, never event values */
  reason?: string;
  /** epoch ms; quarantined records are pruned after a week */
  quarantinedAt?: number;
}

export interface OutboxStore {
  /** Adds records whose key isn't stored yet (existing keys are left untouched). */
  put(records: OutboxRecord[]): Promise<void>;
  pending(sessionId?: string): Promise<OutboxRecord[]>;
  quarantined(): Promise<OutboxRecord[]>;
  remove(keys: string[]): Promise<void>;
  quarantine(keys: string[], reason: string, at: number): Promise<void>;
  /** Deletes quarantined records parked before `cutoff` (epoch ms). */
  pruneQuarantined(cutoff: number): Promise<void>;
}

export const byQueueOrder = (a: OutboxRecord, b: OutboxRecord) =>
  a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.seq - b.seq;

export class MemoryStore implements OutboxStore {
  private rows = new Map<string, OutboxRecord>();
  async put(records: OutboxRecord[]) {
    for (const r of records) if (!this.rows.has(r.key)) this.rows.set(r.key, { ...r });
  }
  async pending(sessionId?: string) {
    return [...this.rows.values()]
      .filter((r) => r.state === "pending" && (!sessionId || r.sessionId === sessionId))
      .sort(byQueueOrder);
  }
  async quarantined() {
    return [...this.rows.values()].filter((r) => r.state === "quarantined");
  }
  async remove(keys: string[]) {
    for (const k of keys) this.rows.delete(k);
  }
  async quarantine(keys: string[], reason: string, at: number) {
    for (const k of keys) {
      const r = this.rows.get(k);
      if (r) this.rows.set(k, { ...r, state: "quarantined", reason, quarantinedAt: at });
    }
  }
  async pruneQuarantined(cutoff: number) {
    for (const [k, r] of this.rows) {
      if (r.state === "quarantined" && (r.quarantinedAt ?? 0) < cutoff) this.rows.delete(k);
    }
  }
}

const STORE = "events";
const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const txDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** IndexedDB-backed store: survives reloads and browser restarts. */
export class IndexedDbStore implements OutboxStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(
    private readonly factory: IDBFactory,
    private readonly name = "fitpilot-outbox",
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("sessionId", "sessionId");
      };
      req.onsuccess = () => {
        // let the database be deleted (sign-out discard) even from another tab
        req.result.onversionchange = () => {
          req.result.close();
          this.db = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async all(): Promise<OutboxRecord[]> {
    const db = await this.open();
    return done(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<OutboxRecord[]>);
  }

  async put(records: OutboxRecord[]) {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const r of records) {
      // `add` fails on an existing key; that is the idempotent no-op we want.
      store.add(r).addEventListener("error", (e) => e.preventDefault());
    }
    await txDone(tx);
  }
  async pending(sessionId?: string) {
    return (await this.all())
      .filter((r) => r.state === "pending" && (!sessionId || r.sessionId === sessionId))
      .sort(byQueueOrder);
  }
  async quarantined() {
    return (await this.all()).filter((r) => r.state === "quarantined");
  }
  async remove(keys: string[]) {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    for (const k of keys) tx.objectStore(STORE).delete(k);
    await txDone(tx);
  }
  async pruneQuarantined(cutoff: number) {
    const stale = (await this.all())
      .filter((r) => r.state === "quarantined" && (r.quarantinedAt ?? 0) < cutoff)
      .map((r) => r.key);
    if (stale.length) await this.remove(stale);
  }
  async quarantine(keys: string[], reason: string, at: number) {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const k of keys) {
      const req = store.get(k);
      req.onsuccess = () => {
        const r = req.result as OutboxRecord | undefined;
        if (r) store.put({ ...r, state: "quarantined", reason, quarantinedAt: at });
      };
    }
    await txDone(tx);
  }
}
