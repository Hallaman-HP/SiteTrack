-- Move internal RLS helper functions out of the public API surface.
-- This reduces Supabase linter warnings for SECURITY DEFINER helpers that are
-- meant for policies/triggers only, not direct /rest/v1/rpc calls.

create schema if not exists app_private;

revoke all on schema app_private from anon, authenticated, public;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1
    from workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
';

create or replace function app_private.has_workspace_role(target_workspace_id uuid, allowed_roles workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1
    from workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
';

create or replace function app_private.can_access_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        app_private.has_workspace_role(sites.workspace_id, array[''admin'']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
        )
      )
  );
';

create or replace function app_private.can_admin_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        app_private.has_workspace_role(sites.workspace_id, array[''admin'']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
            and site_members.role = ''admin''
        )
      )
  );
';

create or replace function app_private.can_manage_site_access(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        app_private.has_workspace_role(sites.workspace_id, array[''admin'']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
            and site_members.role in (''admin'', ''manager'')
        )
      )
  );
';

create or replace function app_private.can_edit_assets_on_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as '
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        app_private.has_workspace_role(sites.workspace_id, array[''admin'']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
            and site_members.role in (''admin'', ''manager'', ''technician'')
        )
      )
  );
';

revoke execute on function app_private.is_workspace_member(uuid) from anon, authenticated, public;
revoke execute on function app_private.has_workspace_role(uuid, workspace_role[]) from anon, authenticated, public;
revoke execute on function app_private.can_access_site(uuid) from anon, authenticated, public;
revoke execute on function app_private.can_admin_site(uuid) from anon, authenticated, public;
revoke execute on function app_private.can_manage_site_access(uuid) from anon, authenticated, public;
revoke execute on function app_private.can_edit_assets_on_site(uuid) from anon, authenticated, public;

grant execute on function app_private.is_workspace_member(uuid) to authenticated;
grant execute on function app_private.has_workspace_role(uuid, workspace_role[]) to authenticated;
grant execute on function app_private.can_access_site(uuid) to authenticated;
grant execute on function app_private.can_admin_site(uuid) to authenticated;
grant execute on function app_private.can_manage_site_access(uuid) to authenticated;
grant execute on function app_private.can_edit_assets_on_site(uuid) to authenticated;

drop policy if exists "Members can read workspaces" on workspaces;
drop policy if exists "Users can create workspaces" on workspaces;
drop policy if exists "Admins can update workspaces" on workspaces;
drop policy if exists "Admins can delete workspaces" on workspaces;
create policy "Members can read workspaces"
on workspaces for select to authenticated
using (app_private.is_workspace_member(id));
create policy "Users can create workspaces"
on workspaces for insert to authenticated
with check (created_by = auth.uid());
create policy "Admins can update workspaces"
on workspaces for update to authenticated
using (app_private.has_workspace_role(id, array['admin']::workspace_role[]))
with check (app_private.has_workspace_role(id, array['admin']::workspace_role[]));
create policy "Admins can delete workspaces"
on workspaces for delete to authenticated
using (app_private.has_workspace_role(id, array['admin']::workspace_role[]));

drop policy if exists "Members can read own workspace membership" on workspace_members;
drop policy if exists "Admins can manage workspace members" on workspace_members;
drop policy if exists "Users can leave workspace" on workspace_members;
create policy "Members can read own workspace membership"
on workspace_members for select to authenticated
using (
  user_id = auth.uid()
  or app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[])
  or exists (
    select 1
    from sites
    join site_members on site_members.site_id = sites.id
    where sites.workspace_id = workspace_members.workspace_id
      and site_members.user_id = auth.uid()
      and site_members.role in ('admin', 'manager')
  )
);
create policy "Admins can manage workspace members"
on workspace_members for all to authenticated
using (app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[]))
with check (app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[]));
create policy "Users can leave workspace"
on workspace_members for delete to authenticated
using (user_id = auth.uid() and role <> 'admin');

drop policy if exists "Users can read own site memberships" on site_members;
drop policy if exists "Admins and managers can manage site members" on site_members;
drop policy if exists "Users can leave job sites" on site_members;
create policy "Users can read own site memberships"
on site_members for select to authenticated
using (user_id = auth.uid() or app_private.can_manage_site_access(site_id));
create policy "Admins and managers can manage site members"
on site_members for all to authenticated
using (
  app_private.can_admin_site(site_id)
  or (app_private.can_manage_site_access(site_id) and role <> 'admin')
)
with check (
  app_private.can_admin_site(site_id)
  or (app_private.can_manage_site_access(site_id) and role <> 'admin')
);
create policy "Users can leave job sites"
on site_members for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins and managers can manage invites" on invites;
create policy "Admins and managers can manage invites"
on invites for all to authenticated
using (
  app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[])
  or (site_id is not null and app_private.can_manage_site_access(site_id) and role <> 'admin')
)
with check (
  app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[])
  or (site_id is not null and app_private.can_manage_site_access(site_id) and role <> 'admin')
);

