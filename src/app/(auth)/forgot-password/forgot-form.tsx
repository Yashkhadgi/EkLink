"use client";

import { FormEvent, useState } from "react";
import { z } from "zod";

const forgotSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your PRN or college email."),
});

export function ForgotForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = forgotSchema.safeParse({
      identifier: new FormData(event.currentTarget).get("identifier"),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter your PRN or college email.");
      return;
    }

    setPending(true);
    const response = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    const payload = (await response.json()) as { message: string };
    setPending(false);
    setMessage(payload.message);
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
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
