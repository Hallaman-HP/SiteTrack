"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { Boxes, Building2, Home, KeyRound, Loader2, LockKeyhole, LogOut, Map, Plus, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { UserAvatar } from "@/components/UserAvatar";
import { loadWorkspaceGate } from "@/lib/supabaseStore";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/sites", label: "Sites", icon: Map },
  { href: "/search", label: "Search", icon: Search },
  { href: "/assets/new", label: "Add", icon: Plus }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const rawPathname = usePathname();
  // trailingSlash exports report "/sites/" - normalise for nav matching.
  const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, "") : rawPathname;
  const router = useRouter();
  const { authError, displayName, isConfigured, isLoading, profile, user, signOut } = useAuth();
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/auth/callback");
  const isSetupRoute = isAuthRoute || pathname.startsWith("/join") || pathname.startsWith("/workspace/new") || pathname.startsWith("/account");
  const [syncError, setSyncError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null);
  const [canAddAssets, setCanAddAssets] = useState(true);

  useEffect(() => {
    function onSyncError(event: Event) {
      setSyncError((event as CustomEvent<string>).detail || "Could not sync data to the server.");
      setSyncStatus("");
    }
    function onSyncStatus(event: Event) {
      setSyncStatus((event as CustomEvent<string>).detail || "");
      if ((event as CustomEvent<string>).detail?.includes("Saved")) {
        window.setTimeout(() => setSyncStatus(""), 1800);
      }
    }
    window.addEventListener("sitetrack-sync-error", onSyncError);
    window.addEventListener("sitetrack-sync-status", onSyncStatus);
    return () => {
      window.removeEventListener("sitetrack-sync-error", onSyncError);
      window.removeEventListener("sitetrack-sync-status", onSyncStatus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkWorkspace() {
      if (!isConfigured || !user || isSetupRoute) {
        setHasWorkspace(null);
        setCanAddAssets(true);
        return;
      }

      try {
        const result = await loadWorkspaceGate();
        if (!cancelled) {
          setHasWorkspace(result.hasWorkspace);
          setCanAddAssets(result.canAddAssets);
        }
      } catch {
        if (!cancelled) {
          setHasWorkspace(true);
          setCanAddAssets(false);
        }
      }
    }

    void checkWorkspace();
    return () => {
      cancelled = true;
    };
  }, [isConfigured, isSetupRoute, user]);

  function goTo(href: string) {
    router.push(href);
  }

  const visibleNavItems = navItems.filter((item) => item.href !== "/assets/new" || canAddAssets);

  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[8px] bg-gradient-to-br from-safety via-coral to-signal text-white shadow-panel">
              <Boxes size={21} strokeWidth={2.4} />
            </div>
            <div>
              <p className="text-base font-semibold tracking-tight">SiteTrack</p>
              <p className="text-xs text-steel">Asset location register</p>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 rounded-[8px] bg-zinc-100 p-1 md:flex">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => goTo(item.href)}
                  className={`flex items-center gap-2 rounded-[7px] px-3 py-2 text-sm font-medium transition ${
                    active ? "bg-white text-ink shadow-sm" : "text-steel hover:text-ink"
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            {isLoading ? (
              <span className="rounded-[8px] bg-zinc-100 px-3 py-2 text-sm font-semibold text-steel">Checking...</span>
            ) : isConfigured && user ? (
              <>
                <Link href="/account" className="inline-flex items-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-ink shadow-sm">
                  <UserAvatar profile={profile} fallback={displayName} size="sm" />
                  <span className="hidden max-w-44 truncate lg:inline">{displayName}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-zinc-200 bg-white text-steel shadow-sm transition hover:text-ink"
                  aria-label="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <Link href="/login" className="inline-flex items-center gap-2 rounded-[8px] bg-ink px-3 py-2 text-sm font-semibold text-white shadow-sm">
                <UserRound size={16} />
                <span className="hidden sm:inline">Login</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {syncError ? (
          <button
            type="button"
            onClick={() => setSyncError("")}
            className="mb-4 w-full rounded-[8px] bg-rose-50 px-4 py-3 text-left text-sm font-semibold text-rose-700 shadow-sm"
          >
            Sync failed: {syncError}
          </button>
        ) : null}
        {syncStatus ? (
          <div className="mb-4 rounded-[8px] bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 shadow-sm">
            {syncStatus}
          </div>
        ) : null}
        {isConfigured && isLoading && !isAuthRoute ? (
          <div className="grid min-h-[60vh] place-items-center">
            <div className="rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel">
              <Loader2 className="mx-auto animate-spin text-signal" size={28} />
              <p className="mt-3 text-sm font-semibold text-steel">Checking secure session...</p>
            </div>
          </div>
        ) : isConfigured && !user && !isAuthRoute ? (
          <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
            <section className="rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel animate-rise">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-[8px] bg-ink text-white">
                <LockKeyhole size={23} />
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in required</h1>
              <p className="mt-2 text-sm leading-6 text-steel">
                {authError || "Company assets, photos, and job-site records are protected. Sign in to continue."}
              </p>
              <Link href="/login" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-4 text-sm font-semibold text-white">
                Go to Login
              </Link>
            </section>
          </div>
        ) : isConfigured && user && !isSetupRoute && hasWorkspace === false ? (
          <div className="mx-auto grid min-h-[60vh] max-w-lg place-items-center">
            <section className="w-full rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel animate-rise">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-[8px] bg-ink text-white">
                <KeyRound size={23} />
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Join or create a workspace</h1>
              <p className="mt-2 text-sm leading-6 text-steel">
                This account is signed in, but it does not have a workspace membership yet. Join by code or create a new workspace before opening job-site data.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Link href="/join" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white">
                  <KeyRound size={17} />
                  Join Workspace
                </Link>
                <Link href="/workspace/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm">
                  <Building2 size={17} />
                  Create Workspace
                </Link>
              </div>
            </section>
          </div>
        ) : (
          children
        )}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/90 px-2 py-2 backdrop-blur-xl md:hidden">
        <div className={`grid gap-1 ${visibleNavItems.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => goTo(item.href)}
                className={`flex flex-col items-center justify-center rounded-[8px] py-2 text-xs font-medium ${
                  active ? "bg-zinc-100 text-ink" : "text-steel"
                }`}
              >
                <Icon size={19} />
                <span className="mt-1">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
