/**
 * Client-side image compression for asset photos.
 *
 * Scales a captured/uploaded image down so its longest edge fits within
 * `maxDimension`, then iteratively re-encodes as JPEG at descending quality
 * levels until the resulting data URL fits within `targetBytes`. Returns the
 * final data URL plus its decoded byte size and a flag indicating whether the
 * image was actually resized (vs. small enough to leave alone).
 *
 * Why this exists:
 * - Modern phone cameras produce 3-8 MB JPEGs. Base64-encoded that's 4-10 MB,
 *   which blows Apache's default LimitRequestBody on shared hosting (413).
 * - Compressing to ~200 KB keeps /api/store payloads (which historically
 *   embedded photo_url data) manageable and speeds up upload on slow site
 *   connections.
 * - 1600 px longest edge at q0.6-0.85 is plenty for downstream tesseract.js OCR
 *   of asset labels; larger dimensions only marginally help OCR while blowing
 *   up file size quadratically.
 */

export type CompressOptions = {
  /** Longest edge in pixels after downscaling. Aspect ratio is preserved. */
  maxDimension: number;
  /** Target maximum size of the resulting base64 data URL, in bytes. */
  targetBytes: number;
  /** Lower bound on JPEG quality; the loop will not drop below this. */
  minQuality?: number;
};

export type CompressResult = {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
  quality: number;
  wasShrunk: boolean;
};

/** Approximate decoded byte count of a base64 data URL without allocating. */
function dataUrlBytes(dataUrl: string): number {
  const commaAt = dataUrl.indexOf(",");
  if (commaAt < 0) return dataUrl.length;
  const b64 = dataUrl.slice(commaAt + 1);
  // Every 4 base64 chars decode to 3 bytes; adjust for '=' padding.
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = "async";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode failed"));
      el.src = objectUrl;
    });
    // Ensure fully decoded before drawing (some browsers need this for HEIC-converted blobs).
    if (typeof img.decode === "function") {
      await img.decode().catch(() => {});
    }
    return img;
  } finally {
    // Slight delay so the browser has actually loaded before we revoke.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/**
 * Compress a user-supplied image File into a JPEG data URL under `targetBytes`.
 * Throws if the file cannot be decoded (unsupported format, corrupt data).
 */
export async function compressImageToDataUrl(
  file: File,
  opts: CompressOptions
): Promise<CompressResult> {
  const { maxDimension, targetBytes, minQuality = 0.5 } = opts;

  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error("Image has no dimensions");

  const longest = Math.max(srcW, srcH);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const outW = Math.round(srcW * scale);
  const outH = Math.round(srcH * scale);
  const wasShrunk = scale < 1;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // White backdrop so alpha PNGs don't get transparent JPEG blocks.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  // Try descending quality levels until we fit under targetBytes.
  const qualities = [0.9, 0.82, 0.75, 0.68, 0.6, 0.55, 0.5];
  let best: CompressResult | null = null;
  for (const q of qualities) {
    if (q < minQuality) break;
    const dataUrl = canvas.toDataURL("image/jpeg", q);
    const bytes = dataUrlBytes(dataUrl);
    const result: CompressResult = {
      dataUrl,
      bytes,
      width: outW,
      height: outH,
      quality: q,
      wasShrunk
    };
    if (bytes <= targetBytes) return result;
    // Track the smallest we managed in case nothing fits.
    if (!best || bytes < best.bytes) best = result;
  }

  // Nothing hit the target at the current dimensions; try one more halved pass.
  if (best && best.bytes > targetBytes && outW > 800 && outH > 800) {
    const halvedW = Math.round(outW / 1.5);
    const halvedH = Math.round(outH / 1.5);
    const c2 = document.createElement("canvas");
    c2.width = halvedW;
    c2.height = halvedH;
    const c2ctx = c2.getContext("2d");
    if (c2ctx) {
      c2ctx.fillStyle = "#ffffff";
      c2ctx.fillRect(0, 0, halvedW, halvedH);
      c2ctx.drawImage(canvas, 0, 0, halvedW, halvedH);
      for (const q of [0.75, 0.65, 0.55, 0.5]) {
        if (q < minQuality) break;
        const dataUrl = c2.toDataURL("image/jpeg", q);
        const bytes = dataUrlBytes(dataUrl);
        if (bytes <= targetBytes) {
          return { dataUrl, bytes, width: halvedW, height: halvedH, quality: q, wasShrunk: true };
        }
        if (bytes < best.bytes) {
          best = { dataUrl, bytes, width: halvedW, height: halvedH, quality: q, wasShrunk: true };
        }
      }
    }
  }

  // Give the caller the best we managed, even if slightly over budget \u2014
  // still dramatically smaller than the original raw file in the common case.
  if (!best) throw new Error("Compression produced no output");
  return best;
}
