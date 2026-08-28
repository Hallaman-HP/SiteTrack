"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Flashlight, ScanLine, TextCursorInput, X } from "lucide-react";

type ScanMode = "barcode" | "ocr";

const BARCODE_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
  "data_matrix",
  "pdf_417",
  "aztec"
];

export function ScannerModal({
  title = "Scan",
  initialMode = "barcode",
  allowOcr = true,
  onResult,
  onClose
}: {
  title?: string;
  initialMode?: ScanMode;
  allowOcr?: boolean;
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef(false);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const resultSentRef = useRef(false);

  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [status, setStatus] = useState("Starting camera...");
  const [error, setError] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLines, setOcrLines] = useState<string[]>([]);
  const [frozenFrame, setFrozenFrame] = useState<string>("");

  const deliver = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || resultSentRef.current) return;
      resultSentRef.current = true;
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(80);
      } catch {
        // vibration is best-effort only
      }
      onResult(trimmed);
      onClose();
    },
    [onClose, onResult]
  );

  const stopEverything = useCallback(() => {
    stopLoopRef.current = true;
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        // already stopped
      }
      zxingControlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    stopLoopRef.current = false;

    async function start() {
      setError("");
      setStatus("Starting camera...");
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot access the camera. Use HTTPS and a modern browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchAvailable(Boolean(capabilities?.torch));

        if (mode === "barcode") {
          setStatus("Point the camera at a barcode or QR code.");
          await runBarcodeLoop(video);
        } else {
          setStatus("Line up the text, then tap Capture text.");
        }
      } catch (err: any) {
        if (err?.name === "NotAllowedError") {
          setError("Camera permission was denied. Allow camera access for this site and try again.");
        } else {
          setError(err?.message ? `Camera error: ${err.message}` : "Could not start the camera.");
        }
      }
    }

    async function runBarcodeLoop(video: HTMLVideoElement) {
      const NativeDetector = (window as any).BarcodeDetector;
      if (NativeDetector) {
        try {
          const supported: string[] = (await NativeDetector.getSupportedFormats?.()) ?? [];
          const formats = BARCODE_FORMATS.filter((format) => supported.includes(format));
          const detector = new NativeDetector(formats.length ? { formats } : undefined);
          const tick = async () => {
            if (stopLoopRef.current || cancelled) return;
            if (video.readyState >= 2) {
              try {
                const codes = await detector.detect(video);
                if (codes?.length && codes[0].rawValue) {
                  deliver(codes[0].rawValue);
                  return;
                }
              } catch {
                // detection errors are transient; keep looping
              }
            }
            setTimeout(tick, 180);
          };
          tick();
          return;
        } catch {
          // fall through to ZXing
        }
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(video, (result: { getText(): string } | undefined) => {
          if (result) deliver(result.getText());
        });
        zxingControlsRef.current = controls;
      } catch {
        setError("Barcode scanning is not supported in this browser. Try the Text (OCR) tab instead.");
      }
    }

    start();
    return () => {
      cancelled = true;
      stopEverything();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] });
      setTorchOn((value) => !value);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const captureText = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setOcrBusy(true);
    setOcrLines([]);
    setStatus("Reading text from the image...");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(video, 0, 0);
      const frame = canvas.toDataURL("image/jpeg", 0.92);
      setFrozenFrame(frame);
      const tesseract = await import("tesseract.js");
      const result = await (tesseract as any).recognize(frame, "eng");
      const lines: string[] = String(result?.data?.text ?? "")
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line.length >= 2);
      if (!lines.length) {
        setStatus("No text found. Get closer, improve lighting, and try again.");
        setFrozenFrame("");
      } else {
        setOcrLines(lines);
        setStatus("Tap the line you want to use.");
      }
    } catch {
      setStatus("Could not read text from the camera. Try again with better lighting.");
      setFrozenFrame("");
    } finally {
      setOcrBusy(false);
    }
  }, []);

  const resetOcr = useCallback(() => {
    setOcrLines([]);
    setFrozenFrame("");
    setStatus("Line up the text, then tap Capture text.");
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <div className="flex items-center gap-2">
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${torchOn ? "bg-amber-400 text-black" : "bg-white/15 text-white"}`}
              aria-label="Toggle torch"
            >
              <Flashlight size={18} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              stopEverything();
              onClose();
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
            aria-label="Close scanner"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {allowOcr ? (
        <div className="mx-4 mb-2 grid grid-cols-2 gap-1 rounded-[10px] bg-white/10 p-1">
          <button
            type="button"
            onClick={() => {
              resetOcr();
              setMode("barcode");
            }}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] text-sm font-semibold ${mode === "barcode" ? "bg-white text-black" : "text-white"}`}
          >
            <ScanLine size={16} /> Barcode / QR
          </button>
          <button
            type="button"
            onClick={() => setMode("ocr")}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] text-sm font-semibold ${mode === "ocr" ? "bg-white text-black" : "text-white"}`}
          >
            <TextCursorInput size={16} /> Text (OCR)
          </button>
        </div>
      ) : null}

      <div className="relative mx-4 flex-1 overflow-hidden rounded-[12px] bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${frozenFrame ? "hidden" : ""}`} />
        {frozenFrame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozenFrame} alt="Captured frame" className="h-full w-full object-cover" />
        ) : null}
        {mode === "barcode" && !error ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-44 w-72 max-w-[80%] rounded-[12px] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        ) : null}
      </div>

      <div className="px-4 py-3">
        {error ? (
          <p className="rounded-[8px] bg-red-500/20 px-3 py-2 text-sm font-medium text-red-100">{error}</p>
        ) : (
          <p className="text-center text-sm font-medium text-white/90">{status}</p>
        )}

        {mode === "ocr" && !error ? (
          <div className="mt-3 grid gap-2">
            {ocrLines.length ? (
              <>
                <div className="max-h-40 overflow-y-auto rounded-[10px] bg-white/10 p-2">
                  {ocrLines.map((line, index) => (
                    <button
                      key={`${index}-${line}`}
                      type="button"
                      onClick={() => deliver(line)}
                      className="mb-1 block w-full rounded-[8px] bg-white/90 px-3 py-2 text-left text-sm font-medium text-black last:mb-0"
                    >
                      {line}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={resetOcr}
                  className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-white/15 px-4 text-sm font-semibold text-white"
                >
                  Retake
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={captureText}
                disabled={ocrBusy}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[8px] bg-white px-4 text-sm font-bold text-black disabled:opacity-60"
              >
                <Camera size={18} /> {ocrBusy ? "Reading..." : "Capture text"}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
