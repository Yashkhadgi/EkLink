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
  type DirOrg,
  type Directory,
} from "../ui";

type Level = "organization" | "institute" | "department";
const CHILD: Record<Level, Level | null> = { organization: "institute", institute: "department", department: null };

type Dialog =
  | { kind: "create"; level: Level; parentId?: string; parentLabel?: string }
  | { kind: "rename"; level: Level; node: DirOrg };

function NodeRow({
  level,
  node,
  depth,
  onAction,
  busy,
}: {
  level: Level;
  node: DirOrg;
  depth: number;
  onAction: (action: "toggle" | "rename" | "delete" | "add", level: Level, node: DirOrg) => void;
  busy: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
      style={{ paddingLeft: `${1 + depth * 1.5}rem` }}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-950">{node.code}</span>
          <span className="text-sm text-slate-950">{node.name}</span>
          <Badge>{level}</Badge>
          {!node.is_active ? <Badge tone="red">Inactive</Badge> : null}
          {node.is_demo ? <Badge tone="amber">Demo</Badge> : null}
        </div>
        <p className="text-xs text-slate-500">{node.people} people</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {node.can_add_child && CHILD[level] ? (
          <Button disabled={busy} onClick={() => onAction("add", level, node)}>
            Add {CHILD[level]}
          </Button>
        ) : null}
        {node.can_manage ? (
          <>
            <Button disabled={busy} onClick={() => onAction("rename", level, node)}>
              Rename
            </Button>
            <Button disabled={busy} onClick={() => onAction("toggle", level, node)}>
              {node.is_active ? "Deactivate" : "Activate"}
            </Button>
            {node.people === 0 ? (
              <Button variant="danger" disabled={busy} onClick={() => onAction("delete", level, node)}>
                Delete
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function NodeDialog({ dialog, onClose, onDone }: { dialog: Dialog; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(dialog.kind === "rename" ? dialog.node.name : "");
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result =
      dialog.kind === "create"
        ? await api("/api/admin/directory", {
            method: "POST",
            body: { level: dialog.level, parent_id: dialog.parentId, code, name, is_demo: isDemo },
          })
        : await api(`/api/admin/directory/${dialog.level}/${dialog.node.id}`, { method: "PATCH", body: { name } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    onClose();
  }

  const title =
    dialog.kind === "create"
      ? `New ${dialog.level}${dialog.parentLabel ? ` in ${dialog.parentLabel}` : ""}`
      : `Rename ${dialog.node.code}`;

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {dialog.kind === "create" ? (
          <Field label="Code" hint="Upper-case A-Z, 0-9 and -, max 32. Codes link the apps and cannot be changed later.">
            <input className={inputClass} required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
          </Field>
        ) : null}
        <Field label="Name">
          <input className={inputClass} required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        {dialog.kind === "create" ? (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isDemo} onChange={(event) => setIsDemo(event.target.checked)} />
            Demo data
          </label>
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DirectoryClient() {
  const directory = useApi<Directory>("/api/admin/directory");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onAction(action: "toggle" | "rename" | "delete" | "add", level: Level, node: DirOrg) {
    setError(null);
    if (action === "rename") return setDialog({ kind: "rename", level, node });
    if (action === "add") {
      const child = CHILD[level];
      if (child) setDialog({ kind: "create", level: child, parentId: node.id, parentLabel: node.code });
      return;
    }
    if (action === "delete" && !window.confirm(`Delete ${level} ${node.code}? Only possible when nothing uses it.`)) return;
    if (action === "toggle" && node.is_active && !window.confirm(`Deactivate ${level} ${node.code}?`)) return;
    setBusy(true);
    const result =
      action === "delete"
        ? await api(`/api/admin/directory/${level}/${node.id}`, { method: "DELETE" })
        : await api(`/api/admin/directory/${level}/${node.id}`, { method: "PATCH", body: { is_active: !node.is_active } });
    setBusy(false);
    if (!result.ok) setError(result.error);
    directory.reload();
  }

  const data = directory.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Directory"
        description="Organizations → institutes → departments. Codes are shared with every app."
        actions={
          data?.can_add_organization ? (
            <Button variant="primary" onClick={() => setDialog({ kind: "create", level: "organization" })}>
              Add organization
            </Button>
          ) : null
        }
      />
      {error ? <Notice>{error}</Notice> : null}
      {directory.error ? <Notice>{directory.error}</Notice> : null}
      {directory.loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data ? (
        <div className="space-y-4">
          {data.organizations.map((org) => (
            <div key={org.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <NodeRow level="organization" node={org} depth={0} onAction={onAction} busy={busy} />
              {data.institutes
                .filter((inst) => inst.organization_id === org.id)
                .map((inst) => (
                  <div key={inst.id}>
                    <NodeRow level="institute" node={inst} depth={1} onAction={onAction} busy={busy} />
                    {data.departments
                      .filter((dept) => dept.institute_id === inst.id)
                      .map((dept) => (
                        <NodeRow key={dept.id} level="department" node={dept} depth={2} onAction={onAction} busy={busy} />
                      ))}
                  </div>
                ))}
            </div>
          ))}
        </div>
      ) : null}
      {dialog ? <NodeDialog dialog={dialog} onClose={() => setDialog(null)} onDone={directory.reload} /> : null}
    </div>
  );
}
