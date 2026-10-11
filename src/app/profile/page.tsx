import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export const instant = false;

type Profile = {
  name: string;
  login_id: string;
  college_email: string;
  role: string;
  department: string | null;
};

export default async function ProfilePage() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = (await supabase
    .from("profiles")
    .select("name, login_id, college_email, role, department")
    .eq("id", user.id)
    .single()) as { data: Profile | null };

  if (!profile) {
    redirect("/login");
  }

  const rows = [
    ["Name", profile.name],
    ["Login ID", profile.login_id],
    ["College email", profile.college_email],
    ["Role", profile.role],
    ["Department", profile.department ?? "Not set"],
  ];

  return (
    <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Profile
          </h1>
          <p className="text-sm text-slate-600">Your college identity record.</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {rows.map(([label, value]) => (
            <div
              className="grid gap-1 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:grid-cols-3"
              key={label}
            >
              <dt className="text-sm font-medium text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-950 sm:col-span-2">{value}</dd>
            </div>
          ))}
        </div>
        <Link
          className="inline-flex rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          href="/forgot-password"
        >
          Change password
        </Link>
      </section>
    </main>
  );
}
