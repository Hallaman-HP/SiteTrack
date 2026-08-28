# SiteTrack Backup

Use the PowerShell backup script to export the Supabase database plus Storage photos.

```powershell
npm run backup:supabase
```

The database dump step requires Docker Desktop to be installed and running, because Supabase CLI runs `pg_dump` through Docker.

If you only want to download photos for now, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-supabase.ps1 -SkipDatabase
```

The backup is written to:

```text
backups/sitetrack-yyyy-MM-dd_HH-mm-ss/
```

It includes:

- `database/sitetrack-database.sql`
- `storage/asset-photos/`
- `storage/profile-avatars/`
- `README-restore-steps.md`
- `backup-log.txt`

If Supabase asks for your database password, rerun with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-supabase.ps1 -DatabasePassword "YOUR_DATABASE_PASSWORD"
```

To back up only the database:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-supabase.ps1 -SkipStorage
```

To back up only Storage photos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-supabase.ps1 -SkipDatabase
```

To keep downloading anything that works even if one step fails:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-supabase.ps1 -ContinueOnError
```

Keep the `backups/` folder private. It can contain job-site records, customer information, and photos.
