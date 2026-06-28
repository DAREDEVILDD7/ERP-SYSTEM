import { useEffect, useState, useCallback } from 'react';
import { fetchDispatchStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import LoadingSpinner from '../common/LoadingSpinner';
import StatusBadge from '../common/StatusBadge';
import {
  Truck, Clock, CheckCircle, UserCheck,
  AlertTriangle, RefreshCw, MapPin, Navigation,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Label,
} from 'recharts';
import { format } from 'date-fns';
import { DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const DISPATCH_STATUS_COLORS = {
  Pending:      '#fbbf24',
  Assigned:     '#60a5fa',
  'In Transit': '#818cf8',
  Completed:    '#34d399',
  Returned:     '#2dd4bf',
  Cancelled:    '#f87171',
};
const STATUS_ROW_CLS = {
  Pending:      'border-l-2 border-yellow-300',
  Assigned:     'border-l-2 border-blue-300',
  'In Transit': 'border-l-2 border-indigo-300',
};
const TABLES = ['dispatches','equipment_units'];

export default function DispatchDashboard() {
  const { profile } = useAuth();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else        setLoading(true);
    setError(null);
    try {
      setData(await fetchDispatchStats());
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

  if (loading) return <LoadingSpinner fullscreen={false} />;

  if (error && !data) return (
    <div className="neo-card p-10 text-center ds-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, activeDispatches, dispatchByStatus } = data;
  const totalDisp = dispatchByStatus.reduce((s, d) => s + d.value, 0);

  const kpiCards = [
    { label: 'Pending',        value: stats.pending,        Icon: Clock,       iconCls: 'text-yellow-500', pulse: stats.pending > 0, delay: '0ms'   },
    { label: 'Assigned',       value: stats.assigned,       Icon: UserCheck,   iconCls: 'text-blue-500',   delay: '55ms'  },
    { label: 'In Transit',     value: stats.inTransit,      Icon: Truck,       iconCls: 'text-indigo-500', delay: '110ms' },
    { label: 'Completed Today',value: stats.completedToday, Icon: CheckCircle, iconCls: 'text-green-500',  delay: '165ms' },
  ];

  return (
    <>
      <style>{`
        @keyframes dsFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes dsSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes dsPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes dsPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes dsGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0)} 50%{box-shadow:0 0 0 8px rgba(99,102,241,0.18)} }
        @keyframes dsDrive   { 0%{transform:translateX(-4px)} 100%{transform:translateX(4px)} }
        .ds-fade  { animation: dsFadeIn  0.28s ease both }
        .ds-up    { animation: dsSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .ds-pop   { animation: dsPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .ds-pulse { animation: dsPulse   1.8s ease-in-out infinite }
        .ds-glow  { animation: dsGlow    2.4s ease-in-out infinite }
        .ds-drive { animation: dsDrive   1.2s ease-in-out infinite alternate }
        .ds-row   { animation: dsFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 ds-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-600 to-violet-500 p-6 text-white shadow-lg ds-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center ds-glow">
                <Truck size={22} className="text-white ds-drive" />
              </div>
              <div>
                <p className="text-indigo-200 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Dispatch Coordinator'}</h1>
                <p className="text-indigo-200 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · Dispatch Control
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats.inTransit > 0 && (
                <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center ds-pop" style={{ animationDelay: '200ms' }}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-300 ds-pulse" />
                    <p className="text-xl font-bold leading-none">{stats.inTransit}</p>
                  </div>
                  <p className="text-indigo-200 text-xs mt-1">In Transit</p>
                </div>
              )}
              {stats.pending > 0 && (
                <div className="bg-amber-400/25 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center ds-pop ds-pulse" style={{ animationDelay: '250ms' }}>
                  <p className="text-xl font-bold leading-none">{stats.pending}</p>
                  <p className="text-amber-100 text-xs mt-1">Pending</p>
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map(({ label, value, Icon, iconCls, delay, pulse }) => (
            <div key={label} className="neo-kpi ds-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-indigo-400 ds-pulse shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Chart + Active Dispatches */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Status Donut */}
          <div className="neo-card p-5 ds-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Navigation size={14} className="text-indigo-400" /> Dispatch Status Distribution
            </h3>
            {dispatchByStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No dispatch data.</p>
              : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={dispatchByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={56} outerRadius={82}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {dispatchByStatus.map(e => <Cell key={e.name} fill={DISPATCH_STATUS_COLORS[e.name] ?? '#94a3b8'} />)}
                      <Label content={<DonutCentre total={totalDisp} label="total" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Active Dispatches */}
          <div className="neo-card lg:col-span-2 ds-up" style={{ animationDelay: '140ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Truck size={13} className="text-indigo-400" /> Active Dispatches
              </h3>
              <span className="text-xs text-slate-400">{activeDispatches.length} shown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b neo-divider text-xs text-slate-400 font-medium uppercase tracking-wide">
                    <th className="text-left px-5 py-3">Equipment</th>
                    <th className="text-left px-5 py-3">Driver</th>
                    <th className="text-left px-5 py-3 hidden md:table-cell">Destination</th>
                    <th className="text-left px-5 py-3 hidden sm:table-cell">Date</th>
                    <th className="text-left px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y neo-divider">
                  {activeDispatches.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-slate-400 text-sm">No active dispatches.</td>
                      </tr>
                    )
                    : activeDispatches.map((d, i) => (
                      <tr key={d.dispatch_id}
                        className={`neo-row transition-colors ds-row ${STATUS_ROW_CLS[d.status] ?? ''}`}
                        style={{ animationDelay: `${220 + i * 40}ms` }}>
                        <td className="px-5 py-3 text-slate-700 font-medium">
                          {d.equipment_units?.equipment_types?.name ?? '—'}
                          {d.equipment_units?.capacity ? ` · ${d.equipment_units.capacity}` : ''}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{d.driver_name ?? '—'}</td>
                        <td className="px-5 py-3 text-slate-600 hidden md:table-cell">
                          <span className="flex items-center gap-1">
                            <MapPin size={11} className="text-slate-400" />
                            {d.destination ?? '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500 hidden sm:table-cell">
                          {d.dispatch_date ? format(new Date(d.dispatch_date), 'dd MMM') : '—'}
                        </td>
                        <td className="px-5 py-3"><StatusBadge status={d.status} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
