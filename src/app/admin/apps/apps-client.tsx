"use client";

import { useState } from "react";
import { Badge, Button, Notice, PageHeader, api, formatDateTime, useApi } from "../ui";

type SyncApp = {
  id: string;
  slug: string;
  name: string;
  client_id: string;
  is_active: boolean;
  status: string;
  sync_url: string | null;
  allowed_roles: string[];
  allowed_platform_roles: string[] | null;
  counts: { pending: number; failed: number; delivered: number };
  oldest_failure: { event_id: number; attempts: number; last_error: string | null; next_attempt_at: string | null } | null;
  last_delivery: { event_id: number; delivered_at: string | null } | null;
};

type DispatchResult = { app: string; sent: number; ok: boolean; error?: string };

export function AppsClient() {
  const apps = useApi<{ apps: SyncApp[]; last_event_id: number }>("/api/admin/apps");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(app: SyncApp) {
    setBusy(app.id);
    setMessage(null);
    const result = await api<{ requeued: number; results?: DispatchResult[]; dispatch_error?: string }>(
      `/api/admin/apps/${app.id}/retry`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
    } else {
      const own = result.data.results?.find((entry) => entry.app === app.slug);
      setMessage(
        own && !own.ok
          ? { kind: "error", text: `${app.name}: requeued ${result.data.requeued}; push failed: ${own.error}` }
          : { kind: "success", text: `${app.name}: requeued ${result.data.requeued}, sent ${own?.sent ?? 0}.` },
      );
    }
    apps.reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Apps & Sync"
        description={`Registered apps and the delivery of change messages${
          apps.data ? ` (latest event #${apps.data.last_event_id})` : ""
        }. Failed pushes retry after 1, 5, 15, 60 minutes, then hourly; apps also pull every 15 minutes.`}
        actions={<Button onClick={apps.reload}>Refresh</Button>}
      />
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
      {apps.error ? <Notice>{apps.error}</Notice> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {(apps.data?.apps ?? []).map((app) => (
          <article key={app.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{app.name}</h2>
                <p className="font-mono text-xs text-slate-500">{app.client_id}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <Badge tone={app.is_active ? "green" : "red"}>{app.is_active ? "Active" : "Inactive"}</Badge>
                <Badge>{app.status === "live" ? "Live" : "Coming soon"}</Badge>
              </div>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-slate-500">Push URL</dt>
                <dd className="break-all text-slate-950">{app.sync_url ?? "— (no pushes)"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-slate-500">Access</dt>
                <dd className="text-slate-950">
                  {(app.allowed_platform_roles?.length ? app.allowed_platform_roles : app.allowed_roles).join(", ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-slate-500">Last sent</dt>
                <dd className="text-slate-950">
                  {app.last_delivery
                    ? `#${app.last_delivery.event_id} · ${formatDateTime(app.last_delivery.delivered_at)}`
                    : "—"}
                </dd>
              </div>
            </dl>
            {app.sync_url ? (
              <div className="flex flex-wrap gap-2">
                <Badge tone={app.counts.pending ? "amber" : "slate"}>Pending {app.counts.pending}</Badge>
                <Badge tone={app.counts.failed ? "red" : "slate"}>Failed {app.counts.failed}</Badge>
                <Badge tone="green">Delivered {app.counts.delivered}</Badge>
              </div>
            ) : null}
            {app.oldest_failure ? (
              <Notice>
                <p>
                  Event #{app.oldest_failure.event_id}: {app.oldest_failure.attempts} attempt(s); next try{" "}
                  {formatDateTime(app.oldest_failure.next_attempt_at)}.
                </p>
                {app.oldest_failure.last_error ? (
                  <p className="mt-1 break-all font-mono text-xs">{app.oldest_failure.last_error}</p>
                ) : null}
              </Notice>
            ) : null}
            {app.sync_url ? (
              <Button disabled={busy === app.id} onClick={() => void retry(app)}>
                {busy === app.id ? "Sending…" : app.counts.failed ? "Retry failed" : "Send pending now"}
              </Button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
