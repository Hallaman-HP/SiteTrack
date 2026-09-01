param(
  [string]$ProjectRef = "kchmypllwgdpueytaghi",
  [string]$OutputRoot = "backups",
  [string[]]$Buckets = @("asset-photos", "profile-avatars"),
  [string]$DatabasePassword = "",
  [string]$SupabaseUrl = "",
  [string]$ServiceRoleKey = "",
  [switch]$SkipDatabase,
  [switch]$SkipStorage,
  [switch]$SkipEmbeddedPhotos,
  [switch]$ContinueOnError
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Supabase {
  param([string[]]$Arguments)

  $supabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue
  if ($supabaseCommand) {
    & supabase @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Supabase CLI failed with exit code $LASTEXITCODE`: supabase $($Arguments -join ' ')"
    }
    return
  }

  $npxCommand = Get-Command npx -ErrorAction SilentlyContinue
  if (-not $npxCommand) {
    throw "Could not find 'supabase' or 'npx' on PATH. Install Node.js/npm, then run this again."
  }

  & npx supabase @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI failed with exit code $LASTEXITCODE`: npx supabase $($Arguments -join ' ')"
  }
}

function Test-DockerAvailable {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) { return $false }

  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Get-DotEnvValue {
  param([string]$Name)

  $envFile = Join-Path (Get-Location) ".env.local"
  if (-not (Test-Path -LiteralPath $envFile)) { return "" }

  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -First 1
  if (-not $line) { return "" }

  return ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim().Trim('"').Trim("'")
}

function Export-EmbeddedAssetPhotos {
  param(
    [string]$BackupDir,
    [string]$ApiUrl,
    [string]$ApiKey
  )

  if (-not $ApiUrl.Trim()) {
    throw "Embedded photo export needs -SupabaseUrl or NEXT_PUBLIC_SUPABASE_URL in .env.local."
  }
  if (-not $ApiKey.Trim()) {
    throw "Embedded photo export needs -ServiceRoleKey or SUPABASE_SERVICE_ROLE_KEY set in this PowerShell session."
  }

  $photoDir = Join-Path $BackupDir "database-embedded-photos"
  New-Item -ItemType Directory -Force -Path $photoDir | Out-Null

  $headers = @{
    apikey = $ApiKey
    Authorization = "Bearer $ApiKey"
  }
  $manifest = @()
  $offset = 0
  $limit = 500

  while ($true) {
    $uri = "$($ApiUrl.TrimEnd('/'))/rest/v1/asset_photos?select=id,asset_id,photo_url,caption,created_at&order=created_at.desc&limit=$limit&offset=$offset"
    $rows = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
    if (-not $rows -or $rows.Count -eq 0) { break }

    foreach ($row in $rows) {
      $assetDir = Join-Path $photoDir $row.asset_id
      New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

      $photoUrl = [string]$row.photo_url
      $savedPath = ""
      $kind = "reference"

      if ($photoUrl -match "^data:image/([^;]+);base64,(.+)$") {
        $extension = $Matches[1].ToLower()
        if ($extension -eq "jpeg") { $extension = "jpg" }
        $bytes = [Convert]::FromBase64String($Matches[2])
        $savedPath = Join-Path $assetDir "$($row.id).$extension"
        [IO.File]::WriteAllBytes($savedPath, $bytes)
        $kind = "embedded-data-url"
      } else {
        $savedPath = Join-Path $assetDir "$($row.id).url.txt"
        Set-Content -LiteralPath $savedPath -Value $photoUrl -Encoding UTF8
      }

      $manifest += [pscustomobject]@{
        id = $row.id
        asset_id = $row.asset_id
        caption = $row.caption
        created_at = $row.created_at
        kind = $kind
        file = $savedPath
      }
    }

    if ($rows.Count -lt $limit) { break }
    $offset += $limit
  }

  $manifestPath = Join-Path $photoDir "manifest.csv"
  $manifest | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8
  return $manifest.Count
}

function New-BackupReadme {
  param(
    [string]$BackupDir,
    [string]$DatabaseFile,
    [string[]]$DownloadedBuckets,
    [int]$EmbeddedPhotoCount
  )

  $bucketList = if ($DownloadedBuckets.Count) {
    ($DownloadedBuckets | ForEach-Object { "- storage/$_" }) -join [Environment]::NewLine
  } else {
    "- No storage buckets downloaded"
  }

  $content = @"
# SiteTrack Supabase Backup

Created: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Project ref: $ProjectRef

## Contents

- database/$([System.IO.Path]::GetFileName($DatabaseFile))
$bucketList
- database-embedded-photos/ ($EmbeddedPhotoCount asset photo records exported)
- backup-log.txt

## Restore Notes

1. Restore the SQL file into a clean Supabase/Postgres project.
2. Recreate Storage buckets before uploading files back:
   - asset-photos
   - profile-avatars
3. Upload each bucket folder back to the matching Supabase Storage bucket.
4. Recheck RLS policies, Auth settings, site memberships, and public URL settings before using production data.

Database dumps contain table rows and database structure, but Storage photos are separate files. Keep this folder private because it may contain customer/job-site data and photos.
"@

  Set-Content -LiteralPath (Join-Path $BackupDir "README-restore-steps.md") -Value $content -Encoding UTF8
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = Join-Path $OutputRoot "sitetrack-$timestamp"
$databaseDir = Join-Path $backupDir "database"
$storageDir = Join-Path $backupDir "storage"
$logFile = Join-Path $backupDir "backup-log.txt"

New-Item -ItemType Directory -Force -Path $databaseDir, $storageDir | Out-Null

Start-Transcript -Path $logFile -Append | Out-Null

try {
  Write-Step "Checking Supabase CLI"
  Invoke-Supabase -Arguments @("--version")

  $downloadedBuckets = @()
  $embeddedPhotoCount = 0
  $databaseFile = Join-Path $databaseDir "sitetrack-database.sql"
  $failedSteps = @()

  if (-not $SkipDatabase) {
    Write-Step "Exporting database"
    if (-not (Test-DockerAvailable)) {
      $message = "Database export skipped because Supabase CLI db dump requires Docker Desktop to be installed and running."
      Write-Warning $message
      $failedSteps += $message
    } else {
      try {
        $dbArgs = @("db", "dump", "--project-ref", $ProjectRef, "--file", $databaseFile)
        if ($DatabasePassword.Trim()) {
          $dbArgs += @("--password", $DatabasePassword)
        }
        Invoke-Supabase -Arguments $dbArgs
      } catch {
        $failedSteps += $_.Exception.Message
        if (-not $ContinueOnError) { throw }
        Write-Warning $_.Exception.Message
      }
    }
  }

  if (-not $SkipStorage) {
    foreach ($bucket in $Buckets) {
      if (-not $bucket.Trim()) { continue }

      Write-Step "Downloading Storage bucket '$bucket'"
      $bucketDest = Join-Path $storageDir $bucket
      New-Item -ItemType Directory -Force -Path $bucketDest | Out-Null
      try {
        Invoke-Supabase -Arguments @("--experimental", "storage", "cp", "--recursive", "--project-ref", $ProjectRef, "ss:///$bucket", $bucketDest)
        $downloadedBuckets += $bucket
      } catch {
        $failedSteps += $_.Exception.Message
        if (-not $ContinueOnError) { throw }
        Write-Warning $_.Exception.Message
      }
    }
  }

  if (-not $SkipEmbeddedPhotos) {
    Write-Step "Exporting embedded asset photos from database rows"
    try {
      $apiUrl = if ($SupabaseUrl.Trim()) { $SupabaseUrl } else { Get-DotEnvValue -Name "NEXT_PUBLIC_SUPABASE_URL" }
      $apiKey = if ($ServiceRoleKey.Trim()) { $ServiceRoleKey } else { [Environment]::GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY") }
      $embeddedPhotoCount = Export-EmbeddedAssetPhotos -BackupDir $backupDir -ApiUrl $apiUrl -ApiKey $apiKey
    } catch {
      $failedSteps += $_.Exception.Message
      if (-not $ContinueOnError) { throw }
      Write-Warning $_.Exception.Message
    }
  }

  New-BackupReadme -BackupDir $backupDir -DatabaseFile $databaseFile -DownloadedBuckets $downloadedBuckets -EmbeddedPhotoCount $embeddedPhotoCount

  Write-Host ""
  if ($failedSteps.Count) {
    Write-Host "Backup finished with warnings:" -ForegroundColor Yellow
    $failedSteps | ForEach-Object { Write-Host "- $_" -ForegroundColor Yellow }
  } else {
    Write-Host "Backup complete:" -ForegroundColor Green
  }
  Write-Host (Resolve-Path $backupDir)
} finally {
  Stop-Transcript | Out-Null
}
