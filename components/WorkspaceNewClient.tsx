"use client";

import { useState } from "react";
import { Building2, Loader2, Plus } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Field, inputClass } from "@/components/Field";
import * as apiClient from "@/lib/api";
import { setActiveWorkspaceId } from "@/lib/supabaseStore";

export function WorkspaceNewClient() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await apiClient.createWorkspace(name.trim());
      if (result.workspace?.id) setActiveWorkspaceId(result.workspace.id);
      setMessage("Workspace created. You should now be the workspace admin.");
      setName("");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <section className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel animate-rise">
        <div className="bg-gradient-to-r from-ink via-signal to-mint p-6 text-white">
          <div className="grid h-12 w-12 place-items-center rounded-[8px] bg-white/15">
            <Building2 size={24} />
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Create a workspace</h1>
          <p className="mt-2 text-sm leading-6 text-white/80">A workspace is your company, crew, or workforce group. Admins invite users and assign job sites from here.</p>
        </div>
        <form onSubmit={createWorkspace} className="grid gap-4 p-5">
          {!user ? <p className="rounded-[8px] bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">Sign in before creating a workspace.</p> : null}
          {error ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
          {message ? <p className="rounded-[8px] bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</p> : null}
          <Field label="Workspace name">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="ABC Electrical" required />
          </Field>
          <button
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white shadow-panel transition hover:-translate-y-0.5 disabled:opacity-50"
            disabled={!user || isSaving}
          >
            {isSaving ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />}
            Create Workspace
          </button>
        </form>
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
  return "Could not create workspace.";
}
