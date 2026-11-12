import { Suspense } from "react";
import { ApproversClient } from "./approvers-client";

export default function AdminApproversPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <ApproversClient />
    </Suspense>
  );
}

