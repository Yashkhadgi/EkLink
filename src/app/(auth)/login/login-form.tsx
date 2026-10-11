"use client";

import { getSafeRelativePath } from "@/lib/security/redirect";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { z } from "zod";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your PRN or college email."),
  password: z.string().min(1, "Enter your password."),
});

const GENERIC_ERROR = "PRN/email or password is incorrect.";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "link_invalid"
      ? "That sign-in link is invalid or expired."
      : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      identifier: formData.get("identifier"),
      password: formData.get("password"),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
      return;
    }

    setPending(true);
    const next = getSafeRelativePath(searchParams.get("next"));
    const response = await fetch(`/api/auth/login?next=${encodeURIComponent(next)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      next?: string;
      error?: string;
    };
    setPending(false);

    if (!response.ok) {
      setError(payload.error ?? GENERIC_ERROR);
      return;
    }

    router.replace(getSafeRelativePath(payload.next ?? next));
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-800" htmlFor="identifier">
          PRN or college email
        </label>
        <input
          id="identifier"
          name="identifier"
          autoComplete="username"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-800" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          required
        />
      </div>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <p className="text-center text-sm text-slate-600">
        <Link className="font-medium text-slate-950 underline-offset-4 hover:underline" href="/forgot-password">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