drop policy if exists "Admins and assigned users can read sites" on sites;
drop policy if exists "Admins can insert sites" on sites;
drop policy if exists "Admins can update sites" on sites;
drop policy if exists "Admins can delete sites" on sites;
create policy "Admins and assigned users can read sites"
on sites for select to authenticated
using (app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[]) or app_private.can_access_site(id));
create policy "Admins can insert sites"
on sites for insert to authenticated
with check (app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[]));
create policy "Admins can update sites"
on sites for update to authenticated
using (app_private.can_admin_site(id))
with check (app_private.has_workspace_role(workspace_id, array['admin']::workspace_role[]));
create policy "Admins can delete sites"
on sites for delete to authenticated
using (app_private.can_admin_site(id));

drop policy if exists "Assigned users can read buildings" on buildings;
drop policy if exists "Admins can manage buildings" on buildings;
create policy "Assigned users can read buildings"
on buildings for select to authenticated
using (app_private.can_access_site(site_id));
create policy "Admins can manage buildings"
on buildings for all to authenticated
using (app_private.can_admin_site(site_id))
with check (app_private.can_admin_site(site_id));

drop policy if exists "Assigned users can read rooms" on rooms;
drop policy if exists "Admins can manage rooms" on rooms;
create policy "Assigned users can read rooms"
on rooms for select to authenticated
using (exists (select 1 from buildings where buildings.id = rooms.building_id and app_private.can_access_site(buildings.site_id)));
create policy "Admins can manage rooms"
on rooms for all to authenticated
using (exists (select 1 from buildings where buildings.id = rooms.building_id and app_private.can_admin_site(buildings.site_id)))
with check (exists (select 1 from buildings where buildings.id = rooms.building_id and app_private.can_admin_site(buildings.site_id)));

drop policy if exists "Assigned users can read assets" on assets;
drop policy if exists "Admins and technicians can insert assets" on assets;
drop policy if exists "Admins and technicians can update assets" on assets;
drop policy if exists "Admins can delete assets" on assets;
drop policy if exists "Managers can delete assets" on assets;
create policy "Assigned users can read assets"
on assets for select to authenticated
using (app_private.can_access_site(site_id));
create policy "Admins and technicians can insert assets"
on assets for insert to authenticated
with check (app_private.can_edit_assets_on_site(site_id));
create policy "Admins and technicians can update assets"
on assets for update to authenticated
using (app_private.can_edit_assets_on_site(site_id))
with check (app_private.can_edit_assets_on_site(site_id));
create policy "Managers can delete assets"
on assets for delete to authenticated
using (app_private.can_manage_site_access(site_id));

drop policy if exists "Members can read asset photos" on asset_photos;
drop policy if exists "Asset editors can insert photos" on asset_photos;
drop policy if exists "Asset editors can update photos" on asset_photos;
drop policy if exists "Admins can delete photos" on asset_photos;
drop policy if exists "Managers can delete photos" on asset_photos;
create policy "Members can read asset photos"
on asset_photos for select to authenticated
using (exists (select 1 from assets where assets.id = asset_photos.asset_id and app_private.can_access_site(assets.site_id)));
create policy "Asset editors can insert photos"
on asset_photos for insert to authenticated
with check (exists (select 1 from assets where assets.id = asset_photos.asset_id and app_private.can_edit_assets_on_site(assets.site_id)));
create policy "Asset editors can update photos"
on asset_photos for update to authenticated
using (exists (select 1 from assets where assets.id = asset_photos.asset_id and app_private.can_edit_assets_on_site(assets.site_id)))
with check (exists (select 1 from assets where assets.id = asset_photos.asset_id and app_private.can_edit_assets_on_site(assets.site_id)));
create policy "Managers can delete photos"
on asset_photos for delete to authenticated
using (exists (select 1 from assets where assets.id = asset_photos.asset_id and app_private.can_manage_site_access(assets.site_id)));

