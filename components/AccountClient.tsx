"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  UsersRound
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { UserAvatar } from "@/components/UserAvatar";
import { inputClass } from "@/components/Field";
import { canManageJobSiteAccess, canManageWorkspace, roles } from "@/lib/roles";
import * as apiClient from "@/lib/api";
import { displayName, profileFallback, saveCurrentUserProfile, uploadCurrentUserAvatar, type ProfileMap, type UserProfile } from "@/lib/profiles";
import { clearSupabaseStoreCache, loadSupabaseStore, setActiveWorkspaceId, type WorkspaceSummary } from "@/lib/supabaseStore";
import type { Site, StoreData } from "@/lib/types";

type WorkspaceMember = apiClient.ApiWorkspaceMember;
type SiteMember = apiClient.ApiSiteMember;
type Invite = apiClient.ApiInvite;

const workspaceRoles = ["admin", "member"];
const siteRoles = roles.filter((item) => item !== "admin");

type AccountData = {
  store: StoreData;
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  workspaceMembers: WorkspaceMember[];
  siteMembers: SiteMember[];
  invites: Invite[];
  profiles: ProfileMap;
};

const emptyStore: StoreData = {
  sites: [],
  buildings: [],
  rooms: [],
  assets: [],
  asset_photos: [],
  asset_logs: []
};

