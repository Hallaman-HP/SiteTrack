import { assetToView, statusLabel } from "@/lib/store";
import type { StoreData } from "@/lib/types";

const headings = [
  "Site",
  "Address",
  "Client",
  "Job Number",
  "Building",
  "Floor",
  "Room Number",
  "Room Name",
  "Asset Number",
  "Serial Number",
  "Item Name",
  "Item Type",
  "Brand",
  "Model",
  "MAC Address",
  "IP Address",
  "Switch Port",
  "Network Patch Number",
  "Status",
  "Location In Room",
  "Patching Details",
  "Notes",
  "Latest History Note"
];

export function buildAssetRegisterCsv(data: StoreData, options?: { siteId?: string; buildingId?: string }) {
  const assets = data.assets.filter((asset) => {
    if (asset.archived_at) return false;
    if (options?.buildingId) return asset.building_id === options.buildingId;
    if (options?.siteId) return asset.site_id === options.siteId;
    return true;
  });
  const rows = assets.map((asset) => {
    const view = assetToView(asset, data);
    return [
      view.site?.name,
      view.site?.address,
      view.site?.client_name,
      view.site?.job_number,
      view.building?.name,
      view.room?.floor,
      view.room?.room_number,
      view.room?.room_name,
      view.asset_number,
      view.serial_number,
      view.item_name,
      view.item_type,
      view.brand,
      view.model,
      view.mac_address,
      view.ip_address,
      view.switch_port,
      view.network_patch_number,
      statusLabel(view.status),
      view.location_in_room,
      view.patching_details,
      view.notes,
      view.logs[0]?.notes
    ];
  });

  return [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function exportFilename(name = "site-asset-register") {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site-asset-register"}.csv`;
}

export function downloadCsv(csv: string, filename = "site-asset-register.csv") {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function shareCsv(csv: string, filename = "site-asset-register.csv") {
  const file = new File([csv], filename, { type: "text/csv" });
  const canShare = "canShare" in navigator && navigator.canShare({ files: [file] });
  if (canShare && "share" in navigator) {
    await navigator.share({
      title: "Site asset register",
      text: "Job-site asset register export",
      files: [file]
    });
    return true;
  }
  downloadCsv(csv, filename);
  return false;
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