drop policy if exists "Members can read asset logs" on asset_logs;
drop policy if exists "Asset editors can insert logs" on asset_logs;
drop policy if exists "Admins can delete logs" on asset_logs;
drop policy if exists "Managers can delete logs" on asset_logs;
create policy "Members can read asset logs"
on asset_logs for select to authenticated
using (exists (select 1 from assets where assets.id = asset_logs.asset_id and app_private.can_access_site(assets.site_id)));
create policy "Asset editors can insert logs"
on asset_logs for insert to authenticated
with check (exists (select 1 from assets where assets.id = asset_logs.asset_id and app_private.can_edit_assets_on_site(assets.site_id)));
create policy "Managers can delete logs"
on asset_logs for delete to authenticated
using (exists (select 1 from assets where assets.id = asset_logs.asset_id and app_private.can_manage_site_access(assets.site_id)));

create or replace function app_private.join_workspace_with_code_impl(code text)
returns uuid
language plpgsql
security definer
set search_path = public, app_private
as '
declare
  target_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception ''You must be signed in to join a workspace.'';
  end if;

  select id
  into target_workspace_id
  from workspaces
  where lower(join_code) = lower(trim(code))
  limit 1;

  if target_workspace_id is null then
    raise exception ''Invalid workspace join code.'';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (target_workspace_id, auth.uid(), ''viewer'')
  on conflict (workspace_id, user_id) do nothing;

  return target_workspace_id;
end;
';

create or replace function app_private.regenerate_workspace_join_code_impl(target_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = public, app_private
as '
declare
  next_code text;
begin
  if not app_private.has_workspace_role(target_workspace_id, array[''admin'']::workspace_role[]) then
    raise exception ''Only workspace admins can regenerate join codes.'';
  end if;

  next_code = upper(substring(encode(gen_random_bytes(8), ''hex'') from 1 for 8));
  update workspaces
  set join_code = next_code
  where id = target_workspace_id;

  return next_code;
end;
';

create or replace function app_private.accept_invite_impl(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public, app_private
as '
declare
  invite_row invites%rowtype;
begin
  if auth.uid() is null then
    raise exception ''You must be signed in to accept an invite.'';
  end if;

  select *
  into invite_row
  from invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if invite_row.id is null then
    raise exception ''Invite is invalid, expired, or already accepted.'';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (invite_row.workspace_id, auth.uid(), invite_row.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  if invite_row.site_id is not null then
    insert into site_members (site_id, user_id, role)
    values (invite_row.site_id, auth.uid(), invite_row.role)
    on conflict (site_id, user_id) do update set role = excluded.role;
  end if;

  update invites
  set accepted_at = now()
  where id = invite_row.id;

  return invite_row.workspace_id;
end;
';

revoke execute on function app_private.join_workspace_with_code_impl(text) from anon, authenticated, public;
revoke execute on function app_private.regenerate_workspace_join_code_impl(uuid) from anon, authenticated, public;
revoke execute on function app_private.accept_invite_impl(text) from anon, authenticated, public;

grant execute on function app_private.join_workspace_with_code_impl(text) to authenticated;
grant execute on function app_private.regenerate_workspace_join_code_impl(uuid) to authenticated;
grant execute on function app_private.accept_invite_impl(text) to authenticated;

create or replace function public.join_workspace_with_code(code text)
returns uuid
language sql
security invoker
set search_path = public, app_private
as '
  select app_private.join_workspace_with_code_impl(code);
';

create or replace function public.regenerate_workspace_join_code(target_workspace_id uuid)
returns text
language sql
security invoker
set search_path = public, app_private
as '
  select app_private.regenerate_workspace_join_code_impl(target_workspace_id);
';

create or replace function public.accept_invite(invite_token text)
returns uuid
language sql
security invoker
set search_path = public, app_private
as '
  select app_private.accept_invite_impl(invite_token);
';

revoke execute on function public.can_access_site(uuid) from anon, authenticated, public;
revoke execute on function public.can_admin_site(uuid) from anon, authenticated, public;
revoke execute on function public.can_manage_site_access(uuid) from anon, authenticated, public;
revoke execute on function public.can_edit_assets_on_site(uuid) from anon, authenticated, public;
revoke execute on function public.has_workspace_role(uuid, workspace_role[]) from anon, authenticated, public;
revoke execute on function public.is_workspace_member(uuid) from anon, authenticated, public;

grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.join_workspace_with_code(text) to authenticated;
grant execute on function public.regenerate_workspace_join_code(uuid) to authenticated;
