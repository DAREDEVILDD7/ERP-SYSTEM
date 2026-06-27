import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, X, CheckCheck, Trash2, Inbox, Loader2,
  FileText, FileCheck, Truck, Wrench, DollarSign,
  ShoppingCart, Package, User, Info,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useNotifications } from '../../context/NotificationContext';

// ── type config ──────────────────────────────────────────────────────────────
const TYPE_CFG = {
  requirement:  { color: '#3b82f6', bg: 'bg-blue-50',    Icon: FileText    },
  quotation:    { color: '#8b5cf6', bg: 'bg-purple-50',  Icon: FileCheck   },
  dispatch:     { color: '#6366f1', bg: 'bg-indigo-50',  Icon: Truck       },
  maintenance:  { color: '#f97316', bg: 'bg-orange-50',  Icon: Wrench      },
  invoice:      { color: '#22c55e', bg: 'bg-green-50',   Icon: DollarSign  },
  procurement:  { color: '#14b8a6', bg: 'bg-teal-50',    Icon: ShoppingCart},
  equipment:    { color: '#f59e0b', bg: 'bg-amber-50',   Icon: Package     },
  system:       { color: '#6b7280', bg: 'bg-gray-50',    Icon: Info        },
  user:         { color: '#f43f5e', bg: 'bg-rose-50',    Icon: User        },
};
const DEF_CFG = TYPE_CFG.system;

function timeAgo(ts) {
  try {
    return formatDistanceToNow(
      typeof ts === 'string' ? parseISO(ts) : new Date(ts),
      { addSuffix: true }
    );
  } catch { return ''; }
}

// ── Banner preview (slides in, then flies into bell) ────────────────────────
function BannerPreview({ notif, onDismiss, flyAway }) {
  const { color, bg, Icon } = TYPE_CFG[notif?.type] ?? DEF_CFG;
  return (
    <div
      className={`relative ${flyAway ? 'nb-fly' : 'nb-banner'}`}
      style={{ pointerEvents: flyAway ? 'none' : 'auto' }}>
      <div
        className={`flex items-start gap-3 p-3 pr-8 bg-white rounded-xl shadow-2xl
          border border-gray-100 w-64`}
        style={{ borderLeftWidth: 3, borderLeftColor: color }}>
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
          <Icon size={13} style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-800 leading-snug truncate">
            {notif.title}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {notif.message}
          </p>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center
          text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors">
        <X size={11} />
      </button>
    </div>
  );
}

