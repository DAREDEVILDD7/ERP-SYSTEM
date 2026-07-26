import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, Users, Clock, LogIn, RefreshCw, Search,
  Shield, Calendar, X,
  ChevronDown, AlertCircle,
} from 'lucide-react';
import { format, isToday, parseISO, subDays } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { getSessionLogs } from '../../api/sessionLogs';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { SkeletonTable, SkeletonStatCards } from '../../components/common/Skeleton';

// ── helpers ──────────────────────────────────────────────────────────────────

function parseBrowser(ua = '') {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' };
  let browser = 'Unknown';
  if (/Edg\//.test(ua))               browser = 'Edge';
  else if (/OPR\/|Opera\//.test(ua))  browser = 'Opera';
  else if (/Chrome\//.test(ua))       browser = 'Chrome';
  else if (/Firefox\//.test(ua))      browser = 'Firefox';
  else if (/Safari\//.test(ua))       browser = 'Safari';
  let os = 'Unknown';
  if (/Windows/.test(ua))             os = 'Windows';
  else if (/Android/.test(ua))        os = 'Android';
  else if (/iPhone|iPad/.test(ua))    os = 'iOS';
  else if (/Mac OS X/.test(ua))       os = 'macOS';
  else if (/Linux/.test(ua))          os = 'Linux';
  return { browser, os };
}

function fmtDuration(seconds) {
  if (seconds == null || seconds < 0) return '—';
  if (seconds < 60)  return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function getStatus(log) {
  if (log.logged_out_at) return 'ended';
  const ageH = (Date.now() - new Date(log.logged_in_at).getTime()) / 3_600_000;
  return ageH < 8 ? 'active' : 'abandoned';
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd MMM yyyy, HH:mm');
  } catch { return iso; }
}

const BROWSER_EMOJI = { Chrome: '🌐', Firefox: '🦊', Safari: '🧭', Edge: '🔷', Opera: '🔴', Unknown: '💻' };
const OS_SHORT      = { Windows: 'Win', macOS: 'Mac', Linux: 'Linux', Android: 'Droid', iOS: 'iOS', Unknown: '' };

const ROLE_COLORS = {
  'Admin':                'bg-purple-100 text-purple-700',
  'Sales Executive':      'bg-blue-100 text-blue-700',
  'Operations Manager':   'bg-teal-100 text-teal-700',
  'Warehouse Operator':   'bg-orange-100 text-orange-700',
  'Dispatch Coordinator': 'bg-cyan-100 text-cyan-700',
  'Finance Officer':      'bg-green-100 text-green-700',
  'Maintenance Engineer': 'bg-red-100 text-red-700',
  'Procurement Manager':  'bg-indigo-100 text-indigo-700',
};

const ALL_ROLES = [
  'Admin','Sales Executive','Operations Manager','Warehouse Operator',
  'Dispatch Coordinator','Finance Officer','Maintenance Engineer','Procurement Manager',
];

const STATUS_CFG = {
  active:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400 sl-pulse' },
  ended:     { label: 'Ended',     cls: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-300'             },
  abandoned: { label: 'Abandoned', cls: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400'            },
};

// ── component ─────────────────────────────────────────────────────────────────

export default function AuditLogs() {
  const { isAdmin } = useAuth();

  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom,     setDateFrom]     = useState(() => format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [dateTo,       setDateTo]       = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else        setLoading(true);
    try {
      const from = dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined;
      const to   = dateTo   ? `${dateTo}T23:59:59.999Z`   : undefined;
      const data = await getSessionLogs({ role: roleFilter || undefined, from, to });
      setLogs(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load session logs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [roleFilter, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const realtimeLoad = useCallback(() => load(true), [load]);
  useRealtimeRefresh(['session_logs'], realtimeLoad);

  // Computed stats
  const stats = useMemo(() => {
    const now        = Date.now();
    const todayLogs  = logs.filter(l => isToday(parseISO(l.logged_in_at)));
    const activeNow  = logs.filter(l => !l.logged_out_at && (now - new Date(l.logged_in_at).getTime()) < 8 * 3_600_000);
    const withDur    = logs.filter(l => l.session_duration_seconds != null);
    const avgDur     = withDur.length
      ? Math.round(withDur.reduce((s, l) => s + l.session_duration_seconds, 0) / withDur.length)
      : null;
    return {
      total:       logs.length,
      todayCount:  todayLogs.length,
      activeCount: activeNow.length,
      uniqueToday: new Set(todayLogs.map(l => l.user_id)).size,
      avgDur,
    };
  }, [logs]);

  // Filtered rows
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter(l => {
      if (q) {
        const hit = (l.name?.toLowerCase().includes(q))
          || (l.username?.toLowerCase().includes(q))
          || (l.role?.toLowerCase().includes(q))
          || (l.department?.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (statusFilter && getStatus(l) !== statusFilter) return false;
      return true;
    });
  }, [logs, search, statusFilter]);

  const clearFilters = () => {
    setSearch(''); setRoleFilter(''); setStatusFilter('');
    setDateFrom(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
    setDateTo(format(new Date(), 'yyyy-MM-dd'));
  };

  const hasFilter = search || roleFilter || statusFilter
    || dateFrom !== format(subDays(new Date(), 6), 'yyyy-MM-dd')
    || dateTo   !== format(new Date(), 'yyyy-MM-dd');

  // ── admin guard ────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center" style={{ animation: 'slFadeIn 0.3s ease' }}>
          <Shield size={44} className="mx-auto text-gray-200 mb-3"/>
          <p className="text-gray-500 font-medium">Admin access required</p>
          <p className="text-gray-400 text-sm mt-1">Only administrators can view session logs.</p>
        </div>
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes slFadeIn   { from { opacity: 0 }              to { opacity: 1 } }
        @keyframes slSlideUp  { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        @keyframes slPop      { 0% { transform: scale(0.92); opacity: 0 } 60% { transform: scale(1.03) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes slPulse    { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        .sl-fade  { animation: slFadeIn  0.25s ease both }
        .sl-up    { animation: slSlideUp 0.28s cubic-bezier(0.34,1.56,0.64,1) both }
        .sl-pop   { animation: slPop     0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .sl-pulse { animation: slPulse   1.6s ease-in-out infinite }
        .sl-row   { animation: slFadeIn  0.22s ease both }
        .sl-date  { color-scheme: light }
        .sl-date:focus { outline: 2px solid #EE1C25; outline-offset: 2px; border-color: #EE1C25 }
        .sl-select:focus { outline: 2px solid #EE1C25; outline-offset: 2px; border-color: #EE1C25 }
      `}</style>

      <div className="space-y-5 sl-fade">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Shield size={20} className="text-indigo-500"/> Session Logs
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {logs.length} records · {filtered.length} shown
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''}/>
            Refresh
          </button>
        </div>

        {/* Stat Cards */}
        {loading && <SkeletonStatCards count={4} />}
        <div className={loading ? 'hidden' : 'grid grid-cols-2 lg:grid-cols-4 gap-3'}>
          {[
            {
              label: "Today's Logins", value: stats.todayCount,
              icon: LogIn, iconCls: 'text-blue-500', bgCls: 'bg-blue-50',
              delay: '0ms',
            },
            {
              label: 'Active Now', value: stats.activeCount,
              icon: Activity, iconCls: 'text-emerald-500', bgCls: 'bg-emerald-50',
              pulse: stats.activeCount > 0, delay: '60ms',
            },
            {
              label: 'Unique Users Today', value: stats.uniqueToday,
              icon: Users, iconCls: 'text-indigo-500', bgCls: 'bg-indigo-50',
              delay: '120ms',
            },
            {
              label: 'Avg Session', value: fmtDuration(stats.avgDur),
              icon: Clock, iconCls: 'text-purple-500', bgCls: 'bg-purple-50',
              delay: '180ms',
            },
          ].map(({ label, value, icon: Icon, iconCls, bgCls, pulse, delay }) => (
            <div key={label} className="card p-4 sl-pop" style={{ animationDelay: delay }}>
              <div className="flex items-center justify-between">
                <div className={`w-9 h-9 rounded-xl ${bgCls} flex items-center justify-center`}>
                  <Icon size={16} className={iconCls}/>
                </div>
                {pulse && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 sl-pulse inline-block"/>
                    live
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-3">{value ?? '—'}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
              <input
                className="input pl-9 text-sm w-full"
                placeholder="Search name, username, role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Status */}
            <div className="relative">
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
              <select
                className="input pr-8 text-sm appearance-none sl-select"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
                <option value="abandoned">Abandoned</option>
              </select>
            </div>

            {/* Role */}
            <div className="relative">
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
              <select
                className="input pr-8 text-sm appearance-none sl-select"
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
              >
                <option value="">All Roles</option>
                {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-gray-400 shrink-0"/>
              <input type="date" className="input text-sm sl-date" value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}/>
              <span className="text-gray-400 text-sm">–</span>
              <input type="date" className="input text-sm sl-date" value={dateTo}
                onChange={e => setDateTo(e.target.value)}/>
            </div>

            {/* Clear */}
            {hasFilter && (
              <button onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors sl-fade">
                <X size={13}/> Clear
              </button>
            )}
          </div>
        </div>

        {/* Table / Cards */}
        {loading ? (
          <SkeletonTable rows={8} colWidths={[140, 100, 110, 100, 100, 80, 70, 110]} />
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center sl-up">
            <AlertCircle size={36} className="mx-auto text-gray-200 mb-3"/>
            <p className="text-gray-500 font-medium">No sessions found</p>
            <p className="text-gray-400 text-sm mt-1">Try adjusting your filters or date range.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="card overflow-hidden hidden md:block sl-up">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">User</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Department</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Login</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Logout</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Client</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((log, i) => {
                      const status  = getStatus(log);
                      const scfg    = STATUS_CFG[status];
                      const { browser, os } = parseBrowser(log.user_agent);
                      const initial = (log.name ?? log.username ?? '?').charAt(0).toUpperCase();
                      return (
                        <tr key={log.session_log_id}
                          className="hover:bg-gray-50/60 transition-colors sl-row"
                          style={{ animationDelay: `${Math.min(i * 18, 300)}ms` }}>
                          {/* User */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                                <span className="text-indigo-600 text-xs font-bold">{initial}</span>
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 text-sm leading-tight">{log.name ?? '—'}</p>
                                <p className="text-xs text-gray-400">@{log.username}</p>
                              </div>
                            </div>
                          </td>
                          {/* Role */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[log.role] ?? 'bg-gray-100 text-gray-600'}`}>
                              {log.role ?? '—'}
                            </span>
                          </td>
                          {/* Dept */}
                          <td className="px-4 py-3 hidden lg:table-cell text-gray-500 text-xs">{log.department ?? '—'}</td>
                          {/* Login */}
                          <td className="px-4 py-3">
                            <p className="text-gray-800 text-xs font-mono">{fmtTime(log.logged_in_at)}</p>
                          </td>
                          {/* Logout */}
                          <td className="px-4 py-3">
                            <p className="text-gray-500 text-xs font-mono">{fmtTime(log.logged_out_at)}</p>
                          </td>
                          {/* Duration */}
                          <td className="px-4 py-3">
                            <span className="text-gray-700 text-xs font-medium">
                              {fmtDuration(log.session_duration_seconds)}
                            </span>
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${scfg.cls}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${scfg.dot}`}/>
                              {scfg.label}
                            </span>
                          </td>
                          {/* Client */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <span className="text-xs text-gray-500">
                              {BROWSER_EMOJI[browser]} {browser}
                              {os !== 'Unknown' && <span className="ml-1 text-gray-400">· {OS_SHORT[os] || os}</span>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {filtered.map((log, i) => {
                const status = getStatus(log);
                const scfg   = STATUS_CFG[status];
                const { browser, os } = parseBrowser(log.user_agent);
                const initial = (log.name ?? log.username ?? '?').charAt(0).toUpperCase();
                return (
                  <div key={log.session_log_id}
                    className="card p-4 sl-up"
                    style={{ animationDelay: `${Math.min(i * 22, 300)}ms` }}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                          <span className="text-indigo-600 text-sm font-bold">{initial}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{log.name ?? '—'}</p>
                          <p className="text-xs text-gray-400">@{log.username}</p>
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${scfg.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${scfg.dot}`}/>
                        {scfg.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-gray-400">Role</p>
                        <span className={`inline-flex mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[log.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {log.role ?? '—'}
                        </span>
                      </div>
                      <div>
                        <p className="text-gray-400">Duration</p>
                        <p className="text-gray-800 font-medium mt-0.5">{fmtDuration(log.session_duration_seconds)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Login</p>
                        <p className="text-gray-700 font-mono mt-0.5">{fmtTime(log.logged_in_at)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Logout</p>
                        <p className="text-gray-500 font-mono mt-0.5">{fmtTime(log.logged_out_at)}</p>
                      </div>
                      {log.department && (
                        <div>
                          <p className="text-gray-400">Department</p>
                          <p className="text-gray-700 mt-0.5">{log.department}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-gray-400">Client</p>
                        <p className="text-gray-500 mt-0.5">{BROWSER_EMOJI[browser]} {browser} · {OS_SHORT[os] || os}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer count */}
            <p className="text-center text-xs text-gray-400 pb-2 sl-fade">
              Showing {filtered.length} of {logs.length} sessions
              {logs.length === 500 && ' (limit 500 — narrow date range to see more)'}
            </p>
          </>
        )}
      </div>
    </>
  );
}
