import { Suspense } from "react";
import { DirectoryClient } from "./directory-client";

export default function AdminDirectoryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <DirectoryClient />
    </Suspense>
  );
}

