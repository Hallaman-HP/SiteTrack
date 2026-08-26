create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  avatar_path text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_path text;

alter table public.profiles enable row level security;

create or replace function public.set_profile_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.first_name = trim(coalesce(new.first_name, ''));
  new.last_name = trim(coalesce(new.last_name, ''));
  new.display_name = nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
  if new.display_name is null then
    new.display_name = 'Site user';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_display_name on public.profiles;
create trigger profiles_set_display_name
before insert or update on public.profiles
for each row
execute function public.set_profile_display_name();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_name text;
  last_name text;
begin
  first_name = trim(coalesce(new.raw_user_meta_data ->> 'first_name', ''));
  last_name = trim(coalesce(new.raw_user_meta_data ->> 'last_name', ''));

  if first_name = '' then
    first_name = split_part(coalesce(new.email, 'Site user'), '@', 1);
  end if;

  insert into public.profiles (id, first_name, last_name)
  values (new.id, first_name, last_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists users_create_profile on auth.users;
create trigger users_create_profile
after insert on auth.users
for each row
execute function public.create_profile_for_new_user();

insert into public.profiles (id, first_name, last_name)
select
  users.id,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'first_name'), ''), split_part(coalesce(users.email, 'Site user'), '@', 1)),
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'last_name'), ''), '')
from auth.users
where not exists (
  select 1 from public.profiles where profiles.id = users.id
);

drop policy if exists "Users can read related profiles" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can read related profiles"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.workspace_members self_member
    join public.workspace_members other_member on other_member.workspace_id = self_member.workspace_id
    where self_member.user_id = auth.uid()
      and other_member.user_id = profiles.id
  )
  or exists (
    select 1
    from public.site_members self_site
    join public.site_members other_site on other_site.site_id = self_site.site_id
    where self_site.user_id = auth.uid()
      and other_site.user_id = profiles.id
  )
);

create policy "Users can insert own profile"
on public.profiles for insert to authenticated
with check (id = auth.uid());

create policy "Users can update own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke execute on function public.create_profile_for_new_user() from anon, authenticated, public;
grant execute on function public.set_profile_display_name() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read related profile avatars" on storage.objects;
drop policy if exists "Users can upload own profile avatar" on storage.objects;
drop policy if exists "Users can update own profile avatar" on storage.objects;
drop policy if exists "Users can delete own profile avatar" on storage.objects;

create policy "Users can read related profile avatars"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and split_part(storage.objects.name, '/', 1) = auth.uid()::text
);

create policy "Users can upload own profile avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and split_part(storage.objects.name, '/', 1) = auth.uid()::text
);

create policy "Users can update own profile avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and split_part(storage.objects.name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and split_part(storage.objects.name, '/', 1) = auth.uid()::text
);

create policy "Users can delete own profile avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and split_part(storage.objects.name, '/', 1) = auth.uid()::text
);
