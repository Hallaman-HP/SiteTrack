"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { inputClass } from "@/components/Field";
import * as apiClient from "@/lib/api";
import { setActiveWorkspaceId } from "@/lib/supabaseStore";

export function JoinWorkspaceClient() {
  return (
    <Suspense>
      <JoinWorkspaceInner />
    </Suspense>
  );
}

function JoinWorkspaceInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    // Invite emails link to /join/?invite=<token>; older links used ?token=.
    const token = searchParams.get("invite") ?? searchParams.get("token");
    if (token && user) void acceptInvite(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user]);

  async function acceptInvite(token: string) {
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiClient.acceptInvite(token);
      if (result.workspace_id) setActiveWorkspaceId(result.workspace_id);
      setMessage("Invite accepted. Opening your workspace...");
      window.setTimeout(() => router.push("/account/"), 900);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function joinWithCode(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiClient.joinWorkspace(code.trim());
      if (result.workspace_id) setActiveWorkspaceId(result.workspace_id);
      setMessage("Workspace joined. Opening your account...");
      window.setTimeout(() => router.push("/account/"), 900);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  }

  if (!user) {
    return <JoinShell title="Sign in first" subtitle="Create or sign into your account, then open this join link again." />;
  }

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
      <section className="w-full overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel animate-rise">
        <div className="bg-gradient-to-r from-ink via-signal to-mint p-6 text-white">
          <div className="grid h-12 w-12 place-items-center rounded-[8px] bg-white/15">
            <KeyRound size={24} />
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Join workspace</h1>
          <p className="mt-2 text-sm leading-6 text-white/80">Use an invite link or enter a workspace code from your admin.</p>
        </div>
        <form onSubmit={joinWithCode} className="grid gap-4 p-5">
          {error ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
          {message ? <p className="inline-flex items-center gap-2 rounded-[8px] bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} />{message}</p> : null}
          <label className="grid gap-1 text-sm font-semibold text-ink">
            Workspace code
            <input className={inputClass} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="A1B2C3D4" required />
          </label>
          <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white" disabled={isBusy}>
            {isBusy ? <Loader2 className="animate-spin" size={17} /> : <KeyRound size={17} />}
            Join Workspace
          </button>
        </form>
      </section>
    </div>
  );
}

function JoinShell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
      <section className="w-full rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-steel">{subtitle}</p>
      </section>
    </div>
  );
}

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  if (caught && typeof caught === "object") {
    const error = caught as { message?: string; details?: string; hint?: string; code?: string };
    return [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ");
  }
  return "Could not join workspace.";
}
