-- Adds the "Awaiting Install" status used by the asset form.
-- Run this once in Supabase SQL Editor before saving assets with this status.

alter type asset_status add value if not exists 'awaiting_install' before 'installed';
alter type asset_action_type add value if not exists 'Awaiting Install' before 'Installed';
alter type asset_action_type add value if not exists 'Archived';
alter type asset_action_type add value if not exists 'Restored';
