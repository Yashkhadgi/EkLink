"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  formatDateTime,
  formatRole,
  inputClass,
  placementBody,
  useApi,
  type Directory,
  type PlacementValue,
} from "../ui";

const PLATFORM_ROLES = ["super_admin", "org_admin", "institute_admin", "department_admin", "faculty", "staff", "student"];
const LEGACY_ROLES = ["student", "faculty", "staff", "hod", "director", "finance", "admin"];
const ADMIN_ROLES = ["super_admin", "org_admin", "institute_admin", "department_admin"];

type Node = { code: string; name: string } | null;
export type Person = {
  id: string;
  login_id: string;
  college_email: string;
  name: string;
  role: string;
  platform_role: string | null;
  member_type: string | null;
  effective_member_type: string | null;
  batch: string | null;
  section: string | null;
  semester: number | null;
  designation: string | null;
  is_active: boolean;
  is_demo: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  updated_at: string;
  organization_id: string | null;
  institute_id: string | null;
  department_id: string | null;
  organization: Node;
  institute: Node;
  department: Node;
  can_manage: boolean;
};

type PeoplePage = { items: Person[]; total: number; page: number; page_size: number };
type Me = { actor: { id: string; platform_role: string }; assignable_roles: string[]; is_super_admin: boolean };
type Job = { id: string; title: string; scope_level: string; scope_key: string | null; valid_from: string; valid_to: string | null; is_current: boolean };

function TempPassword({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Notice kind="success">
      <p className="font-medium">Temporary password (shown only once):</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-sm text-slate-950">{value}</code>
        <Button
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-2 text-xs">The person must change it at first sign-in.</p>
    </Notice>
  );
}

function legacyDefault(platformRole: string) {
  return ["faculty", "staff", "student"].includes(platformRole) ? platformRole : "admin";
}

