// Temporary Analytics session persistence — NOT a chat-history feature.
//
// Lets a user leave Analytics (e.g. to inspect an Equipment unit a chart
// pointed them to), come back, and resume the same conversation/filter/tab
// instead of starting over. Expires on a sliding 30-minute window measured
// from the last save, so it behaves like a "recently used" resume point,
// never a permanent archive.
//
// Storage is localStorage, not sessionStorage, specifically so a closed and
// reopened tab can still restore within the window — sessionStorage cannot
// survive that at all. The 30-minute TTL is enforced entirely here
// (`lastActivityAt`, checked on every load), which is what keeps this
// "temporary" despite living in a persistent store.
//
// Scoped per signed-in user (the key embeds `user_id`) so a second person
// signing in on the same browser never inherits the first person's
// conversation. Holds only this page's own UI/conversation shape (asked
// prompts, selected range/tab, ribbon collapse) — never business data.
// Fetched chart data lives in React Query's cache, which already survives
// ordinary in-app navigation on its own (QueryClientProvider sits above the
// router and never unmounts), so there is nothing for this module to do
// there.

const SCHEMA_VERSION = 1;
const TTL_MS = 30 * 60_000;
const KEY_PREFIX = 'jtc.analyticsSession.v1';

function storageKey(userId) {
  return `${KEY_PREFIX}:${userId}`;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function loadAnalyticsSession(userId) {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      window.localStorage.removeItem(storageKey(userId));
      return null;
    }
    const last = Number(parsed.lastActivityAt);
    if (!Number.isFinite(last) || Date.now() - last > TTL_MS) {
      window.localStorage.removeItem(storageKey(userId));
      return null;
    }
    if (!Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    // Corrupted JSON, disabled storage, anything at all — never let a
    // broken cache take the page down with it.
    try { window.localStorage.removeItem(storageKey(userId)); } catch { /* ignore */ }
    return null;
  }
}

// Shallow-merges `partial` onto whatever is already stored (or nothing, if
// the existing entry is missing/unreadable/stale-schema) and refreshes
// `lastActivityAt`, which is what implements the sliding expiration — any
// save extends the window.
export function saveAnalyticsSession(userId, partial) {
  if (!userId) return;
  try {
    const key = storageKey(userId);
    let current = {};
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isPlainObject(parsed) && parsed.schemaVersion === SCHEMA_VERSION) current = parsed;
      }
    } catch { /* unreadable existing entry — overwrite with a fresh one */ }
    const next = {
      ...current,
      ...partial,
      schemaVersion: SCHEMA_VERSION,
      lastActivityAt: Date.now(),
    };
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage full/disabled (e.g. some private-browsing modes) — this
    // feature is a convenience, never a requirement for Analytics to work.
  }
}

export function clearAnalyticsSession(userId) {
  if (!userId) return;
  try { window.localStorage.removeItem(storageKey(userId)); } catch { /* already gone */ }
}
