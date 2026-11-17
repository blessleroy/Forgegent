/**
 * Session revocation helper (tasks 1.3/1.5, D43/D22).
 *
 * With secondary storage configured, better-auth lives sessions in the kv
 * cache (keyed by the raw cookie token) — DB rows may not exist at all, so
 * deleting the `sessions` table is not enough. better-auth's own revocation
 * watermark is the reliable switch: setting `revoked-sessions-before-<uid>`
 * to "now" marks every cached session created before it as revoked
 * (findSession → isRevokedSession). We also drop the per-user index, the
 * listed token caches, and any DB rows for good measure.
 */
import { rawExec, type ForgegentDb } from "@forgegent/db";

type KvClient = {
  prepare(sql: string): { get(...p: unknown[]): unknown; run(...p: unknown[]): unknown };
};

function kvOf(db: ForgegentDb): KvClient {
  return (db as unknown as { $client: KvClient }).$client;
}

/** Revoke EVERY session of a user (cache watermark + index + tokens + DB). */
export function revokeAllUserSessions(db: ForgegentDb, userId: string): void {
  const kv = kvOf(db);
  const now = Date.now();
  // Watermark: invalidates every session issued before "now" — checked on
  // every findSession, cached or not. TTL outlives the 7d session lifetime.
  kv
    .prepare(
      "INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)",
    )
    .run(`revoked-sessions-before-${userId}`, String(now), now + 2_592_000 * 1000);
  // Index + any token caches still listed there (best effort).
  const index = kv
    .prepare("SELECT value FROM kv_store WHERE key = ?")
    .get(`active-sessions-${userId}`) as { value: string } | undefined;
  if (index) {
    try {
      const refs = JSON.parse(index.value) as { token?: string }[];
      for (const ref of refs) {
        if (ref?.token) {
          kv.prepare("DELETE FROM kv_store WHERE key = ?").run(ref.token);
        }
      }
    } catch {
      /* malformed index — watermark already covers revocation */
    }
  }
  kv.prepare("DELETE FROM kv_store WHERE key = ?").run(`active-sessions-${userId}`);
  rawExec(db, "DELETE FROM sessions WHERE user_id = ?", userId);
}
