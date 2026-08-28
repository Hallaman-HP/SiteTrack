-- Workforce / multi-tenant migration for the hosted version of SiteTrack.
-- Run this after supabase/schema.sql when you are ready to move from local MVP
-- data into authenticated workspaces, members, and job-site invites.
-- Existing databases that already have workspace_role must run
-- supabase/add_manager_role.sql before rerunning this file.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    create type workspace_role as enum ('admin', 'manager', 'technician', 'viewer');
  end if;
end $$;

alter type workspace_role add value if not exists 'manager';

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'technician',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists site_members (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'technician',
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  email text not null,
  role workspace_role not null default 'technician',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

alter table sites add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table assets add column if not exists workspace_id uuid references workspaces(id) on delete cascade;

update assets
set workspace_id = sites.workspace_id
from sites
where assets.site_id = sites.id
  and assets.workspace_id is null
  and sites.workspace_id is not null;

create index if not exists workspace_members_workspace_id_idx on workspace_members(workspace_id);
create index if not exists workspace_members_user_id_idx on workspace_members(user_id);
create index if not exists site_members_site_id_idx on site_members(site_id);
create index if not exists site_members_user_id_idx on site_members(user_id);
create index if not exists invites_workspace_id_idx on invites(workspace_id);
create index if not exists invites_email_idx on invites(lower(email));
create index if not exists sites_workspace_id_idx on sites(workspace_id);
create index if not exists assets_workspace_id_idx on assets(workspace_id);

create unique index if not exists sites_workspace_job_number_unique
on sites(workspace_id, lower(job_number))
where workspace_id is not null and nullif(trim(job_number), '') is not null;

create unique index if not exists sites_workspace_name_unique
on sites(workspace_id, lower(name))
where workspace_id is not null;

alter table assets drop constraint if exists assets_asset_number_key;

drop index if exists assets_workspace_asset_number_unique;
create unique index assets_workspace_asset_number_unique
on assets(workspace_id, lower(asset_number))
where workspace_id is not null and nullif(trim(asset_number), '') is not null;

drop index if exists assets_workspace_serial_number_unique;
create unique index assets_workspace_serial_number_unique
on assets(workspace_id, lower(serial_number))
where workspace_id is not null and nullif(trim(serial_number), '') is not null;

drop index if exists assets_workspace_mac_address_unique;
create unique index assets_workspace_mac_address_unique
on assets(workspace_id, lower(replace(replace(mac_address, ':', ''), '-', '')))
where workspace_id is not null and nullif(trim(mac_address), '') is not null;

drop index if exists assets_workspace_ip_address_unique;
create unique index assets_workspace_ip_address_unique
on assets(workspace_id, lower(ip_address))
where workspace_id is not null and nullif(trim(ip_address), '') is not null;

drop index if exists assets_site_switch_port_unique;
create unique index assets_site_switch_port_unique
on assets(site_id, lower(replace(switch_port, ' ', '')))
where site_id is not null and nullif(trim(switch_port), '') is not null;

drop index if exists assets_site_network_patch_unique;
create unique index assets_site_network_patch_unique
on assets(site_id, lower(replace(network_patch_number, ' ', '')))
where site_id is not null and nullif(trim(network_patch_number), '') is not null;

create or replace function is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

create or replace function has_workspace_role(target_workspace_id uuid, allowed_roles workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

create or replace function can_access_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        has_workspace_role(sites.workspace_id, array['admin']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function can_admin_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        has_workspace_role(sites.workspace_id, array['admin']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
            and site_members.role = 'admin'
        )
      )
  );
$$;

create or replace function can_manage_site_access(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        has_workspace_role(sites.workspace_id, array['admin']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
            and site_members.role in ('admin', 'manager')
        )
      )
  );
$$;

create or replace function can_edit_assets_on_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from sites
    where sites.id = target_site_id
      and (
        has_workspace_role(sites.workspace_id, array['admin']::workspace_role[])
        or exists (
          select 1
          from site_members
          where site_members.site_id = target_site_id
            and site_members.user_id = auth.uid()
            and site_members.role in ('admin', 'manager', 'technician')
        )
      )
  );
