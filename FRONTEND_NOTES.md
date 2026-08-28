# Frontend Conversion Notes — Supabase → PHP API + Static Export

Date: 2026-08-28. Scope: frontend only (`app/`, `components/`, `lib/`, `next.config.mjs`, `package.json`, `public/`). `server/` and `docs/` untouched. Code written against `docs/API_CONTRACT.md`, not a live server.

## Build status — ALL QUALITY GATES PASS

- `npx tsc --noEmit` — clean (exit 0)
- `npx next lint` — "No ESLint warnings or errors"
- `npm run build` — succeeds, 16 static routes exported to `out/`
- Verified present: `out/index.html`, `out/assets/view/index.html`, `out/assets/edit/index.html`, `out/login/index.html`, `out/404.html`, `out/.htaccess`, `out/manifest.webmanifest`, `out/sw.js`, `out/offline.html`
- Supabase grep of `out/`: **no supabase URLs**. Only match is the internal identifier `isSupabaseMode` (part of `useStoreData`'s unchanged return tuple, kept intentionally per "same exported names" requirement). `NEXT_PUBLIC_SUPABASE_*`, `@supabase/*`, and `lib/supabase.ts` are gone from source.

## New files

- **`lib/api.ts`** — typed fetch client. `baseUrl` from `NEXT_PUBLIC_API_BASE` (default `/api`), `credentials: "include"`, `X-Requested-With: SiteTrack` on non-GET, JSON in/out, throws `Error(payload.error)` on `!res.ok` or `payload.ok === false`. Typed functions for every contract endpoint (auth incl. 2FA/magic-link/reset, profile + avatar multipart, store/gate, workspaces/join-code/invites, workspace + site members, sites/buildings/rooms, assets save/delete/archive/restore, photo delete, health).
- **`app/assets/view/page.tsx`**, **`app/assets/edit/page.tsx`** — client pages reading `?id=` via `useSearchParams` inside `<Suspense>`; replace deleted dynamic routes `app/assets/[id]/` and `app/assets/[id]/edit/`.
- **`public/.htaccess`** — Apache rules: never rewrite `^api/`, serve existing files/dirs, `$1.html` and `$1/index.html` fallbacks, `ErrorDocument 404 /404.html`, long-cache for hashed assets, `no-cache` + `Service-Worker-Allowed` for `sw.js`, and the security headers that previously lived in `next.config.mjs` `headers()` (removed — incompatible with `output: "export"`).
- **`.env.example`** — now documents `NEXT_PUBLIC_API_BASE` only.

## Rewritten / edited

- **`lib/supabaseStore.ts`** — same exported names/signatures, internals call `lib/api.ts`. `saveSupabaseStore` removed entirely. Module-level cache kept, keyed on active workspace id; all mutations clear it. `loadSupabaseStore` persists the API-selected workspace id.
- **`lib/profiles.ts`** — `updateProfile` / `uploadAvatar` (multipart, image-type + 5 MB client check) / `getProfiles(ids)`; `avatar_url` used verbatim from API (no storage-path resolution).
- **`lib/useStoreData.ts`** — commit() now only updates shared state + localStorage in signed-out mode (server persists in API mode); de-Supabased messages. Return tuple unchanged.
- **`components/AuthProvider.tsx`** — `GET /api/auth/session` on mount; context keeps `isConfigured` (always `true`) for compatibility; `session` removed (no consumers); `applySessionUser`, `signOut` → `POST /api/auth/logout` + local cache/workspace clear.
- **`components/AuthForm.tsx`** — password login with `requires_2fa` → 6-digit code screen + "Trust this device for 7 days" → `POST /api/auth/2fa/verify`; magic-link request; signup with verify-email message.
- **`components/AuthCallbackClient.tsx`** — handles `?token=` + `?type=` (recovery → new-password form → reset/confirm; verify/verify-email → email verification; default magic-link verify with email-verify fallback).
- **`components/AccountClient.tsx`** — members/invites/roles/join-code via `/api/members/*`, `/api/invites*`, `/api/workspaces/regenerate-code`; profiles built from member rows returned by the API; SecurityCard gained a Change Password form (current + new → `POST /api/auth/change-password`) and keeps the reset-by-email button; workspace roles aligned to contract (`admin|member`), site roles exclude `admin`.
- **`components/JoinWorkspaceClient.tsx`** — `/api/workspaces/join` (code) and `/api/invites/accept` (token); reads `?invite=` (contract) and legacy `?token=`.
- **`components/WorkspaceNewClient.tsx`** — `POST /api/workspaces` → `setActiveWorkspaceId(workspace.id)`; Supabase SQL-hint error copy removed.
- **`components/AssetForm.tsx`** — data-layer touchpoints only: redirects now `/assets/view/?id=...`. OCR "read label" logic untouched; no barcode scanner added.
- **`components/ScannerModal.tsx`** (pre-existing type error, behaviour unchanged) — the optional runtime `import("@zxing/browser")` fails `tsc` because the package isn't a dependency; added `@ts-expect-error` + an explicit callback param type. No logic changes.
- **Links updated** to query-param routes in `AssetCard`, `AssetActionsMenu`, `DashboardClient` (3), `AssetDetailClient`.
- **`components/AppShell.tsx`** — pathname normalised (trailingSlash export reports `/sites/`) so nav active-state works; "Supabase sync failed" → "Sync failed"; "Demo Mode" label removed. `components/SitesClient.tsx` — sync status copy de-Supabased.
- **`next.config.mjs`** — `output: "export"`, `trailingSlash: true`, `images.unoptimized`; `headers()` removed (moved to `.htaccess`).
- **`public/sw.js`** — added early return for `/api` and `/api/*` requests (avatars/live data never cached or intercepted); still skips `/_next/static/` and serves `offline.html` on failed navigations.
- **`package.json`** — removed `@supabase/ssr`, `@supabase/supabase-js`; `npm install` run. **Deleted:** `lib/supabase.ts`, `app/assets/[id]/` tree.
- **`app/manifest.ts`** — confirmed compatible with static export (Next 14.2.5 emits `/manifest.webmanifest` at build; verified in `out/` and linked from pages).

## Contract mismatches / notes for the backend agent

1. **Invite link param**: contract emails link to `/join/?invite=<token>`; the old frontend used `?token=`. Frontend now emits `?invite=` in copied join URLs and accepts **both** params on `/join/`.
2. **Verify-email link format** is not fully specified in the contract. `/auth/callback/` handles `?type=verify` / `?type=verify-email` explicitly, and for a bare `?token=` tries magic-link verify first, then falls back to email verification. Backend should ideally include an explicit `type` param in verification emails.
3. **Workspace roles**: contract defines `admin|member`; old UI offered 4 roles. UI now offers `admin|member` at workspace level; site-level roles come from `lib/roles.ts` minus `admin`. If the backend supports more workspace roles, the select also displays a member's current (unknown) role so it isn't clobbered.
4. **Profiles**: `GET /api/members` already returns `email`, `display_name`, `avatar_url` per member, so `AccountClient` no longer calls `/api/profiles?ids=` (the endpoint is still implemented in `lib/api.ts` and used by `lib/profiles.ts#loadProfilesForUsers`).
5. **`POST /api/assets/save`** is sent `{asset, photo_url?}` and the frontend expects the server to create asset logs and photo rows (contract behaviour); the local `statusToAction` log helpers are only used in signed-out/local mode.
6. **CORS**: client sends `credentials: "include"` and defaults to same-origin `/api`. If the API is ever hosted cross-origin, it must send `Access-Control-Allow-Credentials: true` and echo the exact origin.

## Deploy notes

- Upload the contents of `out/` (including the dotfile `.htaccess`) to the Apache docroot; the PHP API must live at `/api` (rewrites explicitly exclude it).
- `NEXT_PUBLIC_API_BASE` is baked at build time; rebuild to change it.
