import { getAdminActor } from "@/lib/admin/session";
import { formatPlatformRole } from "@/lib/placement";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AdminNav } from "./admin-nav";

export const instant = false;

async function AdminGate({ children }: { children: ReactNode }) {
  await connection();
  const actor = await getAdminActor();

  if (!actor) {
    return (
      <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl space-y-3 rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-2xl font-semibold text-slate-950">Admin Console</h1>
          <p className="text-sm text-slate-600">
            Your account does not have an admin role. Ask a super admin if you need access.
          </p>
          <a className="inline-flex rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100" href="/dashboard">
            Back to dashboard
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-950">Admin Console</span>
            <span className="mx-2 text-slate-300">|</span>
            {actor.name} · {formatPlatformRole(actor.platform_role)}
          </div>
          <AdminNav isSuperAdmin={actor.platform_role === "super_admin"} />
        </div>
        {children}
      </div>
    </main>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="flex-1 px-4 py-8">
          <p className="mx-auto max-w-6xl text-sm text-slate-500">Loading…</p>
        </main>
      }
    >
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
