import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AppWindow,
  DoorOpen,
  FileText,
  Receipt,
  Stamp,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { LogoutButton } from "./logout-button";

export const instant = false;

type Profile = {
  name: string;
  role: string;
  department: string | null;
};

type AppStatus = "live" | "coming_soon";

type PortalApp = {
  slug: string;
  name: string;
  url: string;
  description: string | null;
  icon: string | null;
  allowed_roles: string[];
  status: AppStatus;
  is_active: boolean;
};

const iconMap: Record<string, LucideIcon> = {
  "door-open": DoorOpen,
  "file-text": FileText,
  receipt: Receipt,
  stamp: Stamp,
  "user-check": UserCheck,
};

const tileStyles = [
  "bg-cyan-100 text-cyan-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-indigo-100 text-indigo-700",
];

function getTileStyle(slug: string) {
  const sum = [...slug].reduce((total, char) => total + char.charCodeAt(0), 0);
  return tileStyles[sum % tileStyles.length];
}

function AppIcon({ icon, slug }: { icon: string | null; slug: string }) {
  const Icon = icon ? (iconMap[icon] ?? AppWindow) : AppWindow;
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${getTileStyle(slug)}`}
    >
      <Icon className="h-6 w-6" aria-hidden="true" strokeWidth={2} />
    </div>
  );
}

export default async function DashboardPage() {
  await connection();

  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = (await supabase
    .from("profiles")
    .select("name, role, department")
    .eq("id", user.id)
    .single()) as { data: Profile | null };

  if (!profile) {
    redirect("/login");
  }

  const { data: apps } = (await admin
    .from("apps")
    .select("slug, name, url, description, icon, allowed_roles, status, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true })) as { data: PortalApp[] | null };

  const visibleApps = (apps ?? []).filter((app) =>
    app.allowed_roles.includes(profile.role),
  );

  return (
    <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
              Welcome, {profile.name}
            </h1>
            <div className="flex flex-wrap gap-2 text-sm text-slate-600">
              <span className="rounded-md bg-slate-100 px-2 py-1 capitalize">
                {profile.role}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-1">
                {profile.department ?? "Department not set"}
              </span>
            </div>
          </div>
          <LogoutButton />
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Your apps</h2>
            <p className="text-sm text-slate-600">
              Open the tools available for your role.
            </p>
          </div>
          {visibleApps.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleApps.map((app) => {
                const isLive = app.status === "live";
                return (
                  <article
                    key={app.slug}
                    className={`flex min-h-48 flex-col rounded-lg border bg-white p-5 shadow-sm transition ${
                      isLive
                        ? "border-slate-200"
                        : "border-slate-200 opacity-70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <AppIcon icon={app.icon} slug={app.slug} />
                      {!isLive ? (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          Coming soon
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-5 min-w-0 space-y-2">
                      <h3 className="truncate text-lg font-semibold text-slate-950">
                        {app.name}
                      </h3>
                      <p className="truncate text-sm text-slate-600">
                        {app.description ?? "No description set"}
                      </p>
                    </div>
                    <div className="mt-auto pt-5">
                      {isLive ? (
                        <a
                          href={app.url}
                          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="inline-flex h-10 items-center justify-center rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-500">
                          Not available
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No apps are available for your role yet.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
