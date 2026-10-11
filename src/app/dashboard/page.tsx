import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LogoutButton } from "./logout-button";

export const instant = false;

type Profile = {
  name: string;
  role: string;
  department: string | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
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
            <p className="text-sm text-slate-600">Apps will appear here.</p>
          </div>
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Apps will appear here
          </div>
        </section>
      </div>
    </main>
  );
}
