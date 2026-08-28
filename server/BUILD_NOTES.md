# SiteTrack PHP Backend — Build Notes

Built: 2026-08-28. Target: GoDaddy shared cPanel, PHP 8.1+, MySQL/MariaDB, Apache.
No Composer dependencies — plain PHP with PDO, GD, finfo only.

## Test results

`php server/tests/api_test.php` against `php -S 127.0.0.1:8080 dev-router.php`
(PHP 8.5.4 CLI, local MariaDB, schema loaded from `sql/mysql_schema.sql`):

**129 PASS / 0 FAIL** — `php -l` clean on all 17 PHP files.

Coverage includes: signup + email verification gate, full 2FA login flow
(code read from notifications table, wrong-code rejection, single-use
challenge), trusted-device 2FA skip on second login, magic-link flow
(single-use, no enumeration), password reset flow (kills all sessions),
change-password (requires current password, invalidates other sessions,
keeps current), CSRF header rejection, login rate limiting (429 on 11th/min),
workspace create (8-hex-upper join code) / join by code / regenerate-code,
invites (create/list/accept/delete, manager-scope denial, single-use),
site/building/room upsert + edit + delete (permission-style errors on 0-row
deletes), asset save (required-field validation, blank->NULL normalisation,
statusToAction log rows, "New asset"/previous-location logic, photo insert,
per-workspace asset_number uniqueness), archive/restore with log rows,
asset/photo delete permissions, `/api/store` scoping with a second non-admin
user (viewer sees only assigned site, cannot see other sites' assets, cannot
edit; technician can save but not delete/archive; archived assets hidden from
non-admins but visible to admin; join_code hidden from members;
editableSiteIds/manageableSiteIds semantics), last-admin protection
(demote + remove), gate endpoint, members listing scope, profile update,
avatar upload (GD re-encode to 512px jpeg, finfo rejection of fake images,
workspace-scoped serving), cascade deletes, unknown-route 404, and the cron
dispatcher (cron_runs logging, lock release, overlap-lock skip, pending
notification processing).

## Layout

```
server/
  .env.example          all config keys, commented
  .env                  local dev config (not for deployment)
  dev-router.php        router for `php -S` local testing
  api/
    .htaccess           deny src/ + .env, route /api/* -> index.php
    index.php           front controller, route table, global error handler
    src/
      Env.php           .env loader (KEY=VALUE, skip #, putenv) — OHS convention
      Db.php            PDO singleton, forces connection time_zone '+00:00'
      Util.php          uuid4, tokens, ISO-8601 Z timestamps, JSON I/O, CSRF,
                        blankToNull + normalizeAssetRow (identical to supabaseStore),
                        statusToAction, ApiError
      Auth.php          sessions (rolling 30d), st_session/st_trust cookies,
                        2FA tokens, trusted devices, DB-backed rate limiting,
                        user payload + displayName logic
      Access.php        role checks mirroring lib/roles.ts + effective site role
      Mailer.php        queue() into notifications + renderers (2FA, magic,
                        verify, reset, invite)
      AuthController.php / ProfileController.php / StoreController.php /
      WorkspaceController.php / MemberController.php / SiteController.php /
      AssetController.php
  cron/dispatch.php     CLI-only email dispatcher (cron_locks overlap lock,
                        stale-lock clear >10 min, attempts<5, SMTP w/ 15s
                        timeout or mail(), logs to cron_runs)
  sql/mysql_schema.sql  unchanged
  tests/api_test.php    129-assertion integration suite
```

## Contract compliance highlights

- **/api/store** replicates `loadSupabaseStore()` exactly, including quirks:
  site_members are queried across ALL workspaces (as the Supabase code does),
  admin sees all workspace sites/assets including archived, non-admin gets
  site_members sites with archived excluded, photos/logs filtered to visible
  assets, `editableSiteIds`/`manageableSiteIds` are `[]` for admins, and
  `join_code` appears only on admin memberships. Row shapes match
  `lib/types.ts` — nullable text columns come back as `""`, timestamps as
  `YYYY-MM-DDTHH:MM:SSZ` (stored as UTC DATETIME; PDO session tz +00:00).
  `asset_photos`/`asset_logs` have no workspace_id column in MySQL, so the
  admin branch joins through `assets` (equivalent result).
