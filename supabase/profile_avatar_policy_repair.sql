-- Repair profile avatar storage policies so uploads do not call public.safe_uuid().
-- Run this in Supabase SQL Editor if profile photo uploads fail with:
-- "permission denied for function safe_uuid".

alter table public.profiles add column if not exists avatar_path text;

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
