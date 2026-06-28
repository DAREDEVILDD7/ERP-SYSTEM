import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
} from '../api/notifications';

const NotificationContext = createContext(null);

const POLL_MS = 6000; // 6-second poll — primary delivery for cross-user notifications

export function NotificationProvider({ children }) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [newNotif,      setNewNotif]      = useState(null);
  const bannerTimer    = useRef(null);
  const bannerQueue    = useRef([]);   // ordered oldest→newest for sequential display
  const bannerShowing  = useRef(false);
  const knownIds       = useRef(new Set());
  const initialised    = useRef(false);
  const pollTimer      = useRef(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // ── banner queue — shows notifications one at a time, oldest first ──────────
  const showNextBanner = useCallback(() => {
    if (bannerQueue.current.length === 0) {
      bannerShowing.current = false;
      setNewNotif(null);
      return;
    }
    bannerShowing.current = true;
    const next = bannerQueue.current.shift();
    setNewNotif(next);
    bannerTimer.current = setTimeout(() => {
      setNewNotif(null);
      // small gap between consecutive banners so fly-away animation finishes
      bannerTimer.current = setTimeout(showNextBanner, 400);
    }, 5000);
  }, []);

  const enqueueBanners = useCallback((notifs) => {
    // notifs should be oldest-first so they display in chronological order
    bannerQueue.current.push(...notifs);
    if (!bannerShowing.current) showNextBanner();
  }, [showNextBanner]);

  // ── core fetch ──────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!profile?.user_id) return;
    if (!silent) setLoading(true);
    try {
      const data = await getNotifications(profile.user_id);

      // Detect genuinely new notifications on every poll
      if (initialised.current && data.length > 0) {
        // data is ordered created_at DESC — reverse so oldest shows first
        const incoming = data
          .filter(n => !knownIds.current.has(n.notification_id))
          .reverse();
        if (incoming.length > 0) enqueueBanners(incoming);
      }

      knownIds.current = new Set(data.map(n => n.notification_id));
      initialised.current = true;
      setNotifications(data);
    } catch (err) {
      console.error('[Notifications] load failed:', err?.message ?? err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [profile?.user_id, enqueueBanners]);

  // ── initial load (reset all state when user changes) ────────────────────────
  useEffect(() => {
    initialised.current   = false;
    knownIds.current      = new Set();
    bannerQueue.current   = [];
    bannerShowing.current = false;
    clearTimeout(bannerTimer.current);
    setNewNotif(null);
    load();
  }, [load]);

  // ── polling (handles background-tab browser throttling via manual scheduling) ─
  // Using manual setTimeout chaining instead of setInterval so each poll waits
  // for the previous fetch to complete before scheduling the next one.
  useEffect(() => {
    if (!profile?.user_id) return;
    let cancelled = false;

    const schedule = () => {
      pollTimer.current = setTimeout(async () => {
        if (cancelled) return;
        await load(true);
        if (!cancelled) schedule();
      }, POLL_MS);
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer.current);
    };
  }, [profile?.user_id, load]);

  // ── immediate poll on tab focus / visibility restore ────────────────────────
  // Browsers throttle setInterval in background tabs (up to 1-min intervals).
  // This ensures OM/other users see notifications the moment they switch back.
  useEffect(() => {
    if (!profile?.user_id) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    const onFocus = () => load(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [profile?.user_id, load]);

  // ── realtime (enhancement — immediate delivery when it works) ───────────────
  useEffect(() => {
    if (!profile?.user_id) return;
    const uid = profile.user_id;

    const channel = supabase
      .channel(`notif:${uid}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        payload => {
          try {
            const n = payload.new;
            if (!n || n.user_id !== uid) return;
            if (knownIds.current.has(n.notification_id)) return;

            knownIds.current.add(n.notification_id);
            setNotifications(prev => [n, ...prev]);
            enqueueBanners([n]); // single realtime event — goes straight to queue
          } catch (err) {
            console.error('[Notifications] realtime error:', err?.message ?? err);
          }
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Notifications] realtime error — polling active as fallback');
        }
      });

    return () => {
      clearTimeout(bannerTimer.current);
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, [profile?.user_id, enqueueBanners]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const markRead = useCallback(async id => {
    setNotifications(prev =>
      prev.map(n => n.notification_id === id ? { ...n, is_read: true } : n)
    );
    try { await markNotificationRead(id); }
    catch (err) { console.error('[Notifications] markRead error:', err?.message); }
  }, []);

  const markAllRead = useCallback(async () => {
    if (!profile?.user_id) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try { await markAllNotificationsRead(profile.user_id); }
    catch (err) { console.error('[Notifications] markAllRead error:', err?.message); }
  }, [profile?.user_id]);

  const removeNotif = useCallback(async id => {
    setNotifications(prev => prev.filter(n => n.notification_id !== id));
    knownIds.current.delete(id);
    try { await deleteNotification(id); }
    catch (err) { console.error('[Notifications] remove error:', err?.message); }
  }, []);

  const clearAll = useCallback(async () => {
    if (!profile?.user_id) return;
    setNotifications([]);
    knownIds.current.clear();
    try { await deleteAllNotifications(profile.user_id); }
    catch (err) { console.error('[Notifications] clearAll error:', err?.message); }
  }, [profile?.user_id]);

  const dismissBanner = useCallback(() => {
    clearTimeout(bannerTimer.current);
    bannerQueue.current = [];          // clear pending queue so user isn't spammed
    bannerShowing.current = false;
    setNewNotif(null);
  }, []);

  return (
    <NotificationContext.Provider value={{
      notifications, unreadCount, loading, newNotif,
      markRead, markAllRead, removeNotif, clearAll, dismissBanner, reload: load,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
