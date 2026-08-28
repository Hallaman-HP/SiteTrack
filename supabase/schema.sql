create extension if not exists "pgcrypto";

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  client_name text,
  job_number text,
  created_at timestamptz not null default now()
);

create table if not exists buildings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  room_number text not null,
  room_name text,
  floor text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'asset_status') then
    create type asset_status as enum ('awaiting_install', 'installed', 'removed', 'replaced', 'moved', 'damaged');
  end if;
  if not exists (select 1 from pg_type where typname = 'asset_action_type') then
    create type asset_action_type as enum ('Awaiting Install', 'Installed', 'Removed', 'Replaced', 'Moved', 'Faulty/Damaged', 'Archived', 'Restored');
  end if;
end $$;

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  asset_number text not null unique,
  serial_number text,
  item_name text not null,
  item_type text,
  brand text,
  model text,
  mac_address text,
  ip_address text,
  switch_port text,
  network_patch_number text,
  site_id uuid references sites(id) on delete set null,
  building_id uuid references buildings(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  location_in_room text,
  patching_details text,
  status asset_status not null default 'installed',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table assets add column if not exists mac_address text;
alter table assets add column if not exists ip_address text;
alter table assets add column if not exists switch_port text;
alter table assets add column if not exists network_patch_number text;

create table if not exists asset_photos (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  photo_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists asset_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  action_type asset_action_type not null,
  previous_location text,
  new_location text,
  notes text,
  user_name text,
  created_at timestamptz not null default now()
);

create index if not exists assets_search_idx on assets using gin (
  to_tsvector(
    'simple',
    coalesce(asset_number, '') || ' ' ||
    coalesce(serial_number, '') || ' ' ||
    coalesce(item_name, '') || ' ' ||
    coalesce(item_type, '') || ' ' ||
    coalesce(brand, '') || ' ' ||
    coalesce(model, '') || ' ' ||
    coalesce(mac_address, '') || ' ' ||
    coalesce(ip_address, '') || ' ' ||
    coalesce(switch_port, '') || ' ' ||
    coalesce(network_patch_number, '') || ' ' ||
    coalesce(patching_details, '')
  )
);

create index if not exists assets_asset_number_idx on assets(asset_number);
create index if not exists assets_serial_number_idx on assets(serial_number);
create index if not exists rooms_room_number_idx on rooms(room_number);
create index if not exists buildings_site_id_idx on buildings(site_id);
create index if not exists rooms_building_id_idx on rooms(building_id);
create index if not exists asset_logs_asset_id_idx on asset_logs(asset_id);
create index if not exists asset_photos_asset_id_idx on asset_photos(asset_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists assets_set_updated_at on assets;
create trigger assets_set_updated_at
before update on assets
for each row execute function set_updated_at();

alter table sites enable row level security;
alter table buildings enable row level security;
alter table rooms enable row level security;
alter table assets enable row level security;
alter table asset_photos enable row level security;
alter table asset_logs enable row level security;

drop policy if exists "Authenticated users can manage sites" on sites;
drop policy if exists "Authenticated users can manage buildings" on buildings;
drop policy if exists "Authenticated users can manage rooms" on rooms;
drop policy if exists "Authenticated users can manage assets" on assets;
drop policy if exists "Authenticated users can manage asset photos" on asset_photos;
drop policy if exists "Authenticated users can manage asset logs" on asset_logs;

create policy "Authenticated users can manage sites" on sites for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage buildings" on buildings for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage rooms" on rooms for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage assets" on assets for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage asset photos" on asset_photos for all to authenticated using (true) with check (true);
create policy "Authenticated users can manage asset logs" on asset_logs for all to authenticated using (true) with check (true);
