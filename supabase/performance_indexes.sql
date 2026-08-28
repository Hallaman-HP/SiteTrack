-- Performance repair for hosted/RLS mode.
-- Run this in Supabase SQL Editor if secure loads or asset saves time out.

create index if not exists asset_photos_workspace_created_idx
on asset_photos(workspace_id, created_at desc)
where workspace_id is not null;

create index if not exists asset_logs_workspace_created_idx
on asset_logs(workspace_id, created_at desc)
where workspace_id is not null;

create index if not exists assets_workspace_updated_idx
on assets(workspace_id, updated_at desc)
where workspace_id is not null;

create index if not exists assets_site_updated_idx
on assets(site_id, updated_at desc)
where site_id is not null;

create index if not exists site_members_user_site_role_idx
on site_members(user_id, site_id, role);

create index if not exists workspace_members_user_workspace_role_idx
on workspace_members(user_id, workspace_id, role);
