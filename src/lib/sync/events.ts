import "server-only";

import { signingMaterial } from "@/lib/auth/jwt";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_EVENTS_PER_PUSH, signEventsJwt, type SyncEvent } from "./event-jwt";

type SyncApp = { id: string; slug: string; client_id: string; sync_url: string };

type BatchRow = {
  delivery_id: number;
  event_id: number;
  type: string;
  at: string;
  data: Record<string, unknown>;
};

export type DispatchResult = {
  app: string;
  sent: number;
  ok: boolean;
  error?: string;
};

// Generous: an app may need well over 15 s to apply a batch against a remote
// database; timing out early only caused false "failed" deliveries and retries.
const PUSH_TIMEOUT_MS = 60_000;
// Safety cap: batches per app per run (MAX_EVENTS_PER_PUSH events each).
const MAX_BATCHES_PER_APP = 80;

type DispatchState = { running: Promise<DispatchResult[]> | null; again: boolean };

// Shared across module instances (route bundles + instrumentation) in one process.
const globalState = globalThis as typeof globalThis & { __eklinkSyncDispatch?: DispatchState };
function state(): DispatchState {
  globalState.__eklinkSyncDispatch ??= { running: null, again: false };
  return globalState.__eklinkSyncDispatch;
}

function toIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace(".000Z", "Z");
}

export function toSyncEvent(row: { id?: number; event_id?: number; type: string; at: string; data: Record<string, unknown> }): SyncEvent {
  return { id: Number(row.id ?? row.event_id), type: row.type, at: toIso(row.at), data: row.data };
}

async function syncApps(): Promise<SyncApp[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("apps")
    .select("id, slug, client_id, sync_url")
    .eq("is_active", true)
    .not("sync_url", "is", null);
  if (error) throw new Error(`apps_lookup_failed:${error.code ?? "error"}`);
  return (data ?? []) as SyncApp[];
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

async function pushBatch(app: SyncApp, rows: BatchRow[]) {
  const material = await signingMaterial();
  const events = rows.map(toSyncEvent);
  const token = await signEventsJwt({
    key: material.key,
    kid: material.kid,
    issuer: material.issuer,
    audience: app.client_id,
    events,
  });

  const response = await fetch(app.sync_url, {
    method: "POST",
    headers: { "content-type": "application/jwt", accept: "application/json" },
    body: token,
    cache: "no-store",
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // ignore unreadable bodies
    }
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

async function dispatchApp(app: SyncApp): Promise<DispatchResult> {
  const admin = createAdminClient();
  let sent = 0;
  for (let batchNo = 0; batchNo < MAX_BATCHES_PER_APP; batchNo += 1) {
    const { data, error } = (await admin.rpc("sync_next_batch", {
      p_app_id: app.id,
      p_limit: MAX_EVENTS_PER_PUSH,
    })) as { data: BatchRow[] | null; error: { code?: string } | null };
    if (error) return { app: app.slug, sent, ok: false, error: `batch_query_failed:${error.code ?? "error"}` };
    const rows = data ?? [];
    if (!rows.length) break;

    const ids = rows.map((row) => row.delivery_id);
    try {
      await pushBatch(app, rows);
    } catch (pushError) {
      const message = describeError(pushError);
      await admin.rpc("sync_mark_failed", { p_ids: ids, p_error: message });
      return { app: app.slug, sent, ok: false, error: message };
    }
    const marked = await admin.rpc("sync_mark_delivered", { p_ids: ids });
    if (marked.error) {
      return { app: app.slug, sent, ok: false, error: `mark_delivered_failed:${marked.error.code ?? "error"}` };
    }
    sent += rows.length;
    if (rows.length < MAX_EVENTS_PER_PUSH) break;
  }
  return { app: app.slug, sent, ok: true };
}

async function runOnce(): Promise<DispatchResult[]> {
  const apps = await syncApps();
  return Promise.all(apps.map((app) => dispatchApp(app)));
}

/**
 * Sends all due deliveries, per app in ascending event id (batches of <= 100).
 * Only one run at a time per process; a call during a run schedules one more run.
 */
export async function dispatchPendingEvents(): Promise<DispatchResult[]> {
  const current = state();
  if (current.running) {
    current.again = true;
    return current.running;
  }
  const run = (async () => {
    let results: DispatchResult[] = [];
    try {
      do {
        current.again = false;
        results = await runOnce();
      } while (current.again);
    } finally {
      current.running = null;
    }
    return results;
  })();
  current.running = run;
  return run;
}

/** Fire-and-forget dispatch (after admin mutations). Never throws. */
export function triggerDispatch() {
  dispatchPendingEvents().catch((error) => {
    console.error("[sync] dispatch failed:", describeError(error));
  });
}
