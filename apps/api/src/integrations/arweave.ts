/**
 * Arweave / Turbo upload adapter.
 *
 * For v1 we use ArDrive Turbo's Upload Service (https://upload.ardrive.io)
 * which accepts a wallet-signed bearer token and a small JSON body for
 * data items < 100 KB. A typical 2-hour FIT file is ~200 KB; if it
 * exceeds the inline cap we just batch as a single bundle item.
 *
 * Auth: ARWEAVE_TURBO_TOKEN (paid signing token issued by ArDrive).
 *
 * On failure the function throws — caller (pipeline persist) decides
 * whether to retry. Returning the Turbo data-item id is enough to
 * resolve the eventual Arweave TX hash via Turbo's status endpoint.
 */

const TURBO_UPLOAD_URL = 'https://upload.ardrive.io/v1/tx';

export interface ArweaveUploadResult {
  /** Turbo data-item id, becomes the eventual Arweave TX. */
  id: string;
}

export async function uploadToArweave(
  token: string,
  bytes: ArrayBuffer,
  tags: Record<string, string>,
): Promise<ArweaveUploadResult> {
  const tagList = Object.entries(tags).map(([name, value]) => ({ name, value }));
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/octet-stream',
    'x-tags': btoa(JSON.stringify(tagList)),
  });
  const res = await fetch(TURBO_UPLOAD_URL, { method: 'POST', headers, body: bytes });
  if (!res.ok) {
    throw new Error(`Turbo upload failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error('Turbo response missing id');
  return { id: body.id };
}
