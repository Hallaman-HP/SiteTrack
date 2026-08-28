"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { displayName, initialsForProfile, loadCurrentUserProfile, profileFallback, type UserProfile } from "@/lib/profiles";

type AuthContextValue = {
  isConfigured: boolean;
  isLoading: boolean;
  authError: string;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  displayName: string;
  initials: string;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    const fallbackTimer = window.setTimeout(() => {
      if (!mounted) return;
      setSession(null);
      setAuthError("Session check timed out. Sign in again to continue.");
      setIsLoading(false);
    }, 3500);

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        window.clearTimeout(fallbackTimer);
        if (error) {
          setSession(null);
          setAuthError(error.message);
        } else {
          setSession(data.session);
          setAuthError("");
        }
        setIsLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        window.clearTimeout(fallbackTimer);
        setSession(null);
        setAuthError(error instanceof Error ? error.message : "Could not check the current session.");
        setIsLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthError("");
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      window.clearTimeout(fallbackTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const user = session?.user;
    if (!supabase || !user) {
      setProfile(null);
      return;
    }

    setProfile(profileFallback(user));
    loadCurrentUserProfile(user)
      .then((nextProfile) => {
        if (mounted) setProfile(nextProfile);
      })
      .catch((error) => {
        console.error("Could not load profile.", error);
        if (mounted) setProfile(profileFallback(user));
      });

    return () => {
      mounted = false;
    };
  }, [session?.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: Boolean(supabase),
      isLoading,
      authError,
      session,
      user: session?.user ?? null,
      profile,
      displayName: displayName(profile, session?.user?.email?.split("@")[0] ?? "Site user"),
      initials: initialsForProfile(profile, session?.user?.email ?? "ST"),
      async refreshProfile() {
        if (!supabase || !session?.user) return;
        setProfile(await loadCurrentUserProfile(session.user));
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut({ scope: "local" });
        setSession(null);
        setProfile(null);
      }
    }),
    [authError, isLoading, profile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
