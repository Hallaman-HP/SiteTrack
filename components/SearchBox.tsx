"use client";

import { useState } from "react";
import { ScanLine, Search } from "lucide-react";
import { ScannerModal } from "@/components/ScannerModal";

export function SearchBox({ value, onChange, placeholder = "Search asset, serial, room, patching..." }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [scanning, setScanning] = useState(false);
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-steel" size={20} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="focus-ring h-14 w-full rounded-[8px] border border-zinc-200 bg-white pl-12 pr-14 text-base font-medium text-ink shadow-panel placeholder:text-zinc-400"
      />
      <button
        type="button"
        onClick={() => setScanning(true)}
        className="focus-ring absolute right-2.5 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[8px] bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900"
        aria-label="Scan a barcode to search"
        title="Scan a barcode to search"
      >
        <ScanLine size={18} />
      </button>
      {scanning ? (
        <ScannerModal title="Scan to search" onClose={() => setScanning(false)} onResult={(text) => onChange(text)} />
      ) : null}
    </label>
  );
}
