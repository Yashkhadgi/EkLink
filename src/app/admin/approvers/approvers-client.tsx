"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  EMPTY_PLACEMENT,
  Field,
  Modal,
  Notice,
  PageHeader,
  Pager,
  PlacementSelect,
  api,
  codesOf,
  inputClass,
  useApi,
  type Directory,
  type PlacementValue,
} from "../ui";
import { APPROVER_TITLES, SCOPE_LEVELS } from "@/lib/admin/scope";

// ---------------------------------------------------------------- types

type PersonStub = { id: string; login_id: string; name: string; platform_role: string | null; is_active: boolean };
type OrgStub = { code: string; name: string } | null;

type ApproverJob = {
  id: string;
  title: string;
  scope_level: string;
  scope_key: string | null;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  can_manage: boolean;
  person: PersonStub | null;
  organization: OrgStub;
  institute: OrgStub;
  department: OrgStub;
};

type JobsPage = { items: ApproverJob[]; total: number; page: number; page_size: number };
type Me = { actor: { id: string; platform_role: string }; is_super_admin: boolean };
type PeoplePage = { items: { id: string; login_id: string; name: string; platform_role: string | null }[] };

// ---------------------------------------------------------------- person search

function PersonSearch({
  onSelect,
}: {
  onSelect: (person: { id: string; login_id: string; name: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PeoplePage["items"]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    const result = await api<PeoplePage>(`/api/admin/people?q=${encodeURIComponent(q.trim())}&page_size=10&status=active`);
    setSearching(false);
    if (!result.ok) { setError(result.error); return; }
    setResults(result.data.items);
  }

  return (
    <div className="space-y-2">
      <Field label="Search person (faculty / staff only)">
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="Name, email or login ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          />
          <Button onClick={() => void search()} disabled={searching}>
            {searching ? "…" : "Search"}
          </Button>
        </div>
      </Field>
      {error ? <Notice>{error}</Notice> : null}
      {results.length > 0 && (
        <ul className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-48 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between items-center"
                onClick={() => { onSelect(p); setResults([]); setQ(""); }}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-slate-500 font-mono">{p.login_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- create dialog

function CreateDialog({
  directory,
  onClose,
  onCreated,
}: {
  directory: Directory | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [person, setPerson] = useState<{ id: string; login_id: string; name: string } | null>(null);
  const [title, setTitle] = useState<string>(APPROVER_TITLES[0]);
  const [scopeLevel, setScopeLevel] = useState<string>(SCOPE_LEVELS[0]);
  const [placement, setPlacement] = useState<PlacementValue>(EMPTY_PLACEMENT);
  const [scopeKey, setScopeKey] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levelsForScope = scopeLevel === "organization" ? 1 : scopeLevel === "institute" ? 2 : 3;

  async function submit() {
    if (!person) { setError("Select a person first."); return; }
    const idField =
      scopeLevel === "department"
        ? { department_id: placement.department_id || null }
        : scopeLevel === "institute"
          ? { institute_id: placement.institute_id || null }
          : { organization_id: placement.organization_id || null };

    setBusy(true);
    setError(null);
    const result = await api("/api/admin/approvers", {
      method: "POST",
      body: {
        profile_id: person.id,
        title,
        scope_level: scopeLevel,
        ...idField,
        scope_key: scopeKey.trim() || null,
        valid_from: validFrom,
      },
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onCreated();
    onClose();
  }

  return (
    <Modal title="Assign approver job" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        {person ? (
          <Notice kind="success">
            Selected: <strong>{person.name}</strong> ({person.login_id})
            <button type="button" className="ml-2 underline text-xs" onClick={() => setPerson(null)}>change</button>
          </Notice>
        ) : (
          <PersonSearch onSelect={setPerson} />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title">
            <select className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)}>
              {APPROVER_TITLES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Scope level">
            <select
              className={inputClass}
              value={scopeLevel}
              onChange={(e) => { setScopeLevel(e.target.value); setPlacement(EMPTY_PLACEMENT); }}
            >
              {SCOPE_LEVELS.map((l) => (
                <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
          </Field>
        </div>

        <PlacementSelect
          directory={directory}
          value={placement}
          onChange={setPlacement}
          allowEmpty={false}
          levels={levelsForScope as 1 | 2 | 3}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Scope key" hint="Optional sub-scope, e.g. 'hackathon'">
            <input className={inputClass} value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} />
          </Field>
          <Field label="Valid from">
            <input className={inputClass} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
        </div>

        {error ? <Notice>{error}</Notice> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Assigning…" : "Assign"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- end dialog

function EndDialog({
  job,
  onClose,
  onEnded,
}: {
  job: ApproverJob;
  onClose: () => void;
  onEnded: () => void;
}) {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [validTo, setValidTo] = useState(yesterday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await api(`/api/admin/approvers/${job.id}/end`, {
      method: "POST",
      body: { valid_to: validTo },
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onEnded();
    onClose();
  }

  return (
    <Modal title="End approver job" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          End <strong>{job.title}</strong> for{" "}
          <strong>{job.person?.name ?? job.person?.login_id ?? "unknown"}</strong>?
          The job record is kept for history.
        </p>
        <Field label="Last day of job">
          <input
            className={inputClass}
            type="date"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
          />
        </Field>
        {error ? <Notice>{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={() => void submit()}>
            {busy ? "Ending…" : "End job"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- status badge

function StatusBadge({ job }: { job: ApproverJob }) {
  if (job.is_current) {
    if (job.person && !job.person.is_active) {
      return <Badge tone="red">Person deactivated</Badge>;
    }
    return <Badge tone="green">Current</Badge>;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (job.valid_from > today) return <Badge tone="amber">Upcoming</Badge>;
  return <Badge tone="slate">Ended</Badge>;
}

// ---------------------------------------------------------------- main client

export function ApproversClient() {
  const me = useApi<Me>("/api/admin/me");
  const directory = useApi<Directory>("/api/admin/directory");
  const [status, setStatus] = useState("current");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<ApproverJob | null>(null);

  const params = new URLSearchParams({ status, page: String(page) });
  const list = useApi<JobsPage>(`/api/admin/approvers?${params.toString()}`);

  const canCreate = me.data?.actor && ["super_admin", "org_admin", "institute_admin", "department_admin"].includes(
    me.data.actor.platform_role
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approvers"
        description="Job-based approver assignments. Changes sync to ApproveIt automatically."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Assign job
            </Button>
          ) : null
        }
      />

      {/* filter bar */}
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3">
        {(["current", "upcoming", "ended", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatus(s); setPage(1); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              status === s
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {list.error ? <Notice>{list.error}</Notice> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Valid</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((job) => (
              <tr key={job.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-950">{job.person?.name ?? "—"}</div>
                  <div className="font-mono text-xs text-slate-500">{job.person?.login_id ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium">{job.title}</span>
                  {job.scope_key && (
                    <span className="ml-1 font-mono text-xs text-slate-500">[{job.scope_key}]</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="capitalize text-slate-700">{job.scope_level}</div>
                  <div className="text-slate-500">{codesOf(job)}</div>
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  {job.valid_from} → {job.valid_to ?? "open"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge job={job} />
                </td>
                <td className="px-4 py-3 text-right">
                  {job.can_manage && job.is_current ? (
                    <Button variant="danger" onClick={() => setEnding(job)}>
                      End
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!list.loading && !list.data?.items.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No approver jobs found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {list.data ? (
        <Pager
          page={list.data.page}
          pageSize={list.data.page_size}
          total={list.data.total}
          onPage={setPage}
        />
      ) : null}

      {creating ? (
        <CreateDialog
          directory={directory.data}
          onClose={() => setCreating(false)}
          onCreated={list.reload}
        />
      ) : null}

      {ending ? (
        <EndDialog
          job={ending}
          onClose={() => setEnding(null)}
          onEnded={list.reload}
        />
      ) : null}
    </div>
  );
}