// ── Single notification row ───────────────────────────────────────────────────
function NotifRow({ notif, onRead, onDelete, onNavigate, onClose, delay }) {
  const { color, bg, Icon } = TYPE_CFG[notif.type] ?? DEF_CFG;
  const [hov, setHov] = useState(false);

  const handleClick = () => {
    if (!notif.is_read) onRead(notif.notification_id);
    if (notif.link) { onNavigate(notif.link); onClose(); }
  };

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={handleClick}
      className={`nb-row relative px-4 py-3 flex items-start gap-3 cursor-pointer select-none
        transition-colors duration-100
        ${notif.is_read
          ? 'hover:bg-gray-50/70'
          : 'bg-blue-50/25 hover:bg-blue-50/50'}`}
      style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
        <Icon size={14} style={{ color }} />
      </div>

      <div className="min-w-0 flex-1 pr-4">
        <p className={`text-sm leading-snug truncate
          ${notif.is_read ? 'text-gray-500 font-normal' : 'text-gray-900 font-medium'}`}>
          {notif.title}
        </p>
        <p className="text-xs text-gray-400 mt-0.5 leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {notif.message}
        </p>
        <p className="text-[10px] text-gray-300 mt-1.5 font-medium">{timeAgo(notif.created_at)}</p>
      </div>

      {!notif.is_read && (
        <span className="absolute right-9 top-[18px] w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: color }} />
      )}

      {hov && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(notif.notification_id); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center
            justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function NotificationBell() {
  const {
    notifications, unreadCount, loading, newNotif,
    markRead, markAllRead, removeNotif, clearAll, dismissBanner,
  } = useNotifications();

  const [open,    setOpen]    = useState(false);
  const [flyAway, setFlyAway] = useState(false);
  const panelRef = useRef(null);
  const bellRef  = useRef(null);
  const flyTimer = useRef(null);
  const navigate = useNavigate();

  // Trigger fly-away 3 s after a new banner appears
  useEffect(() => {
    if (!newNotif) { setFlyAway(false); return; }
    setFlyAway(false);
    clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => setFlyAway(true), 3000);
    return () => clearTimeout(flyTimer.current);
  }, [newNotif]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const h = e => {
      if (!panelRef.current?.contains(e.target) && !bellRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const handleBellClick = () => {
    const opening = !open;
    setOpen(opening);
    if (opening) { dismissBanner(); setFlyAway(false); }
  };

  return (
    <>
      <style>{`
        @keyframes nbRollDown {
          from { opacity:0; transform:translateY(-10px) scaleY(0.9) }
          to   { opacity:1; transform:translateY(0)     scaleY(1)   }
        }
        @keyframes nbSlideIn {
          from { opacity:0; transform:translateX(20px) scale(0.95) }
          to   { opacity:1; transform:translateX(0)    scale(1)    }
        }
        @keyframes nbFlyOff {
          0%   { opacity:1; transform:translate(0,0)      scale(1)    }
          100% { opacity:0; transform:translate(10px,-32px) scale(0.18) }
        }
        @keyframes nbFadeRow {
          from { opacity:0; transform:translateY(4px) }
          to   { opacity:1; transform:translateY(0)   }
        }
        @keyframes nbBadge {
          0%   { transform:scale(1)   }
          35%  { transform:scale(1.6) }
          65%  { transform:scale(0.85)}
          100% { transform:scale(1)   }
        }
        @keyframes nbRing {
          0%,55%,100% { transform:rotate(0)     }
          10%,30%     { transform:rotate(-18deg) }
          20%,40%     { transform:rotate(18deg)  }
        }
        .nb-panel  { transform-origin:top right;
                     animation:nbRollDown 0.24s cubic-bezier(0.34,1.56,0.64,1) both }
        .nb-banner { animation:nbSlideIn  0.28s cubic-bezier(0.34,1.56,0.64,1) both }
        .nb-fly    { animation:nbFlyOff   0.5s  cubic-bezier(0.55,0,1,0.45)    both }
        .nb-row    { animation:nbFadeRow  0.2s  ease                            both }
        .nb-badge  { animation:nbBadge   0.45s  cubic-bezier(0.34,1.56,0.64,1) both }
        .nb-ring   { animation:nbRing    0.75s  ease-in-out                          }
      `}</style>

      <div className="relative">

        {/* ── Bell button ── */}
        <button
          ref={bellRef}
          onClick={handleBellClick}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          className={`relative p-2 rounded-lg transition-colors
            ${open
              ? 'text-gray-700 bg-gray-100'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}>
          <Bell size={18} className={newNotif && !open ? 'nb-ring' : ''} />
          {unreadCount > 0 && (
            <span
              key={unreadCount}
              className="nb-badge absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px]
                bg-red-500 rounded-full flex items-center justify-center px-1 shadow-sm">
              <span className="text-white font-bold leading-none" style={{ fontSize: 9 }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            </span>
          )}
        </button>

        {/* ── Banner preview ── */}
        {newNotif && (
          <div className="absolute right-0 top-[calc(100%+10px)] z-[60]">
            <BannerPreview
              notif={newNotif}
              onDismiss={dismissBanner}
              flyAway={flyAway}
            />
          </div>
        )}

        {/* ── Dropdown panel ── */}
        {open && (
          <div
            ref={panelRef}
            className="nb-panel absolute right-0 top-[calc(100%+10px)]
              w-[340px] max-w-[calc(100vw-24px)]
              bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">

            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-800">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-[11px] text-gray-400
                      hover:text-gray-700 transition-colors">
                    <CheckCheck size={12} />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-300 hover:text-gray-500 transition-colors">
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-50">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={22} className="text-gray-300 animate-spin" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center py-12 gap-2.5">
                  <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
                    <Inbox size={22} className="text-gray-200" />
                  </div>
                  <p className="text-sm font-medium text-gray-400">All caught up!</p>
                  <p className="text-xs text-gray-300">No notifications yet.</p>
                </div>
              ) : (
                notifications.map((n, i) => (
                  <NotifRow
                    key={n.notification_id}
                    notif={n}
                    onRead={markRead}
                    onDelete={removeNotif}
                    onNavigate={navigate}
                    onClose={() => setOpen(false)}
                    delay={Math.min(i * 25, 180)}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-300">
                  {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1 text-[11px] text-gray-400
                    hover:text-red-500 transition-colors">
                  <Trash2 size={11} />
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
