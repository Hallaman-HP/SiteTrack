export type AssetStatus = "awaiting_install" | "installed" | "removed" | "replaced" | "moved" | "damaged";
export type ActionType = "Awaiting Install" | "Installed" | "Removed" | "Replaced" | "Moved" | "Faulty/Damaged" | "Archived" | "Restored";

export type Site = {
  id: string;
  name: string;
  address: string;
  client_name: string;
  job_number: string;
  created_at: string;
};

export type Building = {
  id: string;
  site_id: string;
  name: string;
  created_at: string;
};

export type Room = {
  id: string;
  building_id: string;
  room_number: string;
  room_name: string;
  floor: string;
  created_at: string;
};

export type Asset = {
  id: string;
  asset_number: string;
  serial_number: string;
  item_name: string;
  item_type: string;
  brand: string;
  model: string;
  mac_address: string;
  ip_address: string;
  switch_port: string;
  network_patch_number: string;
  site_id: string;
  building_id: string;
  room_id: string;
  location_in_room: string;
  patching_details: string;
  status: AssetStatus;
  notes: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  archived_by?: string;
  archived_reason?: string;
};

export type AssetPhoto = {
  id: string;
  asset_id: string;
  photo_url: string;
  caption: string;
  created_at: string;
};

export type AssetLog = {
  id: string;
  asset_id: string;
  action_type: ActionType;
  previous_location: string;
  new_location: string;
  notes: string;
  user_name: string;
  created_at: string;
};

export type StoreData = {
  sites: Site[];
  buildings: Building[];
  rooms: Room[];
  assets: Asset[];
  asset_photos: AssetPhoto[];
  asset_logs: AssetLog[];
};

export type AssetView = Asset & {
  site?: Site;
  building?: Building;
  room?: Room;
  photos: AssetPhoto[];
  logs: AssetLog[];
};
