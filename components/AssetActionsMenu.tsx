"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, Edit, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import type { AssetView } from "@/lib/types";

type AssetActionsMenuProps = {
  asset: AssetView;
  canArchive?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onArchive?: (asset: AssetView) => void;
  onRestore?: (asset: AssetView) => void;
  onDelete?: (asset: AssetView) => void;
};

export function AssetActionsMenu({ asset, canArchive = false, canEdit = false, canDelete = false, onArchive, onRestore, onDelete }: AssetActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    if (isOpen) document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  if (!canArchive && !canEdit && !canDelete) return null;
  const isArchived = Boolean(asset.archived_at);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Open actions for ${asset.asset_number}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        className="inline-grid h-9 w-9 place-items-center rounded-full border border-zinc-200 bg-white text-steel shadow-sm transition hover:-translate-y-0.5 hover:text-ink"
      >
        <MoreHorizontal size={18} />
      </button>
      {isOpen ? (
        <div className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-panel">
          {canEdit ? (
            <Link
              href={`/assets/${asset.id}/edit`}
              onClick={(event) => {
                event.stopPropagation();
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-ink transition hover:bg-zinc-50"
            >
              <Edit size={16} />
              Edit asset
            </Link>
          ) : null}
          {canArchive ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsOpen(false);
                if (isArchived && onRestore) onRestore(asset);
                else onArchive?.(asset);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition ${isArchived ? "text-emerald-700 hover:bg-emerald-50" : "text-amber-700 hover:bg-amber-50"}`}
            >
              {isArchived ? <RotateCcw size={16} /> : <Archive size={16} />}
              {isArchived ? "Restore asset" : "Archive asset"}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsOpen(false);
                onDelete?.(asset);
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              <Trash2 size={16} />
              Delete asset
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
