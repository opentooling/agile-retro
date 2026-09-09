/**
 * Retention sweep: delete boards whose TTL has elapsed.
 *
 * Server-only, and deliberately free of Next.js request-scoped APIs, so the
 * same function can run from a server action, from the Socket.IO server's
 * periodic timer, and from a standalone script — none of which share a
 * request context.
 */
import * as db from "./db";

/** Delete every board past its expiry. Returns the ids that were removed. */
export async function purgeExpiredRetros(now: Date = new Date()): Promise<string[]> {
  const expired = await db.listExpiredRetroIds(now);
  const deleted: string[] = [];
  for (const id of expired) {
    try {
      await db.deleteRetro(id);
      deleted.push(id);
    } catch (err) {
      // One bad board must not stop the sweep; the next run retries it.
      console.error(`Retention sweep: failed to delete retro ${id}:`, err);
    }
  }
  return deleted;
}
