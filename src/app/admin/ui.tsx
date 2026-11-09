"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; data?: unknown };

const ERROR_TEXT: Record<string, string> = {
  admin_only: "Only admins can use the Admin Console.",
  super_admin_only: "Only a super admin can do this.",
  role_not_allowed: "You cannot give that role.",
  placement_out_of_scope: "That placement is outside your scope.",
  invalid_placement: "That organization / institute / department does not exist.",
  login_id_in_use: "That login ID is already in use.",
  email_in_use: "That email is already in use.",
  login_id_or_email_in_use: "That login ID or email is already in use.",
  cannot_edit_self: "You cannot change your own account here.",
  not_allowed: "You are not allowed to change this.",
  in_use: "It is still in use (people, sub-units or approver jobs).",
  code_in_use: "That code already exists here.",
  scope_not_allowed: "That scope is outside your own.",
  invalid_scope: "Pick a valid scope.",
  person_must_be_faculty_or_staff: "Approvers must be faculty or staff.",
  person_inactive: "That person is deactivated.",
  already_ended: "This job has already ended.",
  invalid_request: "Some fields are not valid.",
};

export function errorText(error: string) {
  return ERROR_TEXT[error] ?? error.replace(/_/g, " ");
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const issues = Array.isArray(data.issues)
        ? (data.issues as { path: string; message: string }[]).map((issue) => `${issue.path}: ${issue.message}`).join("; ")
        : "";
      const base = errorText(String(data.error ?? `HTTP ${response.status}`));
      return { ok: false, status: response.status, error: issues ? `${base} (${issues})` : base, data };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Network error" };
  }
}

/** Loads a GET endpoint; reload() refetches. */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!url,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state for a new request
    setState((previous) => ({ ...previous, loading: true }));
    api<T>(url).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { data: result.data, error: null, loading: false } : { data: null, error: result.error, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}

export const inputClass =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 disabled:text-slate-500";

export function Button({
  children,
  variant = "secondary",
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const styles = {
    primary: "bg-slate-950 text-white hover:bg-slate-800",
    secondary: "border border-slate-300 text-slate-700 hover:bg-slate-100",
    danger: "border border-rose-300 text-rose-700 hover:bg-rose-50",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-10" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" aria-label="Close">
            Close
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-rose-200 bg-rose-50 text-rose-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-slate-200 bg-slate-50 text-slate-700",
  }[kind];
  return <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" }) {
  const styles = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-800",
  }[tone];
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
      <span>
        {total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <div className="flex gap-2">
        <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function formatRole(role: string | null | undefined) {
  if (!role) return "—";
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// ---------------------------------------------------------------- directory data

export type DirOrg = { id: string; code: string; name: string; is_active: boolean; is_demo: boolean; people: number; can_manage: boolean; can_add_child: boolean };
export type DirInst = DirOrg & { organization_id: string };
export type DirDept = DirOrg & { institute_id: string };
export type Directory = {
  organizations: DirOrg[];
  institutes: DirInst[];
  departments: DirDept[];
  can_add_organization: boolean;
};

export type PlacementValue = { organization_id: string; institute_id: string; department_id: string };

/** Cascading organization → institute → department selects (ids; "" = none). */
export function PlacementSelect({
  directory,
  value,
  onChange,
  disabled,
  allowEmpty = true,
  levels = 3,
}: {
  directory: Directory | null;
  value: PlacementValue;
  onChange: (value: PlacementValue) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  levels?: 1 | 2 | 3;
}) {
  const institutes = (directory?.institutes ?? []).filter((inst) => inst.organization_id === value.organization_id);
  const departments = (directory?.departments ?? []).filter((dept) => dept.institute_id === value.institute_id);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Organization">
        <select
          className={inputClass}
          disabled={disabled}
          value={value.organization_id}
          onChange={(event) => onChange({ organization_id: event.target.value, institute_id: "", department_id: "" })}
        >
          {allowEmpty ? <option value="">—</option> : <option value="">Select…</option>}
          {(directory?.organizations ?? []).map((org) => (
            <option key={org.id} value={org.id}>
              {org.code} · {org.name}
            </option>
          ))}
        </select>
      </Field>
      {levels >= 2 ? (
        <Field label="Institute">
          <select
            className={inputClass}
            disabled={disabled || !value.organization_id}
            value={value.institute_id}
            onChange={(event) => onChange({ ...value, institute_id: event.target.value, department_id: "" })}
          >
            <option value="">—</option>
            {institutes.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.code} · {inst.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {levels >= 3 ? (
        <Field label="Department">
          <select
            className={inputClass}
            disabled={disabled || !value.institute_id}
            value={value.department_id}
            onChange={(event) => onChange({ ...value, department_id: event.target.value })}
          >
            <option value="">—</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.code} · {dept.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
  );
}

export const EMPTY_PLACEMENT: PlacementValue = { organization_id: "", institute_id: "", department_id: "" };

export function placementBody(value: PlacementValue) {
  return {
    organization_id: value.organization_id || null,
    institute_id: value.institute_id || null,
    department_id: value.department_id || null,
  };
}

export function codesOf(
  row: { organization?: { code: string } | null; institute?: { code: string } | null; department?: { code: string } | null },
) {
  return [row.organization?.code, row.institute?.code, row.department?.code].filter(Boolean).join(" / ") || "—";
}
