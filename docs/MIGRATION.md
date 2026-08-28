# SiteTrack: Supabase → GoDaddy (MySQL) Migration

Moves all data from the Supabase project into the cPanel MySQL database used by
the PHP API. Companion doc: `docs/DEPLOYMENT.md` (app deployment). The import
is **idempotent** — you can re-run it safely if anything fails halfway.

What carries over and what does not:

| Item | Migrated? |
|---|---|
| Users + passwords | **Yes** — Supabase bcrypt (`$2a$…`) hashes work directly with PHP `password_verify()`; everyone keeps their current password |
| Email-verified status | Yes (`email_confirmed_at` → `users.email_verified_at`) |
| Profiles, avatars | Yes (avatar files copied into `UPLOADS_DIR/avatars/`) |
| Workspaces, members, sites, site members, buildings, rooms, assets, photos, logs | Yes |
| Pending invites | Rows yes, **links no** — token hashes are regenerated and never emailed; re-send invites after migration |
| Sessions / trusted-device (2FA skip) cookies | **No** — everyone logs in fresh and re-does 2FA once |
| Magic-link / password-reset tokens in flight | **No** — users just request a new one |

---

## Step 1 — Export CSVs from Supabase

Open the Supabase SQL editor and run each query in
`docs/supabase_export_queries.sql`, downloading each result as CSV with
**exactly** the file name in the comment above the query:

```
users.csv  profiles.csv  workspaces.csv  workspace_members.csv
sites.csv  site_members.csv  invites.csv  buildings.csv  rooms.csv
assets.csv  asset_photos.csv  asset_logs.csv
```

Put them all in one folder, e.g. `export/`. Only `users.csv` is mandatory —
the import script skips missing files with a warning.

**asset_photos.csv** is usually too large for the dashboard download (photos
are base64 data URLs). Use `psql` locally instead, as noted at the top of
`docs/supabase_export_queries.sql`:

```
psql "$SUPABASE_DB_URL" -c "\copy (select id, asset_id, photo_url, caption, created_at from public.asset_photos) to 'asset_photos.csv' csv header"
```

**Avatars**: in Supabase Studio → Storage → `profile-avatars`, download every
file into `export/avatars/`, keeping the same file names as
`profiles.avatar_path`.

While you're in the SQL editor, note the row counts for Step 4:

```sql
select 'users', count(*) from auth.users
union all select 'profiles', count(*) from public.profiles
union all select 'workspaces', count(*) from public.workspaces
union all select 'workspace_members', count(*) from public.workspace_members
union all select 'sites', count(*) from public.sites
union all select 'site_members', count(*) from public.site_members
union all select 'invites_pending', count(*) from public.invites where accepted_at is null
union all select 'buildings', count(*) from public.buildings
union all select 'rooms', count(*) from public.rooms
union all select 'assets', count(*) from public.assets
union all select 'asset_photos', count(*) from public.asset_photos
union all select 'asset_logs', count(*) from public.asset_logs;
```

## Step 2 — Create the MySQL database in cPanel

1. cPanel → **MySQL Databases**: create a database (e.g. `<acct>_sitetrack`),
   create a user, and add the user to the database with **ALL PRIVILEGES**.
2. cPanel → **phpMyAdmin** → select the new database → **Import** tab → upload
   `server/sql/mysql_schema.sql` → Go. You should see 18 tables afterwards.

## Step 3 — Upload and run the import

1. Upload the export folder **outside the web root**, e.g. to `~/export/`
   (File Manager upload of a zip + Extract is fastest for the large
   `asset_photos.csv`).
2. Upload the repo's `server/` directory outside the web root too, e.g. to
   `~/sitetrack-server/` (the import script lives at
   `server/migration/import_from_supabase.php` and needs its siblings
   `api/src/Env.php` and `.env` in place — keep the folder structure intact).
3. Create `~/sitetrack-server/.env` from `server/.env.example` and fill in at
   least `DB_HOST` (usually `localhost`), `DB_NAME`, `DB_USER`, `DB_PASS`
   (from Step 2) and `UPLOADS_DIR` (e.g. `/home/<acct>/sitetrack-uploads` —
   avatars are copied there). `chmod 600 ~/sitetrack-server/.env`.
4. Run it over SSH (GoDaddy shared hosting includes SSH — enable it under
   cPanel → SSH Access if needed):

   ```
   /usr/local/bin/php ~/sitetrack-server/migration/import_from_supabase.php ~/export
   ```

   The script refuses to run via the web (CLI only), imports in FK-safe order
   (users → workspaces → members → sites → … → asset_photos → asset_logs),
   streams `asset_photos.csv` in 200-row batches, and prints a per-table
   `imported / updated / skipped` summary. "Skipped" rows are orphans (parent
   row missing from the export) or invalid values — each prints a reason.
   Exit code 0 = success. Re-running is safe (upserts by id).

   **No SSH?** Run it once via cPanel → **Cron Jobs**: add a job scheduled a
   couple of minutes ahead with the command

   ```
   /usr/local/bin/php /home/<acct>/sitetrack-server/migration/import_from_supabase.php /home/<acct>/export >> /home/<acct>/import.log 2>&1
   ```

   wait for it to fire, check `~/import.log`, then **delete the cron entry**.

## Step 4 — Verify

1. **Row counts** — in phpMyAdmin, run and compare against the Step 1 numbers
   (`invites` compares against `invites_pending`):

   ```sql
   SELECT 'users', COUNT(*) FROM users
   UNION ALL SELECT 'workspaces', COUNT(*) FROM workspaces
   UNION ALL SELECT 'workspace_members', COUNT(*) FROM workspace_members
   UNION ALL SELECT 'sites', COUNT(*) FROM sites
   UNION ALL SELECT 'site_members', COUNT(*) FROM site_members
   UNION ALL SELECT 'invites', COUNT(*) FROM invites
   UNION ALL SELECT 'buildings', COUNT(*) FROM buildings
   UNION ALL SELECT 'rooms', COUNT(*) FROM rooms
   UNION ALL SELECT 'assets', COUNT(*) FROM assets
   UNION ALL SELECT 'asset_photos', COUNT(*) FROM asset_photos
   UNION ALL SELECT 'asset_logs', COUNT(*) FROM asset_logs;
   ```

   Small `users` differences are usually rows skipped for an empty
   `encrypted_password` (OAuth-only accounts) — the import prints these.

2. **Login** — after deploying the app (`docs/DEPLOYMENT.md`), log in with an
   existing account using its **current password**. Expect the 2FA email
   (arrives on the next cron dispatch, up to 5 minutes).
3. **Photos** — open an asset that had photos in Supabase and confirm they
   render (photos live in the DB as data URLs, so no file copying involved).
4. **Avatars** — check a user with an avatar shows it (Account page), and that
   the files exist in `UPLOADS_DIR/avatars/`. The import warns about any
   avatar file missing from `export/avatars/`.
5. **Invites** — re-send any pending invites (old links are dead by design).
