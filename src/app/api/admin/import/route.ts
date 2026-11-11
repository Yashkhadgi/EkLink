import { resolvePlacement } from "@/lib/admin/placement";
import {
  canAssignRole,
  inScope,
  isPlatformRole,
  legacyRoleFor,
  type PlatformRole,
} from "@/lib/admin/scope";
import {
  auditContext,
  dispatchAfterResponse,
  isUuid,
  json,
  jsonError,
  requireAdmin,
} from "@/lib/admin/session";
import { platformRoleOf } from "@/lib/auth/oauth";
import { createUser } from "@/lib/provisioning";
import { writeAuditLog } from "@/lib/security/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { Readable } from "node:stream";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;
const CONCURRENCY = 4;

const LEGACY_ROLES = new Set(["student", "faculty", "staff", "hod", "director", "finance", "admin"]);
const ROLE_ALIASES: Record<string, string> = { "deputy director": "faculty" };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (obj.text !== undefined) return cellText(obj.text);
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r) => String((r as { text?: unknown }).text ?? "")).join("");
    }
    if (obj.result !== undefined) return cellText(obj.result);
    if (v instanceof Date) return v.toISOString();
    return "";
  }
  return String(v);
}

const clean = (v: unknown) => cellText(v).replace(/\s+/g, " ").trim();
const normalizeHeader = (v: unknown) =>
  clean(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

type RawRow = {
  rowNumber: number;
  loginId: string;
  name: string;
  email: string;
  role: string;
  batch: string;
  section: string;
  semester: string;
  department: string;
  designation: string;
};

type ParsedRecord = {
  rowNumber: number;
  loginId: string;
  name: string;
  email: string;
  role: "student" | "faculty" | "staff" | "hod" | "director" | "finance" | "admin";
  platformRole: PlatformRole;
  batch: string;
  section: string;
  semester: number | null;
  department: string | null;
  designation: string | null;
};

function findCol(idx: Record<string, number>, aliases: string[], fallback?: number) {
  for (const alias of aliases) {
    if (idx[alias]) return idx[alias];
  }
  return fallback ?? 0;
}

async function parseWorksheet(file: File): Promise<RawRow[]> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();

  if (name.endsWith(".csv")) {
    await wb.csv.read(Readable.from(buffer));
  } else if (name.endsWith(".xlsx")) {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } else {
    throw new Error("unsupported_file_type");
  }

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("empty_workbook");

  let headerRow = 0;
  const headerIdx: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 6) && !headerRow; r++) {
    const names: Array<[string, number]> = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
      const h = normalizeHeader(cell.value);
      if (h) names.push([h, c]);
    });
    const hasKeyHeader = names.some(([n]) =>
      ["role", "platform_role", "login_id", "prn", "email", "college_email"].includes(n),
    );
    if (hasKeyHeader) {
      headerRow = r;
      for (const [n, c] of names) {
        if (!(n in headerIdx)) headerIdx[n] = c;
      }
    }
  }

  if (!headerRow) throw new Error("header_not_found");

  const cLogin = findCol(headerIdx, ["login_id", "prn", "loginid", "roll_no", "roll_number", "employee_id", "id"], 1);
  const cName = findCol(headerIdx, ["name", "full_name", "student_name", "faculty_name"], 2);
  const cEmail = findCol(headerIdx, ["college_email", "email", "college_mail", "mail"], 3);
  const cRole = findCol(headerIdx, ["role", "platform_role"]);
  const cBatch = findCol(headerIdx, ["batch"]);
  const cSection = findCol(headerIdx, ["section"]);
  const cSemester = findCol(headerIdx, ["semester", "sem"]);
  const cDepartment = findCol(headerIdx, ["department", "dept"]);
  const cDesignation = findCol(headerIdx, ["designation"]);

  const rows: RawRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c: number) => (c ? clean(row.getCell(c).value) : "");
    const raw: RawRow = {
      rowNumber: r,
      loginId: get(cLogin),
      name: get(cName),
      email: get(cEmail),
      role: cRole ? get(cRole) : "student",
      batch: get(cBatch),
      section: get(cSection),
      semester: get(cSemester),
      department: get(cDepartment),
      designation: get(cDesignation),
    };
    const isEmpty = !raw.loginId && !raw.name && !raw.email;
    if (isEmpty) continue;
    rows.push(raw);
    if (rows.length > MAX_ROWS) throw new Error("too_many_rows");
  }

  return rows;
}

