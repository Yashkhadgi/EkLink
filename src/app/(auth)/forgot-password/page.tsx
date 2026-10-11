import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <section className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Reset your password
          </h1>
          <p className="text-sm text-slate-600">
            Enter your PRN or college email and check your mailbox.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <ForgotForm />
        </div>
        <p className="text-center text-sm text-slate-600">
          <Link className="font-medium text-slate-950 underline-offset-4 hover:underline" href="/login">
            Back to login
          </Link>
        </p>
      </section>
    </main>
  );
}
