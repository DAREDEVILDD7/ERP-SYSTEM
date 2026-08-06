import { lazy } from 'react';

/**
 * `React.lazy` with recovery from the one failure mode code splitting adds.
 *
 * A deployed `index.html` points at content-hashed chunk filenames. The moment
 * a new build goes live those filenames change and the old ones stop existing,
 * so anyone with the app already open who then navigates to a route they have
 * not visited yet requests a chunk that now 404s. `import()` rejects with a
 * ChunkLoadError, `React.lazy` re-throws it, and the ErrorBoundary swallows the
 * whole app into "Something went wrong" — for a user who did nothing wrong and
 * whose only real problem is that they are holding a stale page.
 *
 * Recovery, in order:
 *   1. Retry the import once. Covers a genuinely transient network blip, and
 *      costs nothing when the chunk is simply missing (an immediate 404).
 *   2. Reload the page. That re-fetches `index.html` — which vercel.json marks
 *      `must-revalidate` precisely so this works — and the app comes back on
 *      the current build with valid chunk URLs.
 *   3. If we have already reloaded once and it is still failing, this is not a
 *      stale deploy. Re-throw so the ErrorBoundary shows its message rather
 *      than putting the tab in a reload loop.
 *
 * The once-only guard lives in `sessionStorage`, matching the convention every
 * other session-scoped flag in this app uses (`jtc_loading_played`,
 * `jtc_super_admin_dashboard_view`). It is cleared by the next chunk that loads
 * successfully, so a later, unrelated failure still gets its own single retry.
 *
 * Storage access is wrapped: `sessionStorage` throws outright in some privacy
 * modes, and a recovery path that can itself throw is worse than no recovery.
 */

const RELOAD_FLAG = 'jtc_chunk_reload';

function reloadAlreadyTried() {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === '1';
  } catch (_) {
    // No storage: we cannot prove we have not reloaded before, so never
    // reload. Failing to the ErrorBoundary beats risking a reload loop.
    return true;
  }
}

function markReloadTried() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1');
    return true;
  } catch (_) {
    return false;
  }
}

function clearReloadFlag() {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch (_) {
    /* nothing to clear if storage is unavailable */
  }
}

export default function lazyRoute(load) {
  return lazy(() =>
    load()
      .then((mod) => {
        clearReloadFlag();
        return mod;
      })
      .catch(async (err) => {
        try {
          const mod = await load();
          clearReloadFlag();
          return mod;
        } catch (retryErr) {
          if (!reloadAlreadyTried() && markReloadTried()) {
            console.warn(
              '[lazyRoute] chunk failed to load, reloading for the current ' +
              'build', retryErr
            );
            window.location.reload();
            // Hold the promise open so React never renders an error state in
            // the frames before the reload actually tears the document down.
            return new Promise(() => {});
          }
          throw retryErr;
        }
      })
  );
}
