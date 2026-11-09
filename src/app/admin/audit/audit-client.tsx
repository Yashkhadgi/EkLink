"use client";

import { useState } from "react";
import { Button, Notice, PageHeader, Pager, formatDateTime, inputClass, useApi } from "../ui";

type Entry = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_login_id: string | null;
  action: string;
  target: string | null;
  target_login_id: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
};
type AuditPage = { items: Entry[]; total: number; page: number; page_size: number; scope: "all" | "own" };

export function AuditClient() {
  const [page, setPage] = useState(1);
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState("");
  const params = new URLSearchParams({ page: String(page) });
  if (action) params.set("action", action);
  const audit = useApi<AuditPage>(`/api/admin/audit?${params.toString()}`);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description={
          audit.data?.scope === "own"
            ? "Actions you made in EkLink."
            : "Every sign-in, token and admin action in EkLink, newest first."
        }
      />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setAction(actionInput.trim().toLowerCase());
        }}
      >
        <input
          className={inputClass}
          placeholder="Filter by action, e.g. user_updated, login_fail"
          value={actionInput}
          onChange={(event) => setActionInput(event.target.value)}
        />
        <Button type="submit" variant="primary">
          Filter
        </Button>
      </form>
      {audit.error ? <Notice>{audit.error}</Notice> : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data?.items ?? []).map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 align-top last:border-b-0">
                <td className="whitespace-nowrap px-4 py-2 text-xs">{formatDateTime(entry.at)}</td>
                <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                <td className="px-4 py-2 text-xs">{entry.actor_login_id ?? (entry.actor_id ? entry.actor_id.slice(0, 8) : "—")}</td>
                <td className="px-4 py-2 text-xs">{entry.target_login_id ?? entry.target ?? "—"}</td>
                <td className="max-w-md break-all px-4 py-2 font-mono text-xs text-slate-600">
                  {entry.details ? JSON.stringify(entry.details) : ""}
                </td>
              </tr>
            ))}
            {!audit.loading && !audit.data?.items.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No entries.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {audit.data ? <Pager page={audit.data.page} pageSize={audit.data.page_size} total={audit.data.total} onPage={setPage} /> : null}
    </div>
  );
}