export function AccountClient() {
  const { displayName: currentDisplayName, initials, isConfigured, profile, refreshProfile, user, signOut } = useAuth();
  const [data, setData] = useState<AccountData>({
    store: emptyStore,
    workspaces: [],
    activeWorkspace: null,
    workspaceMembers: [],
    siteMembers: [],
    invites: [],
    profiles: {}
  });
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(isConfigured && user));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshAccount() {
    if (!isConfigured || !user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const result = await loadSupabaseStore();
      const workspaceId = result.workspace?.id;
      const activeWorkspace = result.workspace;

      let workspaceMembers: WorkspaceMember[] = [];
      let siteMembers: SiteMember[] = [];
      let invites: Invite[] = [];

      if (workspaceId) {
        const membersResult = await apiClient.getMembers(workspaceId);
        workspaceMembers = membersResult.workspace_members ?? [];
        siteMembers = membersResult.site_members ?? [];

        const canSeeInvites =
          activeWorkspace?.role === "admin" ||
          (activeWorkspace?.manageableSiteIds?.length ?? 0) > 0 ||
          siteMembers.some((member) => member.user_id === user.id && canManageJobSiteAccess(member.role));
        if (canSeeInvites) {
          try {
            const invitesResult = await apiClient.getInvites(workspaceId);
            invites = invitesResult.invites ?? [];
          } catch {
            invites = [];
          }
        }
      }

      // Members come back with joined email/display_name/avatar_url, so the
      // profile map is built locally instead of a second profiles request.
      const profiles: ProfileMap = {};
      for (const member of [...workspaceMembers, ...siteMembers]) {
        profiles[member.user_id] = {
          id: member.user_id,
          first_name: "",
          last_name: "",
          display_name: member.display_name || member.email,
          avatar_url: member.avatar_url ?? ""
        };
      }
      const ownProfile = profileFallback(user);
      if (ownProfile) profiles[user.id] = ownProfile;

      setData({
        store: result.data,
        workspaces: result.workspaces,
        activeWorkspace,
        workspaceMembers,
        siteMembers,
        invites,
        profiles
      });
      setSelectedSiteId((current) => current || result.data.sites[0]?.id || "");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (cancelled) return;
      await refreshAccount();
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, user]);

  const isAdmin = canManageWorkspace(data.activeWorkspace?.role);
  const manageableSiteIds = data.activeWorkspace?.role === "admin"
    ? data.store.sites.map((site) => site.id)
    : data.siteMembers
      .filter((member) => member.user_id === user?.id && canManageJobSiteAccess(member.role))
      .map((member) => member.site_id);
  const canManageSiteAccess = isAdmin || manageableSiteIds.length > 0;

  async function sendResetEmail() {
    if (!user?.email) return;
    setMessage("");
    setError("");
    try {
      await apiClient.resetRequest(user.email);
      setMessage("Password reset email sent.");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }

  function switchWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId);
    clearSupabaseStoreCache();
    window.location.reload();
  }

  if (!user) {
    return (
      <AccountShell title="Sign in required" subtitle="Your account page is available after login.">
        <Link href="/login/" className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-4 text-sm font-semibold text-white">
          Go to Login
        </Link>
      </AccountShell>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="glass overflow-hidden rounded-[8px] p-5 shadow-panel sm:p-7 animate-rise">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <UserAvatar profile={profile} fallback={initials} size="lg" />
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-steel shadow-sm">
                <ShieldCheck size={14} className="text-signal" />
                Account
              </p>
              <h1 className="mt-3 truncate text-3xl font-semibold tracking-tight">{currentDisplayName}</h1>
              <p className="mt-1 truncate text-sm text-steel">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5"
          >
            <LogOut size={17} />
            Sign Out
          </button>
        </div>
      </section>

      {message ? <p className="rounded-[8px] bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-[8px] bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}

      {isLoading ? (
        <div className="rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel">
          <Loader2 className="mx-auto animate-spin text-signal" size={28} />
          <p className="mt-3 text-sm font-semibold text-steel">Loading account...</p>
        </div>
      ) : !data.activeWorkspace ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><KeyRound size={17} className="text-coral" />Workspace access</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Join or create a workspace</h2>
            <p className="mt-2 text-sm leading-6 text-steel">
              Your account is active, but it has not been granted access to any workspace yet. Join with a code from an admin, accept an invite link, or create a new workspace for your own company.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Link href="/join" className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-4 text-sm font-semibold text-white">Join Workspace</Link>
              <Link href="/workspace/new" className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm">Create Workspace</Link>
            </div>
          </section>
          <ProfileCard user={user} profile={profile} onSaved={refreshProfile} onMessage={setMessage} onError={setError} />
          <SecurityCard email={user.email ?? ""} onResetPassword={() => void sendResetEmail()} onMessage={setMessage} onError={setError} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid gap-5">
            <WorkspaceCard
              activeWorkspace={data.activeWorkspace}
              workspaces={data.workspaces}
              onSwitch={switchWorkspace}
              isAdmin={isAdmin}
              onChanged={refreshAccount}
              onMessage={setMessage}
              onError={setError}
            />
            {isAdmin ? (
              <WorkspaceUsersCard
                activeWorkspace={data.activeWorkspace}
                currentUserId={user.id}
                currentUserEmail={user.email ?? ""}
                profiles={data.profiles}
                isAdmin={isAdmin}
                members={data.workspaceMembers}
                invites={data.invites.filter((invite) => !invite.site_id)}
                onChanged={refreshAccount}
                onMessage={setMessage}
                onError={setError}
              />
            ) : (
              <MemberWorkspaceCard
                activeWorkspace={data.activeWorkspace}
                currentUserId={user.id}
                currentUserEmail={user.email ?? ""}
                profiles={data.profiles}
                members={data.workspaceMembers}
                onChanged={refreshAccount}
                onMessage={setMessage}
                onError={setError}
              />
            )}
          </section>
          <aside className="grid content-start gap-5">
            {canManageSiteAccess ? (
              <JobSiteAccessCard
                currentUserId={user.id}
                canGrantAdmin={isAdmin}
                selectedSiteId={selectedSiteId}
                onSelectSite={setSelectedSiteId}
                sites={isAdmin ? data.store.sites : data.store.sites.filter((site) => manageableSiteIds.includes(site.id))}
                workspaceMembers={data.workspaceMembers}
                siteMembers={data.siteMembers}
                profiles={data.profiles}
                invites={data.invites.filter((invite) => !!invite.site_id)}
                workspaceId={data.activeWorkspace?.id ?? ""}
                onChanged={refreshAccount}
                onMessage={setMessage}
                onError={setError}
              />
            ) : (
              <MemberSitesCard
                currentUserId={user.id}
                sites={data.store.sites}
                siteMembers={data.siteMembers}
                profiles={data.profiles}
                onChanged={refreshAccount}
                onMessage={setMessage}
                onError={setError}
              />
            )}
          </aside>
          <div className="lg:col-span-2">
            <ProfileCard user={user} profile={profile} onSaved={refreshProfile} onMessage={setMessage} onError={setError} />
          </div>
          <div className="lg:col-span-2">
            <SecurityCard email={user.email ?? ""} onResetPassword={() => void sendResetEmail()} onMessage={setMessage} onError={setError} />
          </div>
        </div>
      )}
    </div>
  );
}

function AccountShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
      <section className="w-full rounded-[8px] border border-zinc-200 bg-white p-6 text-center shadow-panel animate-rise">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-[8px] bg-ink text-white">
          <UserRound size={23} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-steel">{subtitle}</p>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}

function ProfileCard({
  user,
  profile,
  onSaved,
  onMessage,
  onError
}: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  profile: UserProfile | null;
  onSaved: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFirstName(profile?.first_name ?? "");
    setLastName(profile?.last_name ?? "");
  }, [profile?.first_name, profile?.last_name]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    onMessage("");
    setIsSaving(true);
    try {
      await saveCurrentUserProfile(user, firstName, lastName);
      await onSaved();
      onMessage("Profile name saved.");
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    onError("");
    onMessage("");
    setIsUploading(true);
    try {
      await uploadCurrentUserAvatar(user, file);
      await onSaved();
      onMessage("Profile picture uploaded.");
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar profile={profile} fallback={user.email ?? "ST"} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><UserRound size={17} className="text-signal" />Personal identity</p>
          <p className="mt-2 text-xs leading-5 text-steel">This is how your name and profile picture appear in workspaces, job-site access lists, and asset history logs.</p>
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5">
          <Upload size={17} />
          {isUploading ? "Uploading..." : "Upload Photo"}
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
        </label>
      </div>
      <form onSubmit={saveProfile} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <input className={inputClass} value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="First name" required autoComplete="given-name" />
        <input className={inputClass} value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Last name" required autoComplete="family-name" />
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Save Name"}
        </button>
      </form>
    </section>
  );
}

function WorkspaceCard({
  activeWorkspace,
  workspaces,
  onSwitch,
  isAdmin,
  onChanged,
  onMessage,
  onError
}: {
  activeWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  onSwitch: (workspaceId: string) => void;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const joinCode = activeWorkspace?.join_code ?? "";

  async function regenerateJoinCode() {
    if (!activeWorkspace) return;
    setIsRegenerating(true);
    onError("");
    onMessage("");
    try {
      await apiClient.regenerateJoinCode(activeWorkspace.id);
      clearSupabaseStoreCache();
      onMessage("Workspace join code regenerated.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setIsRegenerating(false);
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><Building2 size={17} className="text-signal" />Current workspace</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{activeWorkspace?.name ?? "No workspace yet"}</h2>
          <p className="mt-1 text-sm text-steel">Role: {activeWorkspace?.role ?? "None"}</p>
        </div>
        <Link href="/workspace/new" className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-ink px-4 text-sm font-semibold text-white">New</Link>
      </div>
      <div className="mt-4 grid gap-2">
        {workspaces.length ? workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => onSwitch(workspace.id)}
            className={`flex items-center justify-between rounded-[8px] border px-3 py-3 text-left transition hover:-translate-y-0.5 ${
              workspace.id === activeWorkspace?.id ? "border-signal bg-blue-50" : "border-zinc-200 bg-zinc-50"
            }`}
          >
            <span>
              <span className="block text-sm font-semibold text-ink">{workspace.name}</span>
              <span className="text-xs font-medium text-steel">{workspace.role ?? "member"}</span>
            </span>
            {workspace.id === activeWorkspace?.id ? <CheckCircle2 size={18} className="text-signal" /> : <ArrowRight size={16} className="text-steel" />}
          </button>
        )) : (
          <p className="rounded-[8px] bg-zinc-50 px-3 py-3 text-sm text-steel">Create a workspace to start adding sites.</p>
        )}
      </div>

      <div className="mt-4 rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><KeyRound size={16} className="text-coral" />Workspace join code</p>
        <p className="mt-1 text-xs leading-5 text-steel">New users can create an account, open the join page, and enter this code.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <div className="rounded-[8px] bg-white px-3 py-3 font-mono text-lg font-semibold tracking-[0.12em] text-ink shadow-sm">
            {joinCode || "Not enabled"}
          </div>
          <button
            type="button"
            disabled={!joinCode}
            onClick={() => copyText(joinCode, onMessage, onError, "Join code copied.")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-3 text-sm font-semibold text-ink shadow-sm disabled:opacity-40"
          >
            <Copy size={16} />
            Code
          </button>
          <button
            type="button"
            disabled={!joinCode}
            onClick={() => copyText(buildJoinUrl("code", joinCode), onMessage, onError, "Join link copied.")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-white px-3 text-sm font-semibold text-ink shadow-sm disabled:opacity-40"
          >
            <Copy size={16} />
            Link
          </button>
        </div>
        {!joinCode ? <p className="mt-2 text-xs font-semibold text-amber-700">Only workspace admins can see and share the join code.</p> : null}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => void regenerateJoinCode()}
            disabled={!activeWorkspace || isRegenerating}
            className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5 disabled:opacity-40"
          >
            {isRegenerating ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            Regenerate Code
          </button>
        ) : null}
      </div>
    </section>
  );
}

