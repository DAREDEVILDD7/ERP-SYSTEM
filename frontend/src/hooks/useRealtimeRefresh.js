import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Subscribes to Supabase postgres_changes for the given tables and fires
 * onRefresh (debounced) whenever any row is inserted, updated or deleted.
 *
 * @param {string[]} tables    - Table names to watch (define outside component or with useMemo)
 * @param {Function} onRefresh - Callback to invoke on change (latest ref is always used)
 * @param {number}   [debounceMs=600] - Milliseconds to wait before firing after the last event
 */
export function useRealtimeRefresh(tables, onRefresh, debounceMs = 600) {
  // Always hold the latest callback without triggering re-subscription
  const callbackRef = useRef(onRefresh);
  useEffect(() => { callbackRef.current = onRefresh; });

  // Stable key derived from table list — changes only when tables actually change
  const tablesKey = Array.isArray(tables) ? tables.slice().sort().join('\0') : '';

  useEffect(() => {
    if (!tablesKey) return;
    const tableList = tablesKey.split('\0').filter(Boolean);

    let timer = null;
    const trigger = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          callbackRef.current?.();
        } catch (err) {
          console.warn('[Realtime] refresh callback threw:', err?.message ?? err);
        }
      }, debounceMs);
    };

    const channels = tableList.map(table => {
      const channelId = `rt:${table}:${Math.random().toString(36).slice(2, 9)}`;
      return supabase
        .channel(channelId)
        .on('postgres_changes', { event: '*', schema: 'public', table }, trigger)
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR') {
            console.warn(`[Realtime] subscription error — table: ${table}`);
          }
        });
    });

    return () => {
      clearTimeout(timer);
      channels.forEach(ch => {
        try { supabase.removeChannel(ch); } catch (_) {}
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, debounceMs]);
}
