import { isNativeApp } from './platform';

/**
 * Save bytes/text as a file.
 * Web: a temporary download link (works offline, no server).
 * Android app: links can't download inside the app, so the file is written to
 * the app's cache and handed to Android's share sheet, where the user picks
 * where it goes (Files, Google Drive, WhatsApp…).
 */
export async function downloadFile(data: BlobPart, filename: string, type: string): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (isNativeApp()) return shareNative(blob, filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function shareNative(blob: Blob, filename: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: filename });
  } catch (e) {
    // closing the share sheet without choosing is not an error
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