async function fetchExistingLookups() {
  const admin = createAdminClient();
  const logins = new Set<string>();
  const emails = new Set<string>();

  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("profiles").select("login_id, college_email").range(from, from + 999);
    if (error) throw new Error("existing_lookup_failed");
    for (const p of data ?? []) {
      if (p.login_id) logins.add(p.login_id.trim());
      if (p.college_email) emails.add(p.college_email.trim().toLowerCase());
    }
    if (!data || data.length < 1000) break;
  }

  return { logins, emails };
}

function validateRow(
  raw: RawRow,
  actorPlatformRole: string | null,
  existingLogins: Set<string>,
  existingEmails: Set<string>,
  seenLogins: Set<string>,
  seenEmails: Set<string>,
): { status: "ready"; record: ParsedRecord } | { status: "skipped" | "error"; reason: string } {
  const loginId = raw.loginId.trim();
  const name = raw.name.trim();
  const email = raw.email.replace(/\s+/g, "").toLowerCase();
  const roleKey = (raw.role || "student").toLowerCase();
  const mappedRole = ROLE_ALIASES[roleKey] ?? roleKey;

  if (!loginId) return { status: "error", reason: "Missing login_id / PRN" };
  if (!name) return { status: "error", reason: "Missing name" };
  if (!EMAIL_RE.test(email)) return { status: "error", reason: "Invalid email" };

  let legacyRole: ParsedRecord["role"];
  let platformRole: PlatformRole;

  if (isPlatformRole(mappedRole)) {
    platformRole = mappedRole;
    legacyRole = legacyRoleFor(mappedRole);
  } else if (LEGACY_ROLES.has(mappedRole)) {
    legacyRole = mappedRole as ParsedRecord["role"];
    const derived = platformRoleOf(legacyRole, null);
    if (!isPlatformRole(derived)) return { status: "error", reason: `Unsupported role: ${raw.role}` };
    platformRole = derived;
  } else {
    return { status: "error", reason: `Unknown role: ${raw.role}` };
  }

  if (!canAssignRole({ platform_role: actorPlatformRole }, platformRole)) {
    return { status: "error", reason: `Not permitted to assign role "${platformRole}"` };
  }

  const batch = raw.batch.trim();
  if (batch && !/^\d{4}-\d{2}$/.test(batch)) {
    return { status: "error", reason: `Invalid batch "${batch}" (expected YYYY-YY, e.g. 2024-28)` };
  }

  const section = raw.section.trim().toUpperCase();
  if (section && !/^[A-Z]$/.test(section)) {
    return { status: "error", reason: `Invalid section "${section}" (expected single letter A-Z)` };
  }

  let semester: number | null = null;
  if (raw.semester.trim()) {
    const parsedSem = Number.parseInt(raw.semester.trim(), 10);
    if (!Number.isInteger(parsedSem) || parsedSem < 1 || parsedSem > 12) {
      return { status: "error", reason: `Invalid semester "${raw.semester}" (expected 1-12)` };
    }
    semester = parsedSem;
  }

  if (existingLogins.has(loginId) || existingEmails.has(email)) {
    return { status: "skipped", reason: "Already registered in EkLink" };
  }
  if (seenLogins.has(loginId) || seenEmails.has(email)) {
    return { status: "skipped", reason: "Duplicate row in uploaded file" };
  }

  seenLogins.add(loginId);
  seenEmails.add(email);

  return {
    status: "ready",
    record: {
      rowNumber: raw.rowNumber,
      loginId,
      name,
      email,
      role: legacyRole,
      platformRole,
      batch,
      section,
      semester,
      department: raw.department.trim() || null,
      designation: raw.designation.trim() || null,
    },
  };
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard.response) return guard.response;
  const { actor } = guard;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "invalid_form_data");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError(400, "file_required");
  if (file.size === 0) return jsonError(400, "empty_file");
  if (file.size > MAX_FILE_BYTES) return jsonError(400, "file_too_large");

  const mode = String(formData.get("mode") ?? "preview");
  if (mode !== "preview" && mode !== "apply") return jsonError(400, "invalid_mode");

  const orgId = formData.get("organization_id")?.toString().trim() || null;
  const instId = formData.get("institute_id")?.toString().trim() || null;
  const deptId = formData.get("department_id")?.toString().trim() || null;

  for (const id of [orgId, instId, deptId]) {
    if (id && !isUuid(id)) return jsonError(400, "invalid_placement_id");
  }

  const placement = await resolvePlacement({
    organization_id: orgId,
    institute_id: instId,
    department_id: deptId,
  });
  if (placement === "invalid") return jsonError(400, "invalid_placement");
  if (!inScope(actor, placement)) return jsonError(403, "placement_out_of_scope");

  let rawRows: RawRow[];
  try {
    rawRows = await parseWorksheet(file);
  } catch (err) {
    const code = err instanceof Error ? err.message : "parse_failed";
    if (code === "unsupported_file_type") {
      return jsonError(400, "Please upload an .xlsx or .csv file.");
    }
    if (code === "header_not_found") {
      return jsonError(400, "Header row not found. Include columns like login_id, name, college_email, role.");
    }
    if (code === "too_many_rows") {
      return jsonError(400, `Maximum ${MAX_ROWS} rows per browser import.`);
    }
    return jsonError(400, "Could not parse uploaded spreadsheet.");
  }

  if (rawRows.length === 0) return jsonError(400, "No data rows found in spreadsheet.");

  const { logins: existingLogins, emails: existingEmails } = await fetchExistingLookups();
  const seenLogins = new Set<string>();
  const seenEmails = new Set<string>();

  const ready: ParsedRecord[] = [];
  const previewRows: Array<{
    rowNumber: number;
    login_id: string;
    name: string;
    college_email: string;
    role: string;
    status: "ready" | "skipped" | "error";
    reason?: string;
  }> = [];

  let skippedCount = 0;
  let errorCount = 0;

  for (const raw of rawRows) {
    const outcome = validateRow(
      raw,
      actor.platform_role,
      existingLogins,
      existingEmails,
      seenLogins,
      seenEmails,
    );

    if (outcome.status === "ready") {
      ready.push(outcome.record);
      previewRows.push({
        rowNumber: raw.rowNumber,
        login_id: outcome.record.loginId,
        name: outcome.record.name,
        college_email: outcome.record.email,
        role: outcome.record.platformRole,
        status: "ready",
      });
    } else {
      if (outcome.status === "skipped") skippedCount += 1;
      else errorCount += 1;
      previewRows.push({
        rowNumber: raw.rowNumber,
        login_id: raw.loginId,
        name: raw.name,
        college_email: raw.email,
        role: raw.role || "student",
        status: outcome.status,
        reason: outcome.reason,
      });
    }
  }

  if (mode === "preview") {
    return json({
      mode: "preview",
      total_rows: rawRows.length,
      ready_count: ready.length,
      skipped_count: skippedCount,
      error_count: errorCount,
      rows: previewRows.slice(0, 100),
    });
  }

  const audit = auditContext(request, actor);
  const created: Array<{
    login_id: string;
    name: string;
    college_email: string;
    role: string;
    temporary_password: string;
  }> = [];
  const failed: Array<{ login_id: string; college_email: string; reason: string }> = [];

  await runPool(ready, CONCURRENCY, async (rec) => {
    try {
      const res = await createUser(
        {
          login_id: rec.loginId,
          name: rec.name,
          college_email: rec.email,
          role: rec.role,
          platform_role: rec.platformRole,
          batch: rec.batch,
          section: rec.section,
          semester: rec.semester,
          department: rec.department ?? undefined,
          designation: rec.designation,
          organization_id: placement.organization_id,
          institute_id: placement.institute_id,
          department_id: placement.department_id,
        },
        audit,
      );
      created.push({
        login_id: rec.loginId,
        name: rec.name,
        college_email: rec.email,
        role: rec.platformRole,
        temporary_password: res.temporaryPassword,
      });
    } catch (err) {
      failed.push({
        login_id: rec.loginId,
        college_email: rec.email,
        reason: err instanceof Error ? err.message : "create_failed",
      });
    }
  });

  await writeAuditLog({
    ...audit,
    action: "bulk_import",
    target: file.name,
    details: {
      total_rows: rawRows.length,
      created_count: created.length,
      skipped_count: skippedCount,
      error_count: errorCount,
      failed_count: failed.length,
    },
  });

  dispatchAfterResponse();

  return json({
    mode: "apply",
    created_count: created.length,
    skipped_count: skippedCount,
    error_count: errorCount,
    failed_count: failed.length,
    created,
    failed,
  });
}
