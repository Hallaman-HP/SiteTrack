-- Allows managers and admins to permanently delete assets from job sites they manage.
-- Run this in Supabase SQL Editor after the workforce/security schema files.

revoke execute on function public.can_manage_site_access(uuid) from anon, public;
grant execute on function public.can_manage_site_access(uuid) to authenticated;

drop policy if exists "Admins can delete assets" on assets;
drop policy if exists "Managers can delete assets" on assets;
create policy "Managers can delete assets"
on assets for delete to authenticated
using (can_manage_site_access(site_id));

drop policy if exists "Admins can delete photos" on asset_photos;
drop policy if exists "Managers can delete photos" on asset_photos;
create policy "Managers can delete photos"
on asset_photos for delete to authenticated
using (
  exists (
    select 1
    from assets
    where assets.id = asset_photos.asset_id
      and can_manage_site_access(assets.site_id)
  )
);

drop policy if exists "Admins can delete logs" on asset_logs;
drop policy if exists "Managers can delete logs" on asset_logs;
create policy "Managers can delete logs"
on asset_logs for delete to authenticated
using (
  exists (
    select 1
    from assets
    where assets.id = asset_logs.asset_id
      and can_manage_site_access(assets.site_id)
  )
);
