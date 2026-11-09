import { Suspense } from "react";
import { UsersClient } from "./users-client";

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <UsersClient />
    </Suspense>
  );
}
