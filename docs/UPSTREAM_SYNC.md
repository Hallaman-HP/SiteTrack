# Upstream sync checklist — `godaddy-port`

**Upstream:** `NandrewBCannon/SiteTrack` (`main` branch — Next.js + Supabase original)
**Local:** `Hallaman-HP/SiteTrack` (`godaddy-port` branch — same frontend, PHP/MySQL backend)

The `godaddy-port` fork replaces Supabase with a PHP/MySQL API and adds a `server/` tree. Upstream keeps evolving the Next.js app and Supabase side. This document is the merge SOP.

Run `scripts/sync-upstream.sh` first — it prints a categorised breakdown of incoming changes and drives the merge. Everything below explains **what to do with each category**.

---

## The shape of this fork (what to protect during merges)

Roughly 2900 net-added lines vs. the merge base:

- **Frontend swap (~+1572 / -1274 across 29 files):** every Supabase call has been rewired to the PHP REST API in `lib/api.ts`. Auth is now email OTP + 2FA via `POST /api/auth/*` instead of Supabase Auth.
- **Server (~+4640 lines, 27 new files):** the entire `server/` tree — PHP controllers, cron, schema, migration tooling, tests. Upstream has no equivalent; upstream should never touch this.
- **Config:** `next.config.mjs` enables static export (`output: "export"`); we deploy `out/` to GoDaddy.
- **Client-side image compression:** `lib/imageCompression.ts` + `components/AssetForm.tsx` compress to ≤200 KB JPEG before upload.

Anything upstream does that assumes Supabase is present at runtime needs to be translated to the API-client shape before it can land.

---

## Categories the sync script prints

### HIGH RISK — data layer
Files: `lib/supabase*`, `lib/api.ts`, `lib/store.ts`, `lib/useStoreData.ts`, `lib/profiles.ts`.

If upstream touches these, the change is almost certainly a Supabase call pattern that needs translation:

- `supabase.from('table').select(...)` → equivalent `apiGet('/table/list')` / `apiPost` in `lib/api.ts`
- `supabase.auth.*` → equivalent `/api/auth/*` call
- `supabase.storage.*` → equivalent `/api/photo` or `/api/profile/avatar` call

Translation pattern:
1. Take the merge conflict marker as a spec ("upstream wants to do X").
2. Add or extend the matching endpoint in `lib/api.ts`.
3. If the endpoint doesn't exist server-side yet, add it in `server/api/src/*Controller.php` and register in `server/api/index.php`.
4. Update `server/tests/api_test.php` to cover it.

### HIGH RISK — auth surface
Files: `components/Auth*`, `components/JoinWorkspace*`, `components/AccountClient.tsx`, `app/auth/*`, `app/login/*`, `app/signup/*`, `app/join/*`.

Our auth flow is different — we use PHP-issued session cookies + email OTP + optional 2FA. If upstream reworks a login screen, you probably want the **UI change** but not the underlying Supabase auth calls. Merge tactic:

1. Accept upstream's JSX/UI edits.
2. Keep our `useAuth()` provider and API calls.
3. In `components/AuthProvider.tsx` — our version is the source of truth; if it conflicts, resolve toward ours.

### MEDIUM — Supabase schema migrations
Files: `supabase/migrations/*.sql`.

Upstream schema changes need to be **mirrored** into MySQL:

1. Read the incoming SQL file. Note new tables, columns, indexes, constraints.
2. Add an idempotent `ALTER TABLE` or `CREATE TABLE IF NOT EXISTS` block to `server/sql/mysql_schema.sql` (Postgres → MySQL type mapping: `uuid` → `CHAR(36)`, `jsonb` → `JSON`, `timestamptz` → `DATETIME`, `text` → `LONGTEXT`/`VARCHAR(n)`).
3. Add a runnable migration script under `server/migration/sql/` named `NNNN_<description>.sql`.
4. If the change requires backfill (new column with default from other columns), write a PHP script in `server/migration/` following the `import_from_supabase.php` pattern.
5. Test against a copy of prod before running on prod.

### MEDIUM — other frontend (`app/`, `components/`, `lib/`, `styles/`)
Most upstream frontend edits should merge cleanly. Watch for:

- New components that call Supabase → translate before committing.
- Changes to `AssetForm.tsx` — we own the `handlePhotoFile` + compression block. Take upstream edits to fields/validation, keep our capture path.
- Changes to `next.config.mjs` — we need `output: "export"` and `trailingSlash: true` to survive; those must remain.

### LOW — server/PHP files touched upstream
This should never happen — upstream doesn't know about `server/`. If it does, review carefully; probably a rebase artifact or a coincidental path.

### LOW — config files
`package.json`, `.gitignore`, `tsconfig.json`, `postcss.config.mjs`, `tailwind.config.ts`.

Merge conflicts here are usually additive on both sides. Manual merge in an editor, keep both sets of entries.

**When `package.json` changes:**
- If upstream adds a dependency → run `npm install` after the merge and commit the updated `package-lock.json`.
- If upstream removes/downgrades → confirm nothing in our code still uses it (grep the codebase) before accepting.

### LOW — non-app files (docs, scripts, `supabase/` non-migration files)
Accept upstream as-is. If it's a Supabase-specific script we can't use on GoDaddy (e.g. `scripts/backup-supabase.ps1`), leave it in place — it's harmless and might document intent worth mirroring on our side.

---

## Standard workflow

```bash
# Preview only
scripts/sync-upstream.sh

# Merge, review, then commit manually
scripts/sync-upstream.sh --merge

# Merge and auto-commit only if there are zero conflicts (CI-friendly)
scripts/sync-upstream.sh --merge --yes
```

After the merge is committed:

```bash
# Frontend smoke test
npm ci
npm run build        # must succeed; `out/` is what we deploy
npm run lint

# Rebuild the deployment zip
scripts/build-deploy-zip.sh   # (if present) or manually zip out/ + server/
```

Deploy the new `out/` bundle to `/home/nwrmkli2hv0p/sitetrack/` and only touch server-side files if the merge introduced backend changes.

---

## When a merge is too messy

If the merge produces conflicts across many files (e.g., upstream refactored `lib/` broadly), consider **cherry-picking** the upstream commits you actually want instead of a full merge:

```bash
git log --oneline HEAD..upstream/main       # find the commits you want
git cherry-pick <sha>                        # pull them one at a time
```

Cherry-picking is safer for feature-level pulls but leaves the merge base behind, so future syncs will show those commits as "still incoming". Document any cherry-picks in the commit message so a future full merge can skip them.

---

## Post-merge quick audit

Before pushing:

1. `git diff origin/godaddy-port` — quick visual scan for anything unexpected.
2. Search for accidentally-reintroduced Supabase calls in files we own:
   ```bash
   grep -rn "supabase\." components/ app/ lib/ --include="*.ts" --include="*.tsx" \
     | grep -v "lib/supabase\.ts\|lib/supabaseStore\.ts\|lib/supabaseAdmin\.ts"
   ```
3. `npm run build` must succeed.
4. Push: `git push origin godaddy-port`.
