# SiteTrack: GoDaddy cPanel Deployment

Deploys the static Next.js export + PHP/MySQL API to GoDaddy shared hosting.
**This supersedes the old `DEPLOYMENT.md` at the repo root** (Vercel +
Supabase), which no longer applies on the `godaddy-port` branch.

Data migration from Supabase is a separate step: `docs/MIGRATION.md`.

## 0. Prerequisites

- A subdomain (e.g. `sitetrack.yourdomain.com.au`) created in cPanel →
  **Domains**, with its own document root (e.g.
  `/home/<acct>/sitetrack.yourdomain.com.au` — referred to as `<docroot>`
  below).
- **PHP version**: cPanel → **Select PHP Version** (MultiPHP Manager). The API
  code needs **PHP 8.0 as the hard syntax minimum** (it uses `match` and
  `str_starts_with`, both PHP 8.0 — see `server/api/src/ProfileController.php`
  and `server/api/src/Auth.php`; no 8.1-only syntax is used). The project
  targets and was tested on **PHP 8.1+** (`server/BUILD_NOTES.md`), so select
  **8.1 or newer** — ideally the newest 8.x offered. Required extensions
  (usually on by default): `pdo_mysql`, `gd`, `fileinfo`.
- MySQL database + user created and `server/sql/mysql_schema.sql` imported
  (Step 2 of `docs/MIGRATION.md`).

## 1. Build the frontend locally

```
npm install
npm run build
```

`next.config.mjs` has `output: "export"`, so the build writes the static site
to `out/` (including the Apache config `out/.htaccess`, copied from
`public/.htaccess`).

## 2. Upload

| From the repo | To the server |
|---|---|
| contents of `out/` (including `.htaccess`) | `<docroot>/` |
| `server/api/` (index.php, `.htaccess`, `src/`) | `<docroot>/api/` |
| `server/cron/` | `<docroot>/cron/` |
| `server/.env` (created below) | `<docroot>/.env` |

Layout constraints baked into the code — do not rearrange:

- `server/api/index.php` loads the config from **one level above `api/`**
  (`Env::load(dirname(__DIR__) . '/.env')`), so the `.env` file must sit at
  `<docroot>/.env`, next to the `api/` folder.
- `server/cron/dispatch.php` requires `../api/src/Env.php` and `../.env`, so
  `cron/` must also be a **sibling** of `api/` and `.env`.
- `cron/dispatch.php` refuses web requests (CLI-only, 403), so it is safe
  under the docroot.

**Dotfiles**: `out/.htaccess`, `server/api/.htaccess` and `.env` are hidden by
default in cPanel File Manager — click **Settings → Show Hidden Files
(dotfiles)** and confirm all three are actually there after uploading. A
missing docroot `.htaccess` breaks all page routes; a missing `api/.htaccess`
breaks every API call.

## 3. Configure `.env`

Copy `server/.env.example`, fill in, upload to `<docroot>/.env`:

- `DB_HOST=localhost`, `DB_NAME`/`DB_USER`/`DB_PASS` from cPanel MySQL.
- `APP_URL=https://sitetrack.yourdomain.com.au` (no trailing slash; must be
  `https://` — it drives `Secure` cookies and all email links).
- `UPLOADS_DIR=/home/<acct>/sitetrack-uploads` — **outside the docroot**;
  create the folder. Avatar images are written to `<UPLOADS_DIR>/avatars/`.
- `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME`; SMTP settings are optional — leave
  `SMTP_HOST` empty to fall back to PHP `mail()`.
- `REQUIRE_EMAIL_VERIFY=1` and `REQUIRE_2FA=1`.

Then lock it down (the code expects `.env` next to `api/`, which is inside the
docroot, so both steps are mandatory):

1. Permissions **600** (File Manager → right-click → Change Permissions).
2. The docroot `.htaccess` shipped in `out/` (from `public/.htaccess`) denies
   all dotfiles via `<FilesMatch "^\.">` — confirm it uploaded (Show Hidden
   Files) and was not stripped.

   Verify: `https://sitetrack.yourdomain.com.au/.env` must return 403/404,
   never the file contents.

## 4. Cron (email dispatcher)

All email (2FA codes, verification, magic links, resets, invites) is queued in
the `notifications` table and sent by `cron/dispatch.php`. cPanel → **Cron
Jobs**, every 5 minutes:

```
*/5 * * * *  /usr/local/bin/php /home/<acct>/<docroot-folder>/cron/dispatch.php >> /home/<acct>/sitetrack-cron.log 2>&1
```

(e.g. `/home/<acct>/sitetrack.yourdomain.com.au/cron/dispatch.php` — the
`dispatch.php` you uploaded in Step 2.) It has its own overlap lock
(`cron_locks`), retries failures up to 5 attempts, and logs each run to the
`cron_runs` table. Check `~/sitetrack-cron.log` if emails stop arriving.

## 5. HTTPS

cPanel → **SSL/TLS Status** → run **AutoSSL** for the subdomain (GoDaddy
issues the cert automatically; camera capture and Secure cookies require
HTTPS). Then verify the API is up:

```
https://sitetrack.yourdomain.com.au/api/health
```

must return `{"ok":true,"db":true,"time":"..."}`. `"db":false`/500 means the
`.env` DB credentials are wrong or `.env` is in the wrong place.

## 6. Post-deploy smoke test

1. `/api/health` returns `{"ok":true,"db":true,...}` (Step 5).
2. Open the site root — the login page loads (also try a deep link like
   `/sites/` directly: the `.htaccess` rewrites should serve it, not 404).
3. **Migrated login** (if data was migrated): log in with an existing user's
   current password → "enter the code we emailed you" appears.
4. **2FA email arrives** within 5 minutes (cron dispatch). If not: check
   `~/sitetrack-cron.log`, the `notifications` table (`status`, `last_error`),
   and spam folders.
5. Complete 2FA, optionally tick "trust this device", and confirm a second
   login skips the code.
6. Or fresh install: sign up, receive the verification email, verify, log in.
7. Open an asset with photos → photos render; open Account → avatar shows.
8. Create a test asset, then delete it — confirms write permissions and role
   checks end-to-end.