$$;

create or replace function add_workspace_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'admin')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_add_creator_as_admin on workspaces;
create trigger workspaces_add_creator_as_admin
after insert on workspaces
for each row execute function add_workspace_creator_as_admin();

create or replace function copy_asset_workspace_from_site()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is null and new.site_id is not null then
    select workspace_id into new.workspace_id
    from sites
    where id = new.site_id;
  end if;
  return new;
end;
$$;

drop trigger if exists assets_copy_workspace_from_site on assets;
create trigger assets_copy_workspace_from_site
before insert or update of site_id, workspace_id on assets
for each row execute function copy_asset_workspace_from_site();

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table site_members enable row level security;
alter table invites enable row level security;

drop policy if exists "Authenticated users can manage sites" on sites;
drop policy if exists "Authenticated users can manage buildings" on buildings;
drop policy if exists "Authenticated users can manage rooms" on rooms;
drop policy if exists "Authenticated users can manage assets" on assets;
drop policy if exists "Authenticated users can manage asset photos" on asset_photos;
drop policy if exists "Authenticated users can manage asset logs" on asset_logs;

drop policy if exists "Members can read workspaces" on workspaces;
drop policy if exists "Users can create workspaces" on workspaces;
drop policy if exists "Admins can update workspaces" on workspaces;
drop policy if exists "Admins can delete workspaces" on workspaces;
create policy "Members can read workspaces" on workspaces for select to authenticated using (is_workspace_member(id));
create policy "Users can create workspaces" on workspaces for insert to authenticated with check (created_by = auth.uid());
create policy "Admins can update workspaces" on workspaces for update to authenticated using (has_workspace_role(id, array['admin']::workspace_role[])) with check (has_workspace_role(id, array['admin']::workspace_role[]));
create policy "Admins can delete workspaces" on workspaces for delete to authenticated using (has_workspace_role(id, array['admin']::workspace_role[]));

drop policy if exists "Members can read workspace members" on workspace_members;
drop policy if exists "Admins can manage workspace members" on workspace_members;
create policy "Members can read workspace members" on workspace_members for select to authenticated using (
  user_id = auth.uid()
  or has_workspace_role(workspace_id, array['admin']::workspace_role[])
  or exists (
    select 1
    from sites
    join site_members on site_members.site_id = sites.id
    where sites.workspace_id = workspace_members.workspace_id
      and site_members.user_id = auth.uid()
      and site_members.role in ('admin', 'manager')
  )
);
create policy "Admins can manage workspace members" on workspace_members for all to authenticated using (has_workspace_role(workspace_id, array['admin']::workspace_role[])) with check (has_workspace_role(workspace_id, array['admin']::workspace_role[]));

drop policy if exists "Members can read site members" on site_members;
drop policy if exists "Admins can manage site members" on site_members;
create policy "Members can read site members" on site_members for select to authenticated using (can_access_site(site_id));
create policy "Admins can manage site members" on site_members for all to authenticated using (
  can_admin_site(site_id)
  or (can_manage_site_access(site_id) and role <> 'admin')
) with check (
  can_admin_site(site_id)
  or (can_manage_site_access(site_id) and role <> 'admin')
);

drop policy if exists "Admins can manage invites" on invites;
create policy "Admins can manage invites" on invites for all to authenticated using (
  has_workspace_role(workspace_id, array['admin']::workspace_role[])
  or (site_id is not null and can_manage_site_access(site_id) and role <> 'admin')
) with check (
  has_workspace_role(workspace_id, array['admin']::workspace_role[])
  or (site_id is not null and can_manage_site_access(site_id) and role <> 'admin')
);

