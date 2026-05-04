/**
 * Minimal ATProto client — just enough to log in via app-password and
 * push `com.atproto.repo.createRecord` payloads. We deliberately
 * avoid the full @atproto/api dep so the worker bundle stays small.
 */

export interface AtprotoSession {
  did: string;
  accessJwt: string;
  refreshJwt: string;
}

export async function atprotoLogin(
  pdsUrl: string,
  identifier: string,
  password: string,
): Promise<AtprotoSession> {
  const res = await fetch(`${pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`atproto login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { did: string; accessJwt: string; refreshJwt: string };
  return body;
}

export async function atprotoCreateRecord(
  pdsUrl: string,
  accessJwt: string,
  did: string,
  collection: string,
  record: Record<string, unknown>,
): Promise<{ uri: string; cid: string }> {
  const res = await fetch(`${pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessJwt}` },
    body: JSON.stringify({ repo: did, collection, record }),
  });
  if (!res.ok) throw new Error(`atproto createRecord failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { uri: string; cid: string };
}
