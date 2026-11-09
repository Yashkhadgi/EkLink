// Starts the sync dispatcher loop (SYNC_CONTRACT.md section 5.1) in the Node.js
// runtime only. Guarded so dev-mode reloads never start a second interval.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const holder = globalThis as typeof globalThis & { __eklinkSyncTimer?: ReturnType<typeof setInterval> };
  if (holder.__eklinkSyncTimer) return;

  const seconds = Number(process.env.SYNC_DISPATCH_INTERVAL_SECONDS ?? 60);
  if (!Number.isFinite(seconds) || seconds <= 0) return; // 0 disables the loop

  const { dispatchPendingEvents } = await import("./lib/sync/events");
  const tick = () => {
    dispatchPendingEvents().catch((error: unknown) => {
      console.error("[sync] dispatch failed:", error instanceof Error ? error.message : error);
    });
  };
  holder.__eklinkSyncTimer = setInterval(tick, Math.max(5, seconds) * 1000);
  holder.__eklinkSyncTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