function CreateUserDialog({
  directory,
  me,
  onClose,
  onCreated,
}: {
  directory: Directory | null;
  me: Me;
  onClose: () => void;
  onCreated: () => void;
}) {
  const roles = me.assignable_roles;
  const [form, setForm] = useState({
    login_id: "",
    name: "",
    college_email: "",
    platform_role: roles.includes("student") ? "student" : (roles[0] ?? "student"),
    role: "",
    member_type: "",
    batch: "",
    section: "",
    semester: "",
    designation: "",
    is_demo: false,
  });
  const [placement, setPlacement] = useState<PlacementValue>(EMPTY_PLACEMENT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  const set = (key: keyof typeof form, value: string | boolean) => setForm((previous) => ({ ...previous, [key]: value }));
  const isAdminRole = ADMIN_ROLES.includes(form.platform_role);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await api<{ id: string; temporary_password: string }>("/api/admin/people", {
      method: "POST",
      body: {
        login_id: form.login_id,
        name: form.name,
        college_email: form.college_email,
        platform_role: form.platform_role,
        role: form.role || legacyDefault(form.platform_role),
        member_type: isAdminRole && form.member_type ? form.member_type : null,
        ...placementBody(placement),
        batch: form.batch || null,
        section: form.section || null,
        semester: form.semester ? Number(form.semester) : null,
        designation: form.designation || null,
        is_demo: form.is_demo,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPassword(result.data.temporary_password);
    onCreated();
  }

  return (
    <Modal title="Add a person" onClose={onClose}>
      {password ? (
        <>
          <TempPassword value={password} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Login ID" hint="PRN / staff ID. Locked after creation.">
              <input className={inputClass} required value={form.login_id} onChange={(event) => set("login_id", event.target.value)} />
            </Field>
            <Field label="Name">
              <input className={inputClass} required value={form.name} onChange={(event) => set("name", event.target.value)} />
            </Field>
            <Field label="College email">
              <input className={inputClass} type="email" required value={form.college_email} onChange={(event) => set("college_email", event.target.value)} />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={form.platform_role} onChange={(event) => set("platform_role", event.target.value)}>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {formatRole(role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Legacy role" hint="Old EkLink role used by ApproveIt routing.">
              <select className={inputClass} value={form.role} onChange={(event) => set("role", event.target.value)}>
                <option value="">Automatic ({legacyDefault(form.platform_role)})</option>
                {LEGACY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </Field>
            {isAdminRole ? (
              <Field label="Member type" hint="Optional for admins.">
                <select className={inputClass} value={form.member_type} onChange={(event) => set("member_type", event.target.value)}>
                  <option value="">None</option>
                  <option value="faculty">Faculty</option>
                  <option value="staff">Staff</option>
                  <option value="student">Student</option>
                </select>
              </Field>
            ) : null}
          </div>
          <PlacementSelect directory={directory} value={placement} onChange={setPlacement} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Batch" hint="e.g. 2024-28">
              <input className={inputClass} value={form.batch} onChange={(event) => set("batch", event.target.value)} />
            </Field>
            <Field label="Section">
              <input className={inputClass} maxLength={1} value={form.section} onChange={(event) => set("section", event.target.value.toUpperCase())} />
            </Field>
            <Field label="Semester">
              <input className={inputClass} type="number" min={1} max={12} value={form.semester} onChange={(event) => set("semester", event.target.value)} />
            </Field>
            <Field label="Designation">
              <input className={inputClass} value={form.designation} onChange={(event) => set("designation", event.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.is_demo} onChange={(event) => set("is_demo", event.target.checked)} />
            Demo account
          </label>
          {error ? <Notice>{error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditUserDialog({
  id,
  directory,
  me,
  onClose,
  onChanged,
}: {
  id: string;
  directory: Directory | null;
  me: Me;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useApi<{ person: Person; jobs: Job[]; assignable_roles: string[] }>(`/api/admin/people/${id}`);
  const person = detail.data?.person ?? null;
  const [draft, setDraft] = useState<Record<string, string | boolean> | null>(null);
  const [placement, setPlacement] = useState<PlacementValue | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [newLoginId, setNewLoginId] = useState("");
  const [busy, setBusy] = useState(false);

  const form = useMemo(
    () =>
      draft ??
      (person
        ? {
            name: person.name,
            role: person.role,
            platform_role: person.platform_role ?? "",
            member_type: person.member_type ?? "",
            batch: person.batch ?? "",
            section: person.section ?? "",
            semester: person.semester ? String(person.semester) : "",
            designation: person.designation ?? "",
            is_demo: person.is_demo,
          }
        : null),
    [draft, person],
  );
  const place =
    placement ??
    (person
      ? {
          organization_id: person.organization_id ?? "",
          institute_id: person.institute_id ?? "",
          department_id: person.department_id ?? "",
        }
      : EMPTY_PLACEMENT);

  const editable = !!person?.can_manage;
  const set = (key: string, value: string | boolean) => form && setDraft({ ...form, [key]: value });
  const roleOptions = person
    ? [...new Set([...(detail.data?.assignable_roles ?? []), ...(person.platform_role ? [person.platform_role] : [])])]
    : [];

  async function run(label: string, call: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (data: unknown) => void) {
    setBusy(true);
    setMessage(null);
    const result = await call();
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error ?? "Failed" });
      return;
    }
    setMessage({ kind: "success", text: label });
    after?.(result.data);
    setDraft(null);
    setPlacement(null);
    detail.reload();
    onChanged();
  }

  const save = () =>
    form &&
    run("Saved. The apps receive the change automatically.", () =>
      api("/api/admin/people/" + id, {
        method: "PATCH",
        body: {
          name: form.name,
          role: form.role,
          ...(form.platform_role && form.platform_role !== person?.platform_role ? { platform_role: form.platform_role } : {}),
          member_type: form.member_type || null,
          ...placementBody(place),
          batch: form.batch || null,
          section: form.section || null,
          semester: form.semester ? Number(form.semester) : null,
          designation: form.designation || null,
          is_demo: !!form.is_demo,
        },
      }),
    );

  return (
    <Modal title={person ? `${person.name} (${person.login_id})` : "Person"} onClose={onClose}>
      {detail.loading && !person ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {detail.error ? <Notice>{detail.error}</Notice> : null}
      {person && form ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge tone={person.is_active ? "green" : "red"}>{person.is_active ? "Active" : "Deactivated"}</Badge>
            {person.is_demo ? <Badge tone="amber">Demo</Badge> : null}
            {person.must_change_password ? <Badge>Must change password</Badge> : null}
            <Badge>Last sign-in: {formatDateTime(person.last_login_at)}</Badge>
          </div>
          {!editable ? (
            <Notice kind="info">You can view this person but not change them (outside your scope or not below your role).</Notice>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} disabled={!editable} value={String(form.name)} onChange={(event) => set("name", event.target.value)} />
            </Field>
            <Field label="College email" hint="Changed by a super admin in Supabase Auth only.">
              <input className={inputClass} disabled value={person.college_email} />
            </Field>
            <Field label="Role">
              <select className={inputClass} disabled={!editable} value={String(form.platform_role)} onChange={(event) => set("platform_role", event.target.value)}>
                {roleOptions.map((role) => (
                  <option key={role} value={role} disabled={!(detail.data?.assignable_roles ?? []).includes(role)}>
                    {formatRole(role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Legacy role">
              <select className={inputClass} disabled={!editable} value={String(form.role)} onChange={(event) => set("role", event.target.value)}>
                {LEGACY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Member type" hint={`Effective: ${person.effective_member_type ?? "none"}`}>
              <select className={inputClass} disabled={!editable} value={String(form.member_type)} onChange={(event) => set("member_type", event.target.value)}>
                <option value="">Automatic</option>
                <option value="faculty">Faculty</option>
                <option value="staff">Staff</option>
                <option value="student">Student</option>
              </select>
            </Field>
            <Field label="Designation">
              <input className={inputClass} disabled={!editable} value={String(form.designation)} onChange={(event) => set("designation", event.target.value)} />
            </Field>
          </div>
          <PlacementSelect directory={directory} value={place} onChange={setPlacement} disabled={!editable} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Batch">
              <input className={inputClass} disabled={!editable} value={String(form.batch)} onChange={(event) => set("batch", event.target.value)} />
            </Field>
            <Field label="Section">
              <input className={inputClass} disabled={!editable} maxLength={1} value={String(form.section)} onChange={(event) => set("section", event.target.value.toUpperCase())} />
            </Field>
            <Field label="Semester">
              <input className={inputClass} disabled={!editable} type="number" min={1} max={12} value={String(form.semester)} onChange={(event) => set("semester", event.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" disabled={!editable} checked={!!form.is_demo} onChange={(event) => set("is_demo", event.target.checked)} />
            Demo account
          </label>

          {detail.data?.jobs.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">Approver jobs</p>
              <ul className="space-y-1 text-sm text-slate-600">
                {detail.data.jobs.map((job) => (
                  <li key={job.id}>
                    {job.title} ({job.scope_level}
                    {job.scope_key ? `, ${job.scope_key}` : ""}) · {job.valid_from} → {job.valid_to ?? "open"}{" "}
                    {job.is_current ? <Badge tone="green">current</Badge> : <Badge>ended</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {password ? <TempPassword value={password} /> : null}
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {editable ? (
            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={person.is_active ? "danger" : "secondary"}
                  disabled={busy}
                  onClick={() => {
                    if (person.is_active && !window.confirm(`Deactivate ${person.login_id}? They are signed out of EkLink and the apps.`)) return;
                    void run(person.is_active ? "Deactivated." : "Reactivated.", () =>
                      api(`/api/admin/people/${id}/active`, { method: "POST", body: { active: !person.is_active } }),
                    );
                  }}
                >
                  {person.is_active ? "Deactivate" : "Reactivate"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Reset the password of ${person.login_id}? Their sessions end.`)) return;
                    void run(
                      "Password reset.",
                      () => api<{ temporary_password: string }>(`/api/admin/people/${id}/reset-password`, { method: "POST", body: {} }),
                      (data) => setPassword((data as { temporary_password: string }).temporary_password),
                    );
                  }}
                >
                  Reset password
                </Button>
              </div>
              <div className="flex gap-2">
                <Button onClick={onClose}>Close</Button>
                <Button variant="primary" disabled={busy} onClick={() => void save()}>
                  Save
                </Button>
              </div>
            </div>
          ) : null}

          {me.is_super_admin ? (
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <p className="text-sm font-medium text-slate-700">Fix login ID (super admin)</p>
              <p className="text-xs text-slate-500">
                Login IDs are locked. Only fix a wrongly entered ID; the apps re-key their records automatically.
              </p>
              <div className="flex gap-2">
                <input className={inputClass} placeholder={person.login_id} value={newLoginId} onChange={(event) => setNewLoginId(event.target.value)} />
                <Button
                  disabled={busy || !newLoginId.trim()}
                  onClick={() => {
                    if (!window.confirm(`Change login ID ${person.login_id} → ${newLoginId.trim()}?`)) return;
                    void run("Login ID changed.", () =>
                      api(`/api/admin/people/${id}/login-id`, { method: "POST", body: { login_id: newLoginId.trim() } }),
                    ).then(() => setNewLoginId(""));
                  }}
                >
                  Rename
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

function ImportUsersDialog({
  directory,
  onClose,
  onImported,
}: {
  directory: Directory | null;
  onClose: () => void;
  onImported: () => void;
}) {
  type PreviewRow = {
    rowNumber: number;
    login_id: string;
    name: string;
    college_email: string;
    role: string;
    status: "ready" | "skipped" | "error";
    reason?: string;
  };
  type PreviewResponse = {
    mode: "preview";
    total_rows: number;
    ready_count: number;
    skipped_count: number;
    error_count: number;
    rows: PreviewRow[];
  };
  type CreatedUser = {
    login_id: string;
    name: string;
    college_email: string;
    role: string;
    temporary_password: string;
  };
  type ApplyResponse = {
    mode: "apply";
    created_count: number;
    skipped_count: number;
    error_count: number;
    failed_count: number;
    created: CreatedUser[];
    failed: Array<{ login_id: string; college_email: string; reason: string }>;
  };

  const [file, setFile] = useState<File | null>(null);
  const [placement, setPlacement] = useState<PlacementValue>(EMPTY_PLACEMENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applied, setApplied] = useState<ApplyResponse | null>(null);

  function downloadSample() {
    const csv = [
      "login_id,name,college_email,role,batch,section,semester",
      "24070521991,Aarav Sharma,aarav.sharma@sitnagpur.siu.edu.in,student,2024-28,A,3",
      "24070521992,Priya Verma,priya.verma@sitnagpur.siu.edu.in,student,2024-28,B,3",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eklink-sample-users.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPasswordsCsv(rows: CreatedUser[]) {
    const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      "login_id,name,college_email,role,temporary_password",
      ...rows.map((r) => [cell(r.login_id), cell(r.name), cell(r.college_email), cell(r.role), cell(r.temporary_password)].join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eklink-temp-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runImport(mode: "preview" | "apply") {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    if (placement.organization_id) form.append("organization_id", placement.organization_id);
    if (placement.institute_id) form.append("institute_id", placement.institute_id);
    if (placement.department_id) form.append("department_id", placement.department_id);

    try {
      const response = await fetch("/api/admin/import", { method: "POST", body: form, cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(String(data.error ?? `Import failed (HTTP ${response.status})`));
        setBusy(false);
        return;
      }
      if (mode === "preview") {
        setPreview(data as unknown as PreviewResponse);
      } else {
        setApplied(data as unknown as ApplyResponse);
        onImported();
      }
    } catch {
      setError("Network error while importing file.");
    }
    setBusy(false);
  }

  return (
    <Modal title="Bulk import users (Excel / CSV)" onClose={onClose}>
      {error ? <Notice>{error}</Notice> : null}

      {applied ? (
        <div className="space-y-4">
          <Notice kind="success">
            <p className="font-medium">
              Created {applied.created_count} user{applied.created_count === 1 ? "" : "s"}!
            </p>
            <p className="mt-1 text-xs">
              Skipped existing/duplicate: {applied.skipped_count} · Invalid: {applied.error_count} · Failed:{" "}
              {applied.failed_count}
            </p>
          </Notice>

          {applied.created.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-600">
                  Temporary passwords are shown once below. Download the CSV before closing.
                </p>
                <Button variant="primary" onClick={() => downloadPasswordsCsv(applied.created)}>
                  Download Passwords CSV
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Login ID</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Temp Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applied.created.map((u) => (
                      <tr key={u.login_id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-mono">{u.login_id}</td>
                        <td className="px-3 py-1.5">{u.name}</td>
                        <td className="px-3 py-1.5 font-mono font-medium text-slate-950">{u.temporary_password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <span>Upload an .xlsx or .csv sheet with columns: login_id, name, college_email, role, batch, section.</span>
            <Button onClick={downloadSample}>Sample CSV</Button>
          </div>

          <Field label="Spreadsheet (.xlsx or .csv)">
            <input
              type="file"
              accept=".xlsx,.csv"
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setError(null);
              }}
            />
          </Field>

          <PlacementSelect directory={directory} value={placement} onChange={setPlacement} />

          {preview ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="green">Ready: {preview.ready_count}</Badge>
                <Badge tone="amber">Skipped: {preview.skipped_count}</Badge>
                <Badge tone="red">Errors: {preview.error_count}</Badge>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2.5 py-2">Row</th>
                      <th className="px-2.5 py-2">Login ID</th>
                      <th className="px-2.5 py-2">Name</th>
                      <th className="px-2.5 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={`${r.rowNumber}-${r.login_id}`} className="border-t border-slate-100">
                        <td className="px-2.5 py-1.5 text-slate-400">{r.rowNumber}</td>
                        <td className="px-2.5 py-1.5 font-mono">{r.login_id || "—"}</td>
                        <td className="px-2.5 py-1.5">{r.name || "—"}</td>
                        <td className="px-2.5 py-1.5">
                          {r.status === "ready" ? (
                            <Badge tone="green">Ready ({r.role})</Badge>
                          ) : (
                            <Badge tone={r.status === "skipped" ? "amber" : "red"}>{r.reason}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !file} onClick={() => void runImport("preview")}>
              {busy ? "Checking…" : "Preview"}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !preview || preview.ready_count === 0}
              onClick={() => void runImport("apply")}
            >
              {busy ? "Importing…" : `Import ${preview?.ready_count ?? 0} users`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function UsersClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const deepLoginId = searchParams.get("login_id");

  const me = useApi<Me>("/api/admin/me");
  const directory = useApi<Directory>("/api/admin/directory");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ platform_role: "", status: "all" });
  const [placement, setPlacement] = useState<PlacementValue>(EMPTY_PLACEMENT);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deepError, setDeepError] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), page_size: "25", status: filters.status });
  if (search) params.set("q", search);
  if (filters.platform_role) params.set("platform_role", filters.platform_role);
  for (const [key, value] of Object.entries(placement)) if (value) params.set(key, value);
  const list = useApi<PeoplePage>(`/api/admin/people?${params.toString()}`);

  // ?login_id=… (linked from TemplateOS / ApproveIt) opens that person.
  useEffect(() => {
    if (!deepLoginId) return;
    let cancelled = false;
    api<PeoplePage>(`/api/admin/people?login_id=${encodeURIComponent(deepLoginId)}`).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data.items[0]) setOpenId(result.data.items[0].id);
      else setDeepError(result.ok ? `No person with login ID ${deepLoginId} in your scope.` : result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [deepLoginId]);

  function closeDialog() {
    setOpenId(null);
    if (deepLoginId) router.replace(pathname);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="People, roles and placement. Changes reach TemplateOS and ApproveIt automatically."
        actions={
          me.data && me.data.assignable_roles.length ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setImporting(true)}>Import Excel / CSV</Button>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add person
              </Button>
            </div>
          ) : null
        }
      />

      <form
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(q.trim());
        }}
      >
        <div className="flex gap-2">
          <input className={inputClass} placeholder="Search name, email or login ID" value={q} onChange={(event) => setQ(event.target.value)} />
          <Button type="submit" variant="primary">
            Search
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[3fr_1fr_1fr]">
          <PlacementSelect
            directory={directory.data}
            value={placement}
            onChange={(value) => {
              setPage(1);
              setPlacement(value);
            }}
          />
          <Field label="Role">
            <select
              className={inputClass}
              value={filters.platform_role}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, platform_role: event.target.value });
              }}
            >
              <option value="">All roles</option>
              {PLATFORM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {formatRole(role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className={inputClass}
              value={filters.status}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, status: event.target.value });
              }}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
          </Field>
        </div>
      </form>

      {deepError ? <Notice>{deepError}</Notice> : null}
      {list.error ? <Notice>{list.error}</Notice> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Login ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Placement</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((person) => (
              <tr key={person.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{person.login_id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-950">{person.name}</div>
                  <div className="text-xs text-slate-500">{person.college_email}</div>
                </td>
                <td className="px-4 py-3">
                  {formatRole(person.platform_role)}
                  <div className="text-xs text-slate-500">{person.role}</div>
                </td>
                <td className="px-4 py-3 text-xs">{codesOf(person)}</td>
                <td className="px-4 py-3 text-xs">
                  {[person.batch, person.section, person.semester ? `Sem ${person.semester}` : null].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={person.is_active ? "green" : "red"}>{person.is_active ? "Active" : "Deactivated"}</Badge>
                    {person.is_demo ? <Badge tone="amber">Demo</Badge> : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button onClick={() => setOpenId(person.id)}>{person.can_manage ? "Edit" : "View"}</Button>
                </td>
              </tr>
            ))}
            {!list.loading && !list.data?.items.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No people found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {list.data ? <Pager page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} /> : null}

      {creating && me.data ? (
        <CreateUserDialog directory={directory.data} me={me.data} onClose={() => setCreating(false)} onCreated={list.reload} />
      ) : null}
      {importing && me.data ? (
        <ImportUsersDialog directory={directory.data} onClose={() => setImporting(false)} onImported={list.reload} />
      ) : null}
      {openId && me.data ? (
        <EditUserDialog id={openId} directory={directory.data} me={me.data} onClose={closeDialog} onChanged={list.reload} />
      ) : null}
    </div>
  );
}
