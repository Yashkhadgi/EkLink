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
  formatRole,
  inputClass,
  useApi,
  type Directory,
  type PlacementValue,
} from "../ui";

const TITLES = [
  "HOD",
  "Director",
  "Dean",
  "Class Teacher",
  "Mentor",
  "Course Faculty",
  "Exam Cell",
  "Admin Staff",
  "Event In-charge",
  "Other",
];

type Node = { code: string; name: string } | null;
type Job = {
  id: string;
  title: string;
  scope_level: "organization" | "institute" | "department";
  scope_key: string | null;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  can_manage: boolean;
  person: { id: string; login_id: string; name: string; platform_role: string | null; is_active: boolean } | null;
  organization: Node;
  institute: Node;
  department: Node;
};
type JobsPage = { items: Job[]; total: number; page: number; page_size: number };
type PersonHit = {
  id: string;
  login_id: string;
  name: string;
  platform_role: string | null;
  effective_member_type: string | null;
  is_active: boolean;
};

function AssignDialog({ directory, onClose, onDone }: { directory: Directory | null; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [person, setPerson] = useState<PersonHit | null>(null);
  const [title, setTitle] = useState("HOD");
  const [level, setLevel] = useState<"organization" | "institute" | "department">("department");
  const [placement, setPlacement] = useState<PlacementValue>(EMPTY_PLACEMENT);
  const [scopeKey, setScopeKey] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setError(null);
    const params = new URLSearchParams({ q: q.trim(), status: "active", page_size: "20" });
    const result = await api<{ items: PersonHit[] }>(`/api/admin/people?${params.toString()}`);
    if (!result.ok) return setError(result.error);
    setHits(result.data.items.filter((hit) => hit.effective_member_type === "faculty" || hit.effective_member_type === "staff"));
  }

  async function submit() {
    if (!person) return setError("Pick a person first.");
    setBusy(true);
    setError(null);
    const result = await api("/api/admin/approvers", {
      method: "POST",
      body: {
        profile_id: person.id,
        title,
        scope_level: level,
        organization_id: placement.organization_id || null,
        institute_id: placement.institute_id || null,
        department_id: placement.department_id || null,
        scope_key: scopeKey.trim() || null,
        valid_from: validFrom,
      },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone();
    onClose();
  }

  return (
    <Modal title="Assign an approver job" onClose={onClose}>
      <div className="space-y-2">
        <Field label="Person (faculty or staff)">
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="Search name, email or login ID"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void find();
                }
              }}
            />
            <Button onClick={() => void find()}>Find</Button>
          </div>
        </Field>
        {person ? (
          <Notice kind="info">
            Selected: <strong>{person.name}</strong> ({person.login_id}) · {formatRole(person.platform_role)}{" "}
            <button type="button" className="ml-2 underline" onClick={() => setPerson(null)}>
              change
            </button>
          </Notice>
        ) : hits ? (
          <ul className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
            {hits.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">No faculty or staff found.</li> : null}
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => setPerson(hit)}
                >
                  <span className="font-mono text-xs">{hit.login_id}</span> · {hit.name}{" "}
                  <span className="text-slate-500">({hit.effective_member_type})</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Job">
          <select className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)}>
            {TITLES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Scope">
          <select
            className={inputClass}
            value={level}
            onChange={(event) => setLevel(event.target.value as "organization" | "institute" | "department")}
          >
            <option value="organization">Organization</option>
            <option value="institute">Institute</option>
            <option value="department">Department</option>
          </select>
        </Field>
        <Field label="Starts">
          <input className={inputClass} type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
        </Field>
      </div>
      <PlacementSelect
        directory={directory}
        value={placement}
        onChange={setPlacement}
        allowEmpty={false}
        levels={level === "organization" ? 1 : level === "institute" ? 2 : 3}
      />
      <Field label="Scope key (optional)" hint="e.g. a class like 2024-28-A, or hackathon">
        <input className={inputClass} maxLength={64} value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} />
      </Field>
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !person} onClick={() => void submit()}>
          {busy ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </Modal>
  );
}

export function ApproversClient() {
  const directory = useApi<Directory>("/api/admin/directory");
  const [status, setStatus] = useState("current");
  const [page, setPage] = useState(1);
  const jobs = useApi<JobsPage>(`/api/admin/approvers?status=${status}&page=${page}`);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end(job: Job) {
    if (!window.confirm(`End ${job.title} for ${job.person?.name ?? "this person"}? History is kept.`)) return;
    setError(null);
    const result = await api(`/api/admin/approvers/${job.id}/end`, { method: "POST", body: {} });
    if (!result.ok) setError(result.error);
    jobs.reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approvers"
        description="Who holds which approver job. Ending a job keeps its history; the apps follow within seconds."
        actions={
          <Button variant="primary" onClick={() => setAssigning(true)}>
            Assign job
          </Button>
        }
      />
      <div className="flex flex-wrap gap-1">
        {["current", "upcoming", "ended", "all"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setPage(1);
              setStatus(value);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
              status === value ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      {error ? <Notice>{error}</Notice> : null}
      {jobs.error ? <Notice>{jobs.error}</Notice> : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Person</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(jobs.data?.items ?? []).map((job) => (
              <tr key={job.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-950">{job.title}</div>
                  {job.scope_key ? <div className="text-xs text-slate-500">key: {job.scope_key}</div> : null}
                </td>
                <td className="px-4 py-3">
                  {job.person ? (
                    <a className="hover:underline" href={`/admin/users?login_id=${encodeURIComponent(job.person.login_id)}`}>
                      {job.person.name} <span className="font-mono text-xs text-slate-500">{job.person.login_id}</span>
                    </a>
                  ) : (
                    "—"
                  )}
                  {job.person && !job.person.is_active ? (
                    <span className="ml-2">
                      <Badge tone="red">Deactivated</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className="capitalize">{job.scope_level}</span> · {codesOf(job)}
                </td>
                <td className="px-4 py-3 text-xs">
                  {job.valid_from} → {job.valid_to ?? "open"}{" "}
                  {job.is_current ? <Badge tone="green">current</Badge> : null}
                </td>
                <td className="px-4 py-3 text-right">
                  {job.can_manage && (job.valid_to === null || job.is_current || job.valid_from > new Date().toLocaleDateString("en-CA")) ? (
                    <Button variant="danger" onClick={() => void end(job)}>
                      End
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!jobs.loading && !jobs.data?.items.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No approver jobs.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {jobs.data ? <Pager page={jobs.data.page} pageSize={jobs.data.page_size} total={jobs.data.total} onPage={setPage} /> : null}
      {assigning ? <AssignDialog directory={directory.data} onClose={() => setAssigning(false)} onDone={jobs.reload} /> : null}
    </div>
  );
}
