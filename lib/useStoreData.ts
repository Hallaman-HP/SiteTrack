"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { loadStore, saveStore } from "@/lib/store";
import { getActiveWorkspaceId, loadSupabaseStore, type WorkspaceSummary } from "@/lib/supabaseStore";
import type { StoreData } from "@/lib/types";

const emptyStore: StoreData = {
  sites: [],
  buildings: [],
  rooms: [],
  assets: [],
  asset_photos: [],
  asset_logs: []
};

type SharedStoreState = {
  data: StoreData;
  isSupabaseMode: boolean;
  workspace: WorkspaceSummary | null;
  isLoading: boolean;
  userId: string;
  activeWorkspaceId: string;
};

let sharedState: SharedStoreState = {
  data: emptyStore,
  isSupabaseMode: false,
  workspace: null,
  isLoading: false,
  userId: "",
  activeWorkspaceId: ""
};
let sharedLoadPromise: Promise<void> | null = null;
const sharedListeners = new Set<() => void>();

function publishSharedState(next: Partial<SharedStoreState>) {
  sharedState = { ...sharedState, ...next };
  sharedListeners.forEach((listener) => listener());
}

function updateSharedData(nextData: StoreData) {
  publishSharedState({ data: nextData, isLoading: false });
}

function subscribeToSharedStore(listener: () => void) {
  sharedListeners.add(listener);
  return () => {
    sharedListeners.delete(listener);
  };
}

export function useStoreData() {
  const { isConfigured, user } = useAuth();
  const [localState, setLocalState] = useState<SharedStoreState>(() => ({
    ...sharedState,
    isLoading: Boolean(isConfigured && user && sharedState.userId !== user.id)
  }));

  useEffect(() => subscribeToSharedStore(() => setLocalState(sharedState)), []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (isConfigured && user) {
        const activeWorkspaceId = getActiveWorkspaceId();
        if (
          sharedState.userId === user.id &&
          sharedState.activeWorkspaceId === activeWorkspaceId &&
          sharedState.isSupabaseMode &&
          !sharedState.isLoading
        ) {
          setLocalState(sharedState);
          return;
        }

        if (sharedLoadPromise) {
          setLocalState(sharedState);
          try {
            await sharedLoadPromise;
            if (!cancelled) setLocalState(sharedState);
          } catch {
            if (!cancelled) setLocalState(sharedState);
          }
          return;
        }

        publishSharedState({
          data: sharedState.userId === user.id && sharedState.activeWorkspaceId === activeWorkspaceId ? sharedState.data : emptyStore,
          isSupabaseMode: true,
          workspace: sharedState.userId === user.id && sharedState.activeWorkspaceId === activeWorkspaceId ? sharedState.workspace : null,
          isLoading: true,
          userId: user.id,
          activeWorkspaceId
        });

        sharedLoadPromise = (async () => {
          const result = await loadSupabaseStore();
          publishSharedState({
            data: result.data,
            isSupabaseMode: true,
            workspace: result.workspace,
            isLoading: false,
            userId: user.id,
            activeWorkspaceId: result.workspace?.id ?? activeWorkspaceId
          });
        })();

        try {
          await sharedLoadPromise;
          if (!cancelled) setLocalState(sharedState);
          return;
        } catch (error) {
          console.error("Could not load workspace data.", error);
          window.dispatchEvent(new CustomEvent("sitetrack-sync-error", {
            detail: error instanceof Error ? error.message : getSyncErrorMessage(error)
          }));
          if (!cancelled) {
            publishSharedState({
              data: emptyStore,
              isSupabaseMode: true,
              workspace: null,
              isLoading: false,
              userId: user.id,
              activeWorkspaceId
            });
          }
          return;
        } finally {
          sharedLoadPromise = null;
        }
      }

      if (!cancelled) {
        publishSharedState({
          data: loadStore(),
          isSupabaseMode: false,
          workspace: null,
          isLoading: false,
          userId: "",
          activeWorkspaceId: ""
        });
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [isConfigured, user]);

  function commit(next: StoreData) {
    // When signed in, individual actions call the API directly and then push the
    // refreshed state through replaceData/commit, so this only updates shared
    // state. The localStorage store remains only for the signed-out fallback.
    updateSharedData(next);
    if (!(isConfigured && user)) {
      saveStore(next);
    }
  }

  return [
    localState.data,
    commit,
    localState.isSupabaseMode,
    localState.workspace,
    localState.isLoading,
    updateSharedData
  ] as const;
}

function getSyncErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const value = error as { message?: string; details?: string; hint?: string; code?: string };
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(" ");
  }
  return "Could not sync workspace data.";
}
