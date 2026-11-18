/**
 * Shrink phone photos before storing them: longest side ≤ 1600 px, JPEG 82%.
 * Receipts stay readable while a 12 MP photo drops from ~4 MB to ~300 KB.
 * Non-images, GIF/SVG and images that would not get smaller are kept as-is.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/') || /gif|svg/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // unsupported format in this browser — store the original
  }
}

export function attachmentName(original: string, blob: Blob): string {
  if (blob.type === 'image/jpeg' && !/\.jpe?g$/i.test(original)) return original.replace(/\.[^.]+$/, '') + '.jpg';
  return original;
}
