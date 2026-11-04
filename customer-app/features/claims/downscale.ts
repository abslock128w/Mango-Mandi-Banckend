/** Longest side, in pixels, a claim photo is sent at. */
const MAX_SIDE = 1600;
/** The API takes up to 2 MB per photo (mango-api photos.js). */
const MAX_BYTES = 1.8 * 1024 * 1024;
const SENDABLE = ["image/jpeg", "image/png", "image/webp"];

/**
 * A phone photo made small enough to send: drawn into a canvas at most
 * 1600 px on its longest side and saved as JPEG. A photo already small and
 * in a format the API takes is sent as it is.
 */
export async function downscale(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    if (SENDABLE.includes(file.type) && file.size <= MAX_BYTES) return file;
    throw new Error("That photo couldn't be read. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && SENDABLE.includes(file.type) && file.size <= MAX_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That photo couldn't be read. Try another.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("That photo is too large. Try another.");
}
