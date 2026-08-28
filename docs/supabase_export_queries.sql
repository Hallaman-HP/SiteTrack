-- SiteTrack: Supabase → MySQL migration, step 1 (EXPORT)
-- Run each query in the Supabase SQL editor and download the result as CSV,
-- naming each file exactly as shown. Keep all files in one folder, e.g. ./export/
--
-- If a result is too large for the dashboard download (asset_photos often is,
-- because photos are stored as base64 data URLs), use psql locally instead:
--   psql "$SUPABASE_DB_URL" -c "\copy (SELECT ...) TO 'asset_photos.csv' CSV HEADER"

-- users.csv  (auth users; bcrypt hashes migrate directly to PHP password_verify)
select u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.created_at
from auth.users u
order by u.created_at;

-- profiles.csv
select id, first_name, last_name, display_name, avatar_path, created_at
from public.profiles;

-- workspaces.csv
select id, name, join_code, created_at from public.workspaces;

-- workspace_members.csv
select id, workspace_id, user_id, role, created_at from public.workspace_members;

-- sites.csv
select id, workspace_id, name, address, client_name, job_number, created_at
from public.sites;

-- site_members.csv
select id, site_id, user_id, role, created_at from public.site_members;

-- invites.csv (only pending ones matter; accepted invites are historical)
select id, workspace_id, site_id, email, role, created_at
from public.invites
where accepted_at is null;

-- buildings.csv
select id, site_id, name, created_at from public.buildings;

-- rooms.csv
select id, building_id, room_number, room_name, floor, created_at from public.rooms;

-- assets.csv
select id, workspace_id, asset_number, serial_number, item_name, item_type,
       brand, model, mac_address, ip_address, switch_port, network_patch_number,
       site_id, building_id, room_id, location_in_room, patching_details,
       status, notes, archived_at, archived_by, archived_reason,
       created_at, updated_at
from public.assets;

-- asset_photos.csv  (large: base64 data URLs — prefer the psql \copy method)
select id, asset_id, photo_url, caption, created_at from public.asset_photos;

-- asset_logs.csv
select id, asset_id, action_type, previous_location, new_location, notes,
       user_name, created_at
from public.asset_logs;

-- Avatars: in Supabase Studio > Storage > profile-avatars, download each file
-- into ./export/avatars/ keeping the same file names as profiles.avatar_path.
