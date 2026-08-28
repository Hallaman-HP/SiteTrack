"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { ApiUser } from "@/lib/api";
import { displayName, initialsForProfile, profileFallback, type UserProfile } from "@/lib/profiles";
import { clearActiveWorkspaceId, clearSupabaseStoreCache } from "@/lib/supabaseStore";

type AuthContextValue = {
  isConfigured: boolean;
  isLoading: boolean;
  authError: string;
  user: ApiUser | null;
  profile: UserProfile | null;
  displayName: string;
  initials: string;
  applySessionUser: (user: ApiUser | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let mounted = true;

    api
      .getSession()
      .then((result) => {
        if (!mounted) return;
        setUser(result.user ?? null);
        setAuthError("");
        setIsLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        setUser(null);
        setAuthError(error instanceof Error ? error.message : "Could not check the current session.");
        setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const applySessionUser = useCallback((nextUser: ApiUser | null) => {
    setUser(nextUser);
    setAuthError("");
    setIsLoading(false);
    clearSupabaseStoreCache();
  }, []);

  const profile = useMemo(() => profileFallback(user), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: true,
      isLoading,
      authError,
      user,
      profile,
      displayName: displayName(profile, user?.email?.split("@")[0] ?? "Site user"),
      initials: initialsForProfile(profile, user?.email ?? "ST"),
      applySessionUser,
      async refreshProfile() {
        const result = await api.getSession();
        setUser(result.user ?? null);
      },
      async signOut() {
        try {
          await api.logout();
        } catch {
          // Clearing local state is enough if the server is unreachable.
        }
        setUser(null);
        clearActiveWorkspaceId();
        clearSupabaseStoreCache();
      }
    }),
    [applySessionUser, authError, isLoading, profile, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
