"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { Field, inputClass } from "@/components/Field";
import * as api from "@/lib/api";

export function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { applySessionUser } = useAuth();
  const token = searchParams.get("token") ?? "";
  const type = searchParams.get("type") ?? "";
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const startedRef = useRef(false);

  const isRecovery = type === "recovery";

  useEffect(() => {
    if (isRecovery || startedRef.current) return;
    startedRef.current = true;

    async function verify() {
      if (!token) {
        setError("This link is missing its sign-in token. Request a fresh link and try again.");
        return;
      }
      try {
        let user;
        if (type === "verify" || type === "verify-email") {
          const result = await api.verifyEmail(token);
          user = result.user;
        } else {
          try {
            const result = await api.magicVerify(token);
            user = result.user;
          } catch {
            const result = await api.verifyEmail(token);
            user = result.user;
          }
        }
        applySessionUser(user);
        router.replace("/account/");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "This link is invalid or has expired.");
      }
    }

    void verify();
  }, [applySessionUser, isRecovery, router, token, type]);

  async function submitNewPassword(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError("");
    try {
      const result = await api.resetConfirm(token, newPassword);
      applySessionUser(result.user);
      router.replace("/account/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reset your password.");
    } finally {
      setIsBusy(false);
    }
  }

  if (isRecovery) {
    return (
      <div className="mx-auto grid min-h-[calc(100vh-9rem)] max-w-md place-items-center">
        <section className="w-full rounded-[8px] border border-zinc-200 bg-white p-6 shadow-panel animate-rise">
          <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
          <p className="mt-2 text-sm text-steel">Choose a new password for your SiteTrack account.</p>
          <form onSubmit={submitNewPassword} className="mt-4 grid gap-4">
            {error ? <p className="rounded-[8px] bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
            <Field label="New password">
              <input
                className={inputClass}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                autoFocus
              />
            </Field>
            <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white shadow-panel" disabled={isBusy}>
              {isBusy ? <Loader2 className="animate-spin" size={17} /> : <KeyRound size={17} />}
              Save New Password
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-9rem)] max-w-md place-items-center">
      <section className="w-full rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel animate-rise">
        {error ? (
          <>
            <ShieldAlert className="mx-auto text-rose-600" size={34} />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign-in link problem</h1>
            <p className="mt-2 text-sm font-semibold text-rose-700">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto animate-spin text-signal" size={34} />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Finishing sign-in...</h1>
            <p className="mt-2 text-sm text-steel">Setting up your SiteTrack session.</p>
          </>
        )}
      </section>
    </div>
  );
}