drop policy if exists "Members can read sites" on sites;
drop policy if exists "Admins can insert sites" on sites;
drop policy if exists "Admins can update sites" on sites;
drop policy if exists "Admins can delete sites" on sites;
create policy "Members can read sites" on sites for select to authenticated using (is_workspace_member(workspace_id) or can_access_site(id));
create policy "Admins can insert sites" on sites for insert to authenticated with check (has_workspace_role(workspace_id, array['admin']::workspace_role[]));
create policy "Admins can update sites" on sites for update to authenticated using (can_admin_site(id)) with check (has_workspace_role(workspace_id, array['admin']::workspace_role[]));
create policy "Admins can delete sites" on sites for delete to authenticated using (can_admin_site(id));

drop policy if exists "Members can read buildings" on buildings;
drop policy if exists "Admins can manage buildings" on buildings;
create policy "Members can read buildings" on buildings for select to authenticated using (can_access_site(site_id));
create policy "Admins can manage buildings" on buildings for all to authenticated using (can_admin_site(site_id)) with check (can_admin_site(site_id));

drop policy if exists "Members can read rooms" on rooms;
drop policy if exists "Admins can manage rooms" on rooms;
create policy "Members can read rooms" on rooms for select to authenticated using (
  exists (
    select 1
    from buildings
    where buildings.id = rooms.building_id
      and can_access_site(buildings.site_id)
  )
);
create policy "Admins can manage rooms" on rooms for all to authenticated using (
  exists (
    select 1
    from buildings
    where buildings.id = rooms.building_id
      and can_admin_site(buildings.site_id)
  )
) with check (
  exists (
    select 1
    from buildings
    where buildings.id = rooms.building_id
      and can_admin_site(buildings.site_id)
  )
);

drop policy if exists "Members can read assets" on assets;
drop policy if exists "Admins and technicians can insert assets" on assets;
drop policy if exists "Admins and technicians can update assets" on assets;
drop policy if exists "Admins can delete assets" on assets;
drop policy if exists "Managers can delete assets" on assets;
create policy "Members can read assets" on assets for select to authenticated using (can_access_site(site_id));
create policy "Admins and technicians can insert assets" on assets for insert to authenticated with check (can_edit_assets_on_site(site_id));
create policy "Admins and technicians can update assets" on assets for update to authenticated using (can_edit_assets_on_site(site_id)) with check (can_edit_assets_on_site(site_id));
create policy "Managers can delete assets" on assets for delete to authenticated using (can_manage_site_access(site_id));

drop policy if exists "Members can read asset photos" on asset_photos;
drop policy if exists "Asset editors can insert photos" on asset_photos;
drop policy if exists "Admins can delete photos" on asset_photos;
drop policy if exists "Managers can delete photos" on asset_photos;
create policy "Members can read asset photos" on asset_photos for select to authenticated using (
  exists (select 1 from assets where assets.id = asset_photos.asset_id and can_access_site(assets.site_id))
);
create policy "Asset editors can insert photos" on asset_photos for insert to authenticated with check (
  exists (select 1 from assets where assets.id = asset_photos.asset_id and can_edit_assets_on_site(assets.site_id))
);
create policy "Managers can delete photos" on asset_photos for delete to authenticated using (
  exists (select 1 from assets where assets.id = asset_photos.asset_id and can_manage_site_access(assets.site_id))
);

drop policy if exists "Members can read asset logs" on asset_logs;
drop policy if exists "Asset editors can insert logs" on asset_logs;
drop policy if exists "Admins can delete logs" on asset_logs;
drop policy if exists "Managers can delete logs" on asset_logs;
create policy "Members can read asset logs" on asset_logs for select to authenticated using (
  exists (select 1 from assets where assets.id = asset_logs.asset_id and can_access_site(assets.site_id))
);
create policy "Asset editors can insert logs" on asset_logs for insert to authenticated with check (
  exists (select 1 from assets where assets.id = asset_logs.asset_id and can_edit_assets_on_site(assets.site_id))
);
create policy "Managers can delete logs" on asset_logs for delete to authenticated using (
  exists (select 1 from assets where assets.id = asset_logs.asset_id and can_manage_site_access(assets.site_id))
);
