"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";
import { ScannerModal } from "@/components/ScannerModal";
import { inputClass } from "@/components/Field";

/**
 * Text input with a built-in camera scan button. The scanner reads barcodes and
 * QR codes live, and has an OCR tab that captures printed text (serials, MAC
 * addresses, labels) straight from the camera image.
 */
export function ScanInput({
  value,
  onChange,
  placeholder,
  scanTitle = "Scan",
  transform,
  className,
  inputMode,
  autoCapitalize,
  required,
  name
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  scanTitle?: string;
  transform?: (raw: string) => string;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoCapitalize?: string;
  required?: boolean;
  name?: string;
}) {
  const [scanning, setScanning] = useState(false);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${className ?? inputClass} w-full pr-12`}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        required={required}
        name={name}
      />
      <button
        type="button"
        onClick={() => setScanning(true)}
        className="focus-ring absolute right-1.5 top-1/2 inline-flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-[6px] bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900"
        aria-label={`${scanTitle} with camera`}
        title="Scan with camera"
      >
        <ScanLine size={16} />
      </button>
      {scanning ? (
        <ScannerModal
          title={scanTitle}
          onClose={() => setScanning(false)}
          onResult={(text) => onChange(transform ? transform(text) : text)}
        />
      ) : null}
    </div>
  );
}
