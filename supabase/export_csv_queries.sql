-- SiteTrack CSV export queries for Supabase SQL Editor.
--
-- How to use:
-- 1. Open Supabase Dashboard > SQL Editor.
-- 2. Copy ONE export block at a time.
-- 3. Run it.
-- 4. Click Download CSV.
-- 5. Save using the filename shown above that block.
--
-- Keep these CSV files private. They may contain customer data, job-site data,
-- private notes, photo data URLs, and password hashes.

-- ============================================================
-- Save result as: users.csv
-- Sensitive: includes auth user password hashes.
-- ============================================================
select
  u.id,
  u.email,
  u.encrypted_password,
  u.email_confirmed_at,
  u.created_at
from auth.users u
order by u.created_at;

-- ============================================================
-- Save result as: profiles.csv
-- ============================================================
select
  id,
  first_name,
  last_name,
  display_name,
  avatar_path,
  created_at
from public.profiles
order by created_at;

-- ============================================================
-- Save result as: workspaces.csv
-- ============================================================
select
  id,
  name,
  join_code,
  created_by,
  created_at
from public.workspaces
order by created_at;

-- ============================================================
-- Save result as: workspace_members.csv
-- ============================================================
select
  id,
  workspace_id,
  user_id,
  role,
  created_at
from public.workspace_members
order by created_at;

-- ============================================================
-- Save result as: sites.csv
-- ============================================================
select
  id,
  workspace_id,
  name,
  address,
  client_name,
  job_number,
  created_at
from public.sites
order by created_at;

-- ============================================================
-- Save result as: site_members.csv
-- ============================================================
select
  id,
  site_id,
  user_id,
  role,
  created_at
from public.site_members
order by created_at;

-- ============================================================
-- Save result as: invites.csv
-- Pending invites only.
-- ============================================================
select
  id,
  workspace_id,
  site_id,
  email,
  role,
  token,
  invited_by,
  expires_at,
  created_at
from public.invites
where accepted_at is null
order by created_at;

-- ============================================================
-- Save result as: buildings.csv
-- ============================================================
select
  id,
  site_id,
  name,
  created_at
from public.buildings
order by created_at;

-- ============================================================
-- Save result as: rooms.csv
-- ============================================================
select
  id,
  building_id,
  room_number,
  room_name,
  floor,
  created_at
from public.rooms
order by created_at;

-- ============================================================
-- Save result as: assets.csv
-- ============================================================
select
  id,
  workspace_id,
  asset_number,
  serial_number,
  item_name,
  item_type,
  brand,
  model,
  mac_address,
  ip_address,
  switch_port,
  network_patch_number,
  site_id,
  building_id,
  room_id,
  location_in_room,
  patching_details,
  status,
  notes,
  archived_at,
  archived_by,
  archived_reason,
  created_at,
  updated_at
from public.assets
order by updated_at desc, created_at desc;

-- ============================================================
-- Save result as: asset_photos.csv
-- Warning: this can be very large if photo_url contains base64 data URLs.
-- ============================================================
select
  id,
  asset_id,
  workspace_id,
  site_id,
  photo_url,
  caption,
  storage_bucket,
  storage_path,
  created_by,
  created_at
from public.asset_photos
order by created_at;

-- ============================================================
-- Save result as: asset_logs.csv
-- ============================================================
select
  id,
  asset_id,
  workspace_id,
  site_id,
  action_type,
  previous_location,
  new_location,
  notes,
  user_name,
  created_by,
  created_at
from public.asset_logs
order by created_at;

-- ============================================================
-- Save result as: storage_objects.csv
-- Storage metadata only. This does not download actual files.
-- ============================================================
select
  id,
  bucket_id,
  name,
  owner,
  created_at,
  updated_at,
  last_accessed_at,
  metadata
from storage.objects
where bucket_id in ('asset-photos', 'profile-avatars')
order by bucket_id, name;
