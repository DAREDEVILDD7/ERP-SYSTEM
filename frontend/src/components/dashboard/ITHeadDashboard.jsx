import { useState, useEffect, useCallback } from 'react';
import {
  Users, Activity, LogIn, Package, Wrench, ShoppingCart,
  RefreshCw, AlertTriangle, Server,
  Calendar, CheckCircle2,
} from 'lucide-react';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, Label,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import LoadingSpinner from '../common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import { fetchITStats } from '../../api/dashboard';
import { Bar3D, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

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

function getSessionStatus(log) {
  if (log.logged_out_at) return 'ended';
  const ageH = (Date.now() - new Date(log.logged_in_at).getTime()) / 3_600_000;
  return ageH < 8 ? 'active' : 'abandoned';
}

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60)  return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const BROWSER_EMOJI = { Chrome: '🌐', Firefox: '🦊', Safari: '🧭', Edge: '🔷', Opera: '🔴', Unknown: '💻' };

const SESSION_STATUS_CFG = {
  active:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400 it-pulse' },
  ended:     { label: 'Ended',     cls: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-300'             },
  abandoned: { label: 'Abandoned', cls: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400'            },
};

const EQ_COLORS = {
  Available:   '#22c55e',
  Reserved:    '#eab308',
  Dispatched:  '#3b82f6',
  Maintenance: '#ef4444',
  Retired:     '#9ca3af',
  Locked:      '#a855f7',
};

const ROLE_BAR_COLORS = [
  '#6366f1','#3b82f6','#14b8a6','#f59e0b',
  '#ef4444','#8b5cf6','#06b6d4','#22c55e','#f97316',
];

const MAINT_STATUS_CLS = {
  'Open':        'bg-red-100 text-red-700',
  'In Progress': 'bg-amber-100 text-amber-700',
  'Completed':   'bg-green-100 text-green-700',
};

const ROLE_INITIALS_BG = [
  'bg-indigo-100 text-indigo-600',
  'bg-blue-100 text-blue-600',
  'bg-teal-100 text-teal-600',
  'bg-amber-100 text-amber-600',
  'bg-purple-100 text-purple-600',
  'bg-rose-100 text-rose-600',
  'bg-cyan-100 text-cyan-600',
  'bg-orange-100 text-orange-600',
];

const TABLES = ['users','session_logs','equipment_units','maintenance','procurements'];

export default function ITHeadDashboard() {
  const { profile } = useAuth();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const hour    = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const totalEq = data?.equipmentByStatus?.reduce((s, e) => s + e.value, 0) ?? 0;

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else        setLoading(true);
    setError(null);
    try {
      setData(await fetchITStats());
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const realtimeLoad = useCallback(() => load(true), [load]);
  useRealtimeRefresh(TABLES, realtimeLoad);

  if (loading) return <LoadingSpinner fullscreen={false} />;

  if (error) return (
    <div className="neo-card p-10 text-center it-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, usersByRole, equipmentByStatus, recentSessions, maintenanceJobs } = data;

  const kpiCards = [
    { label: 'System Users',         value: stats.totalUsers,         sub: `${stats.activeUsers} active`, Icon: Users,        iconCls: 'text-violet-500', delay: '0ms'   },
    { label: 'Active Sessions',       value: stats.activeSessions,     sub: 'last 8 hours',                Icon: Activity,     iconCls: 'text-emerald-500',pulse: stats.activeSessions > 0, delay: '55ms'  },
    { label: 'Logins Today',          value: stats.loginsToday,        sub: format(new Date(), 'dd MMM'),  Icon: LogIn,        iconCls: 'text-blue-500',   delay: '110ms' },
    { label: 'Total Equipment',       value: stats.totalEquipment,     sub: 'in fleet',                    Icon: Package,      iconCls: 'text-teal-500',   delay: '165ms' },
    { label: 'Open Maintenance',      value: stats.openMaintenance,    sub: 'open + in progress',          Icon: Wrench,       iconCls: 'text-amber-500',  pulse: stats.openMaintenance > 5, delay: '220ms' },
    { label: 'Pending Procurement',   value: stats.pendingProcurement, sub: 'draft + awaiting',            Icon: ShoppingCart, iconCls: 'text-rose-500',   pulse: stats.pendingProcurement > 0, delay: '275ms' },
  ];

  return (
    <>
      <style>{`
        @keyframes itFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes itSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes itPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes itPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes itGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0)} 50%{box-shadow:0 0 0 6px rgba(139,92,246,0.15)} }
        .it-fade  { animation: itFadeIn  0.28s ease both }
        .it-up    { animation: itSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .it-pop   { animation: itPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .it-pulse { animation: itPulse   1.8s ease-in-out infinite }
        .it-glow  { animation: itGlow    2.4s ease-in-out infinite }
        .it-row   { animation: itFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 it-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-700 via-violet-600 to-indigo-500 p-6 text-white shadow-lg it-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute top-4 right-28 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center it-glow">
                <Server size={22} className="text-white" />
              </div>
              <div>
                <p className="text-violet-200 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Head of IT'}</h1>
                <p className="text-violet-200 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · IT Command Center
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center it-pop" style={{ animationDelay: '200ms' }}>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-300 it-pulse" />
                  <p className="text-xl font-bold leading-none">{stats.activeSessions}</p>
                </div>
                <p className="text-violet-200 text-xs mt-1">Live Sessions</p>
              </div>
              {stats.openMaintenance > 0 && (
                <div className="bg-amber-400/25 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center it-pop" style={{ animationDelay: '260ms' }}>
                  <p className="text-xl font-bold leading-none">{stats.openMaintenance}</p>
                  <p className="text-amber-100 text-xs mt-1">Open Maintenance</p>
                </div>
              )}
              <button onClick={() => load(true)} disabled={refreshing}
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm transition-colors disabled:opacity-60">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpiCards.map(({ label, value, sub, Icon, iconCls, pulse, delay }) => (
            <div key={label} className="neo-kpi it-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-violet-400 it-pulse shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
              {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Users by role — horizontal bar */}
          <div className="neo-card p-5 it-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Users size={14} className="text-violet-400" /> Users by Role
            </h3>
            {usersByRole.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No user data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={usersByRole} layout="vertical" margin={{ left: 12, right: 20 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                  <Bar dataKey="value" shape={Bar3D}
                    isAnimationActive animationDuration={900} animationEasing="ease-out">
                    {usersByRole.map((_, i) => (
                      <Cell key={i} fill={ROLE_BAR_COLORS[i % ROLE_BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Equipment by status — donut */}
          <div className="neo-card p-5 it-up" style={{ animationDelay: '140ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Package size={14} className="text-teal-400" /> Equipment by Status
            </h3>
            {equipmentByStatus.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No equipment data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  {PIE_FILTER_DEF}
                  <Pie
                    data={equipmentByStatus} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={62} outerRadius={92}
                    paddingAngle={2} labelLine={false}
                    isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                    style={PIE_STYLE}
                  >
                    {equipmentByStatus.map(entry => (
                      <Cell key={entry.name} fill={EQ_COLORS[entry.name] ?? '#94a3b8'} />
                    ))}
                    <Label content={<DonutCentre total={totalEq} label="units" />} position="center" />
                  </Pie>
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Activity row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Recent Sessions */}
          <div className="neo-card it-up" style={{ animationDelay: '190ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Activity size={13} className="text-violet-400" /> Recent Sessions
              </h3>
              <span className="text-xs text-slate-400">{recentSessions.length} shown</span>
            </div>
            <div className="divide-y neo-divider">
              {recentSessions.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">No session data yet.</p>
              ) : recentSessions.map((s, i) => {
                const status = getSessionStatus(s);
                const scfg   = SESSION_STATUS_CFG[status];
                const { browser } = parseBrowser(s.user_agent);
                const initial    = (s.name ?? s.username ?? '?').charAt(0).toUpperCase();
                const colorCls   = ROLE_INITIALS_BG[i % ROLE_INITIALS_BG.length];
                return (
                  <div key={s.session_log_id}
                    className="px-5 py-3 flex items-center justify-between gap-3 neo-row transition-colors it-row"
                    style={{ animationDelay: `${240 + i * 40}ms` }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-7 h-7 rounded-full ${colorCls} flex items-center justify-center shrink-0 text-xs font-bold`}>
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.name ?? s.username}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {s.role ?? '—'} · {BROWSER_EMOJI[browser]} {browser}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${scfg.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${scfg.dot}`} />
                        {scfg.label}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {format(parseISO(s.logged_in_at), 'HH:mm')}
                        {s.session_duration_seconds != null && (
                          <span className="ml-1 text-slate-300">· {fmtDuration(s.session_duration_seconds)}</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Maintenance Queue */}
          <div className="neo-card it-up" style={{ animationDelay: '230ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Wrench size={13} className="text-amber-400" /> Maintenance Queue
              </h3>
              <span className="text-xs text-slate-400">{maintenanceJobs.length} open</span>
            </div>
            <div className="divide-y neo-divider">
              {maintenanceJobs.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-2">
                  <CheckCircle2 size={28} className="text-green-300" />
                  <p className="text-sm text-slate-400">All clear — no open maintenance jobs.</p>
                </div>
              ) : maintenanceJobs.map((job, i) => (
                <div key={job.maintenance_id}
                  className="px-5 py-3 flex items-start justify-between gap-3 neo-row transition-colors it-row"
                  style={{ animationDelay: `${280 + i * 45}ms` }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{job.issue}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {job.equipment_units?.equipment_types?.name ?? '—'}
                      {job.equipment_units?.capacity ? ` · ${job.equipment_units.capacity}` : ''}
                    </p>
                    {job.service_date && (
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <Calendar size={9} /> {format(parseISO(job.service_date), 'dd MMM yyyy')}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${MAINT_STATUS_CLS[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
