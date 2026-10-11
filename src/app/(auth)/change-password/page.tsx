import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "./change-password-form";

export const instant = false;

export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  // Already changed it: nothing to do here.
  if (profile && !profile.must_change_password) {
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <section className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Choose a new password
          </h1>
          <p className="text-sm text-slate-600">
            {profile?.name ? `Welcome, ${profile.name}. ` : ""}
            Your account was given a temporary password. Set your own before continuing.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <ChangePasswordForm />
        </div>
      </section>
    </main>
  );
}