"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Field,
  Modal,
  Notice,
  PageHeader,
  api,
  inputClass,
  useApi,
  type DirDept,
  type DirInst,
  type DirOrg,
  type Directory,
} from "../ui";

// ---------------------------------------------------------------- create dialog

function CreateDialog({
  directory,
  defaultLevel,
  defaultParentId,
  onClose,
  onCreated,
}: {
  directory: Directory;
  defaultLevel?: "organization" | "institute" | "department";
  defaultParentId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [level, setLevel] = useState<"organization" | "institute" | "department">(defaultLevel ?? "organization");
  const [parentId, setParentId] = useState(defaultParentId ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const institutes = directory.institutes.filter((i) => i.organization_id === parentId);

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { level, code: code.toUpperCase(), name, is_demo: isDemo };
    if (level !== "organization") body.parent_id = parentId;
    const result = await api("/api/admin/directory", { method: "POST", body });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onCreated();
    onClose();
  }

  return (
    <Modal title="Add directory node" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Level">
          <select
            className={inputClass}
            value={level}
            onChange={(e) => { setLevel(e.target.value as typeof level); setParentId(""); }}
            disabled={!!defaultLevel}
          >
            {directory.can_add_organization && <option value="organization">Organization</option>}
            <option value="institute">Institute</option>
            <option value="department">Department</option>
          </select>
        </Field>

        {level === "institute" && (
          <Field label="Parent organization">
            <select className={inputClass} value={parentId} onChange={(e) => setParentId(e.target.value)} required>
              <option value="">Select…</option>
              {directory.organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
              ))}
            </select>
          </Field>
        )}

        {level === "department" && (
          <>
            <Field label="Parent organization">
              <select className={inputClass} value={parentId} onChange={(e) => setParentId(e.target.value)} required>
                <option value="">Select…</option>
                {directory.organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Parent institute">
              <select className={inputClass} value={parentId} onChange={(e) => setParentId(e.target.value)} required>
                <option value="">Select…</option>
                {institutes.map((i) => (
                  <option key={i.id} value={i.id}>{i.code} · {i.name}</option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Short uppercase key, e.g. SIT or CSE">
            <input
              className={inputClass}
              required
              maxLength={32}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Name">
            <input className={inputClass} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} />
          Demo node
        </label>

        {error ? <Notice>{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- edit dialog

function EditDialog({
  level,
  node,
  onClose,
  onChanged,
}: {
  level: "organization" | "institute" | "department";
  node: DirOrg;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(node.name);
  const [isActive, setIsActive] = useState(node.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const result = await api(`/api/admin/directory/${level}/${node.id}`, {
      method: "PATCH",
      body: { name, is_active: isActive },
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSuccess("Saved.");
    onChanged();
  }

  async function del() {
    if (!confirm(`Delete ${node.code} (${node.name})? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const result = await api(`/api/admin/directory/${level}/${node.id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onChanged();
    onClose();
  }

  return (
    <Modal title={`${node.code} · ${node.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
        <div className="text-xs text-slate-500">Code <strong>{node.code}</strong> is permanent (used as a key across all apps).</div>
        {error ? <Notice>{error}</Notice> : null}
        {success ? <Notice kind="success">{success}</Notice> : null}
        <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
          <Button variant="danger" disabled={busy} onClick={() => void del()}>Delete</Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- node row

function NodeRow({
  level,
  node,
  indent,
  canManage,
  onEdit,
  onAddChild,
}: {
  level: "organization" | "institute" | "department";
  node: DirOrg;
  indent: number;
  canManage: boolean;
  onEdit: () => void;
  onAddChild?: () => void;
}) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
      <td className="px-4 py-3">
        <span style={{ paddingLeft: `${indent * 20}px` }} className="inline-block font-mono text-xs font-semibold text-slate-700">
          {node.code}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">{node.name}</td>
      <td className="px-4 py-3 text-xs text-slate-500 capitalize">{level}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{node.people}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <Badge tone={node.is_active ? "green" : "red"}>{node.is_active ? "Active" : "Inactive"}</Badge>
          {node.is_demo ? <Badge tone="amber">Demo</Badge> : null}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          {onAddChild && node.can_add_child ? (
            <Button onClick={onAddChild}>+ Add child</Button>
          ) : null}
          {canManage ? <Button onClick={onEdit}>Edit</Button> : null}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- main client

export function DirectoryClient() {
  const directory = useApi<Directory>("/api/admin/directory");
  const [creating, setCreating] = useState<{ level?: "organization" | "institute" | "department"; parentId?: string } | null>(null);
  const [editing, setEditing] = useState<{ level: "organization" | "institute" | "department"; node: DirOrg } | null>(null);

  const data = directory.data;

  // Build flat list in tree order: org → institutes of org → depts of institute
  type Row =
    | { level: "organization"; node: DirOrg }
    | { level: "institute"; node: DirInst }
    | { level: "department"; node: DirDept };

  const rows: Row[] = [];
  if (data) {
    for (const org of data.organizations) {
      rows.push({ level: "organization", node: org });
      const insts = data.institutes.filter((i) => i.organization_id === org.id);
      for (const inst of insts) {
        rows.push({ level: "institute", node: inst });
        const depts = data.departments.filter((d) => d.institute_id === inst.id);
        for (const dept of depts) {
          rows.push({ level: "department", node: dept });
        }
      }
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Directory"
        description="Organizations, institutes and departments. Changes sync to all apps automatically."
        actions={
          data?.can_add_organization ? (
            <Button variant="primary" onClick={() => setCreating({})}>Add node</Button>
          ) : null
        }
      />

      {directory.error ? <Notice>{directory.error}</Notice> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">People</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ level, node }) => (
              <NodeRow
                key={node.id}
                level={level}
                node={node}
                indent={level === "organization" ? 0 : level === "institute" ? 1 : 2}
                canManage={node.can_manage}
                onEdit={() => setEditing({ level, node })}
                onAddChild={
                  level !== "department"
                    ? () => setCreating({
                        level: level === "organization" ? "institute" : "department",
                        parentId: node.id,
                      })
                    : undefined
                }
              />
            ))}
            {!directory.loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No directory nodes yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {creating && data ? (
        <CreateDialog
          directory={data}
          defaultLevel={creating.level}
          defaultParentId={creating.parentId}
          onClose={() => setCreating(null)}
          onCreated={directory.reload}
        />
      ) : null}

      {editing ? (
        <EditDialog
          level={editing.level}
          node={editing.node}
          onClose={() => setEditing(null)}
          onChanged={directory.reload}
        />
      ) : null}
    </div>
  );
}

