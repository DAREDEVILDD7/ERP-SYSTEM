import { useEffect, useState, useCallback } from 'react';
import { fetchMaintenanceStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { SkeletonDashboard } from '../common/Skeleton';
import {
  Wrench, AlertCircle, CheckCircle, Calendar,
  AlertTriangle, RefreshCw, Hammer, CheckCircle2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Label,
} from 'recharts';
import { format, isPast, parseISO } from 'date-fns';
import { ActivePieShape, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const ISSUE_COLORS = {
  Mechanical: '#f87171',
  Electrical: '#fbbf24',
  Hydraulic:  '#a78bfa',
  Tyre:       '#60a5fa',
  Cooling:    '#22d3ee',
  Body:       '#34d399',
  Other:      '#94a3b8',
};
const STATUS_CLS = {
  Open:         'bg-red-100 text-red-700',
  'In Progress':'bg-amber-100 text-amber-700',
};
const TABLES = ['maintenance','equipment_units'];

export default function MaintenanceDashboard() {
  const { profile } = useAuth();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeIdx,  setActiveIdx]  = useState(null);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else        setLoading(true);
    setError(null);
    try {
      setData(await fetchMaintenanceStats());
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const realtimeLoad = useCallback(() => load(true), [load]);
  useRealtimeRefresh(TABLES, realtimeLoad);

  if (loading) return <SkeletonDashboard statCount={4} />;

  if (error && !data) return (
    <div className="neo-card p-10 text-center mx-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm hover:bg-rose-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, jobs, byIssueType } = data;
  const totalByType = byIssueType.reduce((s, i) => s + i.value, 0);
  const overdue = jobs.filter(j => j.service_date && isPast(parseISO(j.service_date)));

  const kpiCards = [
    { label: 'Open Jobs',              value: stats.open,               Icon: AlertCircle, iconCls: 'text-red-500',   pulse: stats.open > 0, delay: '0ms'   },
    { label: 'In Progress',            value: stats.inProgress,         Icon: Wrench,      iconCls: 'text-amber-500', delay: '55ms'  },
    { label: 'Completed This Month',   value: stats.completedThisMonth, Icon: CheckCircle, iconCls: 'text-green-500', delay: '110ms' },
  ];

  return (
    <>
      <style>{`
        @keyframes mxFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes mxSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes mxPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes mxPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes mxGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(244,63,94,0)} 50%{box-shadow:0 0 0 8px rgba(244,63,94,0.18)} }
        @keyframes mxSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .mx-fade { animation: mxFadeIn  0.28s ease both }
        .mx-up   { animation: mxSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .mx-pop  { animation: mxPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .mx-pulse{ animation: mxPulse   1.8s ease-in-out infinite }
        .mx-glow { animation: mxGlow    2.4s ease-in-out infinite }
        .mx-spin { animation: mxSpin    3s linear infinite }
        .mx-row  { animation: mxFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 mx-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-700 via-red-600 to-orange-500 p-6 text-white shadow-lg mx-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-glow">
                <Hammer size={22} className="text-white" />
              </div>
              <div>
                <p className="text-red-100 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Maintenance Engineer'}</h1>
                <p className="text-red-100 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · Maintenance Hub
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats.open > 0 && (
                <div className="bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center mx-pop mx-pulse" style={{ animationDelay: '180ms' }}>
                  <p className="text-xl font-bold leading-none">{stats.open}</p>
                  <p className="text-red-100 text-xs mt-1">Open Jobs</p>
                </div>
              )}
              {overdue.length > 0 && (
                <div className="bg-red-900/40 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center mx-pop" style={{ animationDelay: '230ms' }}>
                  <p className="text-xl font-bold leading-none">{overdue.length}</p>
                  <p className="text-red-200 text-xs mt-1">Overdue</p>
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

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpiCards.map(({ label, value, Icon, iconCls, delay, pulse }) => (
            <div key={label} className="neo-kpi mx-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-red-400 mx-pulse shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Charts + jobs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Issue type donut */}
          <div className="neo-card p-5 mx-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Wrench size={14} className="text-rose-400" /> Issues by Type
            </h3>
            {byIssueType.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No issue data yet.</p>
              : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={byIssueType} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={58} outerRadius={86}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      activeIndex={activeIdx} activeShape={ActivePieShape}
                      onMouseEnter={(_, i) => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {byIssueType.map(e => <Cell key={e.name} fill={ISSUE_COLORS[e.name] ?? '#9ca3af'} />)}
                      <Label content={<DonutCentre total={totalByType} label="jobs" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Active Jobs */}
          <div className="neo-card lg:col-span-2 mx-up" style={{ animationDelay: '140ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Wrench size={13} className="text-rose-400" /> Active Maintenance Jobs
              </h3>
              <span className="text-xs text-slate-400">{jobs.length} jobs</span>
            </div>
            <div className="divide-y neo-divider">
              {jobs.length === 0
                ? (
                  <div className="flex flex-col items-center py-10 gap-2">
                    <CheckCircle2 size={28} className="text-green-300" />
                    <p className="text-sm text-slate-400">All clear — no active maintenance jobs.</p>
                  </div>
                )
                : jobs.map((j, i) => {
                  const isOverdue = j.service_date && isPast(parseISO(j.service_date));
                  return (
                    <div key={j.maintenance_id}
                      className={`px-5 py-3 flex items-start justify-between gap-4 transition-colors mx-row ${isOverdue ? 'bg-red-50/40 hover:bg-red-50/60' : 'neo-row'}`}
                      style={{ animationDelay: `${220 + i * 40}ms` }}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-medium text-slate-800 truncate">{j.issue}</p>
                          {isOverdue && (
                            <span className="shrink-0 text-xs text-red-600 font-semibold mx-pulse">⚠ Overdue</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {j.equipment_units?.equipment_types?.name ?? '—'}
                          {j.equipment_units?.capacity ? ` · ${j.equipment_units.capacity}` : ''}
                          {j.issue_type ? ` · ${j.issue_type}` : ''}
                        </p>
                        {j.service_date && (
                          <p className={`mt-0.5 text-xs flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                            <Calendar size={10} />
                            {format(parseISO(j.service_date), 'dd MMM yyyy')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLS[j.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {j.status}
                        </span>
                        {j.issue_type && (
                          <span className="text-xs" style={{ color: ISSUE_COLORS[j.issue_type] ?? '#9ca3af' }}>
                            {j.issue_type}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
