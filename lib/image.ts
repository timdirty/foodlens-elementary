const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_ORIGINAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PROCESSED_IMAGE_BYTES = 4_000_000;
export const PROCESSED_IMAGE_TYPE = "image/webp";
export const MAX_PROCESSED_IMAGE_SIDE = 1_600;

const SAFE_WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);

function littleEndian16(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function littleEndian24(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function littleEndian32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function chunkDimensions(
  bytes: Uint8Array,
  type: string,
  dataOffset: number,
  size: number,
) {
  if (type === "VP8X") {
    if (size !== 10) return undefined;
    // A canvas re-encode may preserve alpha, but it must not contain ICC,
    // animation, EXIF, XMP or any reserved feature flag.
    if ((bytes[dataOffset]! & ~0x10) !== 0) return undefined;
    return {
      width: littleEndian24(bytes, dataOffset + 4) + 1,
      height: littleEndian24(bytes, dataOffset + 7) + 1,
    };
  }
  if (type === "VP8 ") {
    if (
      size < 10 ||
      bytes[dataOffset + 3] !== 0x9d ||
      bytes[dataOffset + 4] !== 0x01 ||
      bytes[dataOffset + 5] !== 0x2a
    )
      return undefined;
    return {
      width: littleEndian16(bytes, dataOffset + 6) & 0x3fff,
      height: littleEndian16(bytes, dataOffset + 8) & 0x3fff,
    };
  }
  if (type === "VP8L") {
    if (size < 5 || bytes[dataOffset] !== 0x2f) return undefined;
    return {
      width:
        1 + bytes[dataOffset + 1]! + ((bytes[dataOffset + 2]! & 0x3f) << 8),
      height:
        1 +
        ((bytes[dataOffset + 2]! & 0xc0) >> 6) +
        (bytes[dataOffset + 3]! << 2) +
        ((bytes[dataOffset + 4]! & 0x0f) << 10),
    };
  }
  return null;
}

/**
 * The AI routes only accept this freshly encoded format. Checking both the
 * declared MIME type, RIFF length, safe chunk allowlist and canvas dimensions
 * prevents callers from bypassing browser-side EXIF removal by renaming a file
 * or supplying WebP metadata chunks directly.
 */
export async function isProcessedFoodLensImage(blob: Blob) {
  if (
    blob.type !== PROCESSED_IMAGE_TYPE ||
    blob.size < 30 ||
    blob.size > MAX_PROCESSED_IMAGE_BYTES
  ) {
    return false;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    littleEndian32(bytes, 4) !== bytes.length - 8
  )
    return false;

  let offset = 12;
  let canvasDimensions: { width: number; height: number } | undefined;
  let imageDimensions: { width: number; height: number } | undefined;
  let imageChunkCount = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    const type = ascii(bytes, offset, 4);
    const size = littleEndian32(bytes, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + size;
    const paddedEnd = dataEnd + (size % 2);
    if (!SAFE_WEBP_CHUNKS.has(type) || dataEnd > bytes.length) return false;
    if (paddedEnd > bytes.length) return false;

    const dimensions = chunkDimensions(bytes, type, dataOffset, size);
    if (dimensions === undefined) return false;
    if (dimensions) {
      if (type === "VP8X") {
        if (canvasDimensions) return false;
        canvasDimensions = dimensions;
      } else {
        imageChunkCount += 1;
        if (imageChunkCount > 1) return false;
        imageDimensions = dimensions;
      }
    }
    offset = paddedEnd;
  }

  const dimensions = canvasDimensions ?? imageDimensions;
  if (!dimensions || !imageDimensions || offset !== bytes.length) return false;
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_PROCESSED_IMAGE_SIDE ||
    dimensions.height > MAX_PROCESSED_IMAGE_SIDE
  )
    return false;
  return (
    !canvasDimensions ||
    (canvasDimensions.width === imageDimensions.width &&
      canvasDimensions.height === imageDimensions.height)
  );
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob?.type === PROCESSED_IMAGE_TYPE
          ? resolve(blob)
          : reject(new Error("瀏覽器無法將圖片安全重編碼為 WebP。")),
      PROCESSED_IMAGE_TYPE,
      quality,
    ),
  );
}

/**
 * Re-encode a user supplied food image in the browser. Drawing into a fresh
 * canvas drops EXIF metadata before the image can be stored or sent to a
 * provider. Plate and menu workflows deliberately share this single policy.
 */
export async function prepareFoodLensImage(file: File): Promise<Blob> {
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error("僅支援 JPEG、PNG 或 WebP 圖片。");
  if (file.size > MAX_ORIGINAL_IMAGE_BYTES)
    throw new Error("原始圖片不可超過 5MB。");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const attempts = [
    { maxSide: MAX_PROCESSED_IMAGE_SIDE, quality: 0.86 },
    { maxSide: MAX_PROCESSED_IMAGE_SIDE, quality: 0.72 },
    { maxSide: 1280, quality: 0.72 },
    { maxSide: 1024, quality: 0.64 },
  ];
  try {
    for (const attempt of attempts) {
      const scale = Math.min(
        1,
        attempt.maxSide / Math.max(bitmap.width, bitmap.height),
      );
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("瀏覽器無法處理這張圖片。");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToWebp(canvas, attempt.quality);
      if (blob.size <= MAX_PROCESSED_IMAGE_BYTES) return blob;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("處理後圖片仍超過 4MB，請改用解析度較低的照片。");
}

export const preparePlateImage = prepareFoodLensImage;
export const prepareMenuImage = prepareFoodLensImage;
