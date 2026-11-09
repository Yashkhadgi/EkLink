// Run: node --test tests/
// Scoped admin rules of the Admin Console.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignableRoles,
  canAssignRole,
  canManageApproverScope,
  canManageDirectory,
  canManagePerson,
  deriveMemberType,
  inScope,
  isCurrentJob,
  scopeFilter,
} from "../src/lib/admin/scope.ts";

const ORG = "org-1";
const INST = "inst-1";
const DEPT = "dept-1";
const place = (organization_id, institute_id = null, department_id = null) => ({
  organization_id,
  institute_id,
  department_id,
});
const actor = (platform_role, placement) => ({ id: "me", platform_role, ...placement });

const superAdmin = actor("super_admin", place(null));
const orgAdmin = actor("org_admin", place(ORG));
const instAdmin = actor("institute_admin", place(ORG, INST));
const deptAdmin = actor("department_admin", place(ORG, INST, DEPT));
const faculty = actor("faculty", place(ORG, INST, DEPT));

test("role ladder: only roles strictly below (super admin: all)", () => {
  assert.equal(assignableRoles("super_admin").length, 7);
  assert.deepEqual(assignableRoles("org_admin"), ["institute_admin", "department_admin", "faculty", "staff", "student"]);
  assert.deepEqual(assignableRoles("institute_admin"), ["department_admin", "faculty", "staff", "student"]);
  assert.deepEqual(assignableRoles("department_admin"), ["faculty", "staff", "student"]);
  assert.deepEqual(assignableRoles("faculty"), []);
  assert.equal(canAssignRole(orgAdmin, "org_admin"), false);
  assert.equal(canAssignRole(deptAdmin, "department_admin"), false);
  assert.equal(canAssignRole(deptAdmin, "student"), true);
});

test("scope: own organization / institute / department only", () => {
  const sameDept = place(ORG, INST, DEPT);
  const otherDept = place(ORG, INST, "dept-2");
  const otherInst = place(ORG, "inst-2", "dept-3");
  const otherOrg = place("org-2", "inst-9", "dept-9");
  assert.equal(inScope(superAdmin, otherOrg), true);
  assert.equal(inScope(orgAdmin, otherInst), true);
  assert.equal(inScope(orgAdmin, otherOrg), false);
  assert.equal(inScope(instAdmin, otherDept), true);
  assert.equal(inScope(instAdmin, otherInst), false);
  assert.equal(inScope(deptAdmin, sameDept), true);
  assert.equal(inScope(deptAdmin, otherDept), false);
  assert.equal(inScope(faculty, sameDept), false);
  // An admin without a placement manages nobody.
  assert.equal(inScope(actor("department_admin", place(null)), place(null)), false);
});

test("people: in scope and of a lower role", () => {
  const student = { ...place(ORG, INST, DEPT), platform_role: "student" };
  const peerDeptAdmin = { ...place(ORG, INST, DEPT), platform_role: "department_admin" };
  assert.equal(canManagePerson(deptAdmin, student), true);
  assert.equal(canManagePerson(deptAdmin, peerDeptAdmin), false);
  assert.equal(canManagePerson(instAdmin, peerDeptAdmin), true);
  assert.equal(canManagePerson(faculty, student), false);
  assert.equal(canManagePerson(superAdmin, { ...place(null), platform_role: "super_admin" }), true);
});

test("query filter follows the scope", () => {
  assert.equal(scopeFilter(superAdmin), null);
  assert.deepEqual(scopeFilter(orgAdmin), { column: "organization_id", value: ORG });
  assert.deepEqual(scopeFilter(instAdmin), { column: "institute_id", value: INST });
  assert.deepEqual(scopeFilter(deptAdmin), { column: "department_id", value: DEPT });
  assert.equal(scopeFilter(faculty), "none");
});

test("directory: org = super only; institutes by org admin; departments by institute admin", () => {
  assert.equal(canManageDirectory(superAdmin, "organization", place(ORG)), true);
  assert.equal(canManageDirectory(orgAdmin, "organization", place(ORG)), false);
  assert.equal(canManageDirectory(orgAdmin, "institute", place(ORG, INST)), true);
  assert.equal(canManageDirectory(orgAdmin, "institute", place("org-2", "inst-2")), false);
  assert.equal(canManageDirectory(instAdmin, "institute", place(ORG, INST)), false);
  assert.equal(canManageDirectory(instAdmin, "department", place(ORG, INST, DEPT)), true);
  assert.equal(canManageDirectory(deptAdmin, "department", place(ORG, INST, DEPT)), false);
});

test("approver jobs: scope must lie inside the admin's scope", () => {
  assert.equal(canManageApproverScope(deptAdmin, "department", place(ORG, INST, DEPT)), true);
  assert.equal(canManageApproverScope(deptAdmin, "institute", place(ORG, INST)), false);
  assert.equal(canManageApproverScope(instAdmin, "institute", place(ORG, INST)), true);
  assert.equal(canManageApproverScope(instAdmin, "organization", place(ORG)), false);
  assert.equal(canManageApproverScope(orgAdmin, "organization", place(ORG)), true);
  assert.equal(canManageApproverScope(orgAdmin, "department", place("org-2", "i", "d")), false);
});

test("member_type derivation matches the contract", () => {
  assert.equal(deriveMemberType("faculty", "hod", null), "faculty");
  assert.equal(deriveMemberType("student", "student", null), "student");
  assert.equal(deriveMemberType("department_admin", "admin", "faculty"), "faculty");
  assert.equal(deriveMemberType("super_admin", "admin", null), null);
  assert.equal(deriveMemberType("org_admin", "finance", null), "staff");
  assert.equal(deriveMemberType("org_admin", "director", null), "faculty");
});

test("current job window", () => {
  assert.equal(isCurrentJob({ valid_from: "2026-01-01", valid_to: null }, "2026-11-09"), true);
  assert.equal(isCurrentJob({ valid_from: "2026-01-01", valid_to: "2026-11-09" }, "2026-11-09"), true);
  assert.equal(isCurrentJob({ valid_from: "2026-01-01", valid_to: "2026-11-08" }, "2026-11-09"), false);
  assert.equal(isCurrentJob({ valid_from: "2026-12-01", valid_to: null }, "2026-11-09"), false);
});