function WorkspaceUsersCard({
  activeWorkspace,
  currentUserId,
  currentUserEmail,
  profiles,
  isAdmin,
  members,
  invites,
  onChanged,
  onMessage,
  onError
}: {
  activeWorkspace: WorkspaceSummary | null;
  currentUserId: string;
  currentUserEmail: string;
  profiles: ProfileMap;
  isAdmin: boolean;
  members: WorkspaceMember[];
  invites: Invite[];
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const workspaceId = activeWorkspace?.id ?? "";

  async function inviteUser(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId) return;
    onError("");
    onMessage("");
    try {
      await apiClient.createInvite({ workspace_id: workspaceId, email: email.trim(), role });
      setEmail("");
      setRole("member");
      onMessage("Workspace invite saved. Copy the invite link from Pending invites and send it to the user.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  async function updateRole(memberId: string, nextRole: string) {
    onError("");
    try {
      await apiClient.updateWorkspaceMember(memberId, nextRole);
      onMessage("Workspace role updated.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  async function removeMember(memberId: string, memberUserId: string) {
    if (memberUserId === currentUserId) return;
    const ok = window.confirm("Remove this user from the workspace?");
    if (!ok) return;
    onError("");
    try {
      await apiClient.removeWorkspaceMember(memberId);
      onMessage("Workspace member removed.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><UsersRound size={17} className="text-signal" />Workspace editor</p>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-steel">{members.length} users</span>
      </div>

      <div className="mt-4 grid gap-2">
        {members.map((member) => (
          <div key={member.id} className="grid gap-2 rounded-[8px] border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-[1fr_150px_40px] sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar profile={profiles[member.user_id]} fallback={member.user_id} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{memberLabel(member.user_id, currentUserId, profiles, currentUserEmail)}</p>
                <p className="mt-1 truncate text-xs text-steel">{member.user_id === currentUserId ? "You" : member.email}</p>
              </div>
            </div>
            <select className={inputClass} value={member.role} disabled={!isAdmin} onChange={(event) => void updateRole(member.id, event.target.value)}>
              {Array.from(new Set([member.role, ...workspaceRoles])).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button
              type="button"
              disabled={!isAdmin || member.user_id === currentUserId}
              onClick={() => void removeMember(member.id, member.user_id)}
              className="inline-flex h-10 items-center justify-center rounded-[8px] bg-white text-rose-700 shadow-sm disabled:opacity-40"
              aria-label="Remove workspace member"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {isAdmin ? (
        <form onSubmit={inviteUser} className="mt-4 grid gap-2 rounded-[8px] border border-zinc-200 bg-white p-3 sm:grid-cols-[1fr_150px_110px]">
          <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="user@company.com" required />
          <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value)}>
            {workspaceRoles.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ink px-3 text-sm font-semibold text-white">
            <UserPlus size={16} />
            Invite
          </button>
        </form>
      ) : null}

      <PendingInvites invites={invites} emptyText="No pending workspace invites." onMessage={onMessage} onError={onError} />
    </section>
  );
}

function MemberWorkspaceCard({
  activeWorkspace,
  currentUserId,
  currentUserEmail,
  profiles,
  members,
  onChanged,
  onMessage,
  onError
}: {
  activeWorkspace: WorkspaceSummary | null;
  currentUserId: string;
  currentUserEmail: string;
  profiles: ProfileMap;
  members: WorkspaceMember[];
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const membership = members.find((member) => member.user_id === currentUserId);

  async function leaveWorkspace() {
    if (!activeWorkspace || !membership) return;
    const ok = window.confirm("Leave this workspace? You will lose access until an admin invites you again.");
    if (!ok) return;
    onError("");
    onMessage("");
    try {
      await apiClient.removeWorkspaceMember(membership.id);
      setActiveWorkspaceId("");
      onMessage("You left the workspace.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><UsersRound size={17} className="text-signal" />Workspace membership</p>
      <div className="mt-4 flex items-center gap-3 rounded-[8px] bg-zinc-50 p-3">
        <UserAvatar profile={profiles[currentUserId]} fallback={currentUserEmail} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{memberLabel(currentUserId, currentUserId, profiles, currentUserEmail)}</p>
          <p className="mt-1 text-xs text-steel">Role: {membership?.role ?? activeWorkspace?.role ?? "member"}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-steel">Workspace editors are only available to admins. Your account can leave this workspace or manage password/security below.</p>
      <button
        type="button"
        onClick={() => void leaveWorkspace()}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700"
      >
        Leave Workspace
      </button>
    </section>
  );
}

function JobSiteAccessCard({
  currentUserId,
  canGrantAdmin,
  selectedSiteId,
  onSelectSite,
  sites,
  workspaceMembers,
  siteMembers,
  profiles,
  invites,
  workspaceId,
  onChanged,
  onMessage,
  onError
}: {
  currentUserId: string;
  canGrantAdmin: boolean;
  selectedSiteId: string;
  onSelectSite: (siteId: string) => void;
  sites: Site[];
  workspaceMembers: WorkspaceMember[];
  siteMembers: SiteMember[];
  profiles: ProfileMap;
  invites: Invite[];
  workspaceId: string;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("technician");
  const [memberUserId, setMemberUserId] = useState("");
  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0];
  const selectedSiteMembers = selectedSite ? siteMembers.filter((member) => member.site_id === selectedSite.id) : [];
  const selectedInvites = selectedSite ? invites.filter((invite) => invite.site_id === selectedSite.id) : [];
  const grantableRoles = siteRoles;

  async function addExistingMember(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSite || !memberUserId) return;
    onError("");
    try {
      await apiClient.upsertSiteMember(selectedSite.id, memberUserId, role);
      setMemberUserId("");
      setRole("technician");
      onMessage("Job-site access updated.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  async function inviteToSite(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSite || !workspaceId) return;
    onError("");
    try {
      await apiClient.createInvite({ workspace_id: workspaceId, site_id: selectedSite.id, email: email.trim(), role });
      setEmail("");
      setRole("technician");
      onMessage("Job-site invite saved. Copy the invite link from Pending invites and send it to the user.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  async function updateSiteRole(memberId: string, nextRole: string) {
    onError("");
    try {
      await apiClient.updateSiteMember(memberId, nextRole);
      onMessage("Job-site role updated.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  async function removeSiteMember(memberId: string) {
    const ok = window.confirm("Remove this user's job-site access?");
    if (!ok) return;
    onError("");
    try {
      await apiClient.removeSiteMember(memberId);
      onMessage("Job-site access removed.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><MapPinned size={17} className="text-coral" />Job-site access</p>
      <p className="mt-2 text-xs leading-5 text-steel">This controls who can access a job site. Site names, buildings, and rooms stay in the Sites tab.</p>

      {sites.length ? (
        <div className="mt-4 grid gap-3">
          <select className={inputClass} value={selectedSite?.id ?? ""} onChange={(event) => onSelectSite(event.target.value)}>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>

          <div className="grid gap-2">
            {selectedSiteMembers.length ? selectedSiteMembers.map((member) => (
              <div key={member.id} className="grid gap-2 rounded-[8px] bg-zinc-50 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar profile={profiles[member.user_id]} fallback={member.user_id} size="sm" />
                  <p className="truncate text-sm font-semibold text-ink">{memberLabel(member.user_id, currentUserId, profiles)}</p>
                </div>
                <div className="grid grid-cols-[1fr_40px] gap-2">
                  <select className={inputClass} value={member.role} disabled={!canGrantAdmin && member.role === "admin"} onChange={(event) => void updateSiteRole(member.id, event.target.value)}>
                    {Array.from(new Set([member.role, ...grantableRoles])).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!canGrantAdmin && member.role === "admin"}
                    onClick={() => void removeSiteMember(member.id)}
                    className="inline-flex h-11 items-center justify-center rounded-[8px] bg-white text-rose-700 shadow-sm disabled:opacity-40"
                    aria-label="Remove site member"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )) : (
              <p className="rounded-[8px] bg-zinc-50 px-3 py-3 text-sm text-steel">No specific site members yet. Workspace members can still access this site based on workspace role.</p>
            )}
          </div>

          <form onSubmit={addExistingMember} className="grid gap-2 rounded-[8px] border border-zinc-200 p-3">
            <p className="text-sm font-semibold text-ink">Add existing workspace user</p>
            <select className={inputClass} value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} required>
              <option value="">Choose user</option>
              {workspaceMembers.map((member) => (
                <option key={member.id} value={member.user_id}>
                  {memberLabel(member.user_id, currentUserId, profiles)} | {member.role}
                </option>
              ))}
            </select>
            <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value)}>
              {grantableRoles.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-3 text-sm font-semibold text-white">Add Access</button>
          </form>

          <form onSubmit={inviteToSite} className="grid gap-2 rounded-[8px] border border-zinc-200 p-3">
            <p className="text-sm font-semibold text-ink">Invite by email to this job site</p>
            <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="user@company.com" required />
            <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value)}>
              {grantableRoles.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ink px-3 text-sm font-semibold text-white">Invite to Site</button>
          </form>

          <PendingInvites invites={selectedInvites} emptyText="No pending job-site invites." onMessage={onMessage} onError={onError} />
        </div>
      ) : (
        <p className="mt-4 rounded-[8px] bg-zinc-50 px-3 py-3 text-sm text-steel">Create a job site in the Sites tab before assigning site access.</p>
      )}
    </section>
  );
}

function MemberSitesCard({
  currentUserId,
  sites,
  siteMembers,
  profiles,
  onChanged,
  onMessage,
  onError
}: {
  currentUserId: string;
  sites: Site[];
  siteMembers: SiteMember[];
  profiles: ProfileMap;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  async function leaveSite(memberId: string) {
    const ok = window.confirm("Leave this job site? You will lose access until an admin grants it again.");
    if (!ok) return;
    onError("");
    onMessage("");
    try {
      await apiClient.removeSiteMember(memberId);
      onMessage("You left the job site.");
      await onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><MapPinned size={17} className="text-coral" />Your job sites</p>
      <div className="mt-3 flex items-center gap-3">
        <UserAvatar profile={profiles[currentUserId]} fallback={currentUserId} size="sm" />
        <p className="text-sm font-semibold text-ink">{memberLabel(currentUserId, currentUserId, profiles)}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-steel">These are the job sites you have specifically been granted. Site editing is admin-only.</p>
      <div className="mt-4 grid gap-2">
        {sites.length ? sites.map((site) => {
          const membership = siteMembers.find((member) => member.site_id === site.id && member.user_id === currentUserId);
          return (
            <div key={site.id} className="rounded-[8px] bg-zinc-50 p-3">
              <p className="text-sm font-semibold text-ink">{site.name}</p>
              <p className="mt-1 text-xs text-steel">{site.address || "No address"} | Role: {membership?.role ?? "viewer"}</p>
              {membership ? (
                <button
                  type="button"
                  onClick={() => void leaveSite(membership.id)}
                  className="mt-3 inline-flex min-h-10 items-center justify-center rounded-[8px] border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700"
                >
                  Leave Job Site
                </button>
              ) : null}
            </div>
          );
        }) : (
          <p className="rounded-[8px] bg-zinc-50 px-3 py-3 text-sm text-steel">No job sites have been granted to this account yet.</p>
        )}
      </div>
    </section>
  );
}

function PendingInvites({
  invites,
  emptyText,
  onMessage,
  onError
}: {
  invites: Invite[];
  emptyText: string;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-steel">Pending invites</p>
      <div className="mt-2 grid gap-2">
        {invites.length ? invites.map((invite) => (
          <div key={invite.id} className="grid gap-2 rounded-[8px] bg-blue-50 px-3 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{invite.email}</p>
              <p className="text-xs text-steel">{invite.role} | expires {new Date(invite.expires_at).toLocaleDateString()}</p>
            </div>
            <button
              type="button"
              onClick={() => copyText(buildJoinUrl("token", invite.token), onMessage, onError, "Invite link copied.")}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-white px-3 text-xs font-semibold text-ink shadow-sm"
            >
              <Copy size={15} />
              Copy Link
            </button>
          </div>
        )) : (
          <p className="rounded-[8px] bg-zinc-50 px-3 py-3 text-sm text-steel">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

function buildJoinUrl(kind: "code" | "token", value: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const param = kind === "token" ? "invite" : "code";
  return `${origin}/join/?${param}=${encodeURIComponent(value)}`;
}

function memberLabel(userId: string, currentUserId: string, profiles: ProfileMap, fallback?: string) {
  const profile = profiles[userId];
  const name = displayName(profile, fallback || `User ${userId.slice(0, 8)}`);
  return userId === currentUserId ? `${name} (You)` : name;
}

async function copyText(
  text: string,
  onMessage: (message: string) => void,
  onError: (message: string) => void,
  successMessage: string
) {
  onError("");
  try {
    await navigator.clipboard.writeText(text);
    onMessage(successMessage);
  } catch {
    onError("Could not copy automatically. Select the text and copy it manually.");
  }
}

function SecurityCard({
  email,
  onResetPassword,
  onMessage,
  onError
}: {
  email: string;
  onResetPassword: () => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isChanging, setIsChanging] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    onMessage("");
    setIsChanging(true);
    try {
      await apiClient.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      onMessage("Password changed.");
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setIsChanging(false);
    }
  }

  return (
    <section className="rounded-[8px] border border-zinc-200 bg-white p-5 shadow-panel">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><LockKeyhole size={17} className="text-mint" />Security</p>
      <div className="mt-4 grid gap-3 text-sm">
        <div className="rounded-[8px] bg-zinc-50 p-3">
          <p className="font-semibold text-ink">Email</p>
          <p className="mt-1 break-all text-steel">{email}</p>
        </div>
        <div className="rounded-[8px] bg-zinc-50 p-3">
          <p className="font-semibold text-ink">Two-factor authentication</p>
          <p className="mt-1 text-steel">A 6-digit email code is required when signing in from a new device.</p>
        </div>
      </div>
      <form onSubmit={changePassword} className="mt-4 grid gap-2 rounded-[8px] border border-zinc-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
        <input
          className={inputClass}
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder="Current password"
          required
          autoComplete="current-password"
        />
        <input
          className={inputClass}
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="New password"
          required
          minLength={6}
          autoComplete="new-password"
        />
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-ink px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          disabled={isChanging}
        >
          <KeyRound size={16} />
          {isChanging ? "Changing..." : "Change Password"}
        </button>
      </form>
      <button
        type="button"
        onClick={onResetPassword}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm transition hover:-translate-y-0.5"
      >
        <Mail size={17} />
        Send Password Reset Email
      </button>
    </section>
  );
}

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) return caught.message;
  if (caught && typeof caught === "object") {
    const error = caught as { message?: string; details?: string; hint?: string; code?: string };
    return [error.message, error.details, error.hint, error.code].filter(Boolean).join(" ");
  }
  return "Could not load account.";
}
