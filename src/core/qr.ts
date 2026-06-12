import jsQR from "jsqr";

/** Decode the first QR code found in an image file/blob. Returns its text, or null. */
export async function decodeQrFromImage(file: File | Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(image.data, image.width, image.height);
  return result?.data ?? null;
}

/** Try to read a QR image from the clipboard (e.g. a pasted screenshot). */
export async function decodeQrFromClipboard(): Promise<string | null> {
  const clip = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItems> };
  if (!clip?.read) return null;
  const items = await clip.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) {
      const blob = await item.getType(type);
      return decodeQrFromImage(blob);
    }
  }
  return null;
}