- **/api/assets/save** replicates `saveAssetToSupabase()`: same required-field
  error text, `normalizeAssetRow` blank->NULL normalisation, log row with
  statusToAction mapping, `previous_location` = existing location or
  `"New asset"`, notes `"Asset record updated."` / `"Asset created from add
  asset form."`, optional photo row with caption `"Uploaded photo"`. Extra
  server-side hardening: building must belong to the site, room to the
  building, and the asset cannot move across workspaces.
- All state-changing requests require `X-Requested-With: SiteTrack`; every
  endpoint re-checks membership/roles in SQL; deletes that affect 0 rows (or
  fail the permission check) return the "You do not have permission to delete
  this X, or it no longer exists." wording.
- Tokens: 64-hex raw values, only SHA-256 hashes stored, constant-time
  compares; 2FA codes 6 digits / 10 min / max 5 attempts; magic 15 min;
  verify 24 h; reset 60 min; invites 14 days. Sessions 30-day rolling;
  trust cookie 7 days. Rate limiting 10/min per IP+identifier on
  login/2fa/magic/reset/signup/join/invite-accept via the rate_limits table.
- Avatars validated by finfo + getimagesize, re-encoded with GD (transparency
  flattened onto white), capped at 512 px, always stored as
  `UPLOADS_DIR/avatars/<user_id>.jpg`; served only to self or workspace peers.
- Cookies are `Secure` when APP_URL is https (so local http testing works);
  always httpOnly + SameSite=Lax + Path=/.

## Interpretations / deviations (contract was silent or ambiguous)

1. **user_name display logic** — task text said `display_name || first+last
   || email`, but `lib/profiles.ts displayName()` (what saveAssetToSupabase
   actually calls) is `first+last || display_name || email`. Implemented the
   lib behaviour, since the requirement was "identical to current
   saveAssetToSupabase".
2. **Avatar extension** — contract says `<user_id>.<ext>`; task says re-encode
   to `<user_id>.jpg`. Implemented `.jpg` (single canonical format).
3. **Invite accept** — possession of the emailed token is treated as
   authorization; the accepting account's email does not have to match the
   invited address (contract didn't require a match). Invite `role=admin`
   grants workspace admin; site roles grant `member` + site_members row.
4. **Site creation** — only workspace admins can create sites (managers only
   manage existing sites, per the role table). Site *editing* is allowed for
   admin or that site's manager.
5. **Unverified login** — with REQUIRE_EMAIL_VERIFY=1, login before
   verification returns 403 "Please verify your email address…" (contract
   didn't specify the behaviour).
6. **Password minimum** — 8 characters (contract silent).
7. **Magic link / reset also mark the email verified** (possession of inbox
   proves ownership).
8. **GET /api/gate** returns `{hasWorkspace:false, canAddAssets:false}` for
   unauthenticated callers (mirrors `loadWorkspaceGate()` with no user)
   instead of a 401.
9. **members list for plain members** returns empty arrays rather than an
   error (managers get their sites' site_members; admins get everything),
   matching the "admin: all; manager: site_members for managed sites" table.
10. **schema** — used exactly as provided; no bugs found, no changes made.

## Deployment (GoDaddy cPanel)

1. Upload `server/api/` under the docroot at `/api/` (index.php, .htaccess, src/).
2. Put `.env`, `cron/`, and the uploads dir OUTSIDE the docroot; if `.env`
   must sit near the docroot the .htaccess deny rules cover it. `Env::load()`
   defaults to two levels above `api/src` (i.e. `server/.env`) and accepts a
   custom path.
3. Import `sql/mysql_schema.sql` via phpMyAdmin.
4. Cron every 5 min: `/usr/local/bin/php /home/<user>/server/cron/dispatch.php`.
5. Fill `.env` from `.env.example` (SMTP optional — falls back to PHP mail()).
