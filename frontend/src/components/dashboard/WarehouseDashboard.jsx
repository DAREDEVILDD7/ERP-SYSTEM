import { useEffect, useState, useCallback } from 'react';
import { fetchWarehouseStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { SkeletonDashboard } from '../common/Skeleton';
import {
  Package, CheckCircle, Wrench, Truck, Archive,
  AlertTriangle, RefreshCw, BarChart2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, Label,
} from 'recharts';
import { format } from 'date-fns';
import { ActivePieShape, Bar3D, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const TYPE_COLORS = ['#fbbf24','#fb923c','#f87171','#a78bfa','#60a5fa','#2dd4bf','#34d399','#22d3ee'];
const STATUS_COLORS = {
  Available:   '#34d399',
  Reserved:    '#fbbf24',
  Dispatched:  '#60a5fa',
  Maintenance: '#f87171',
  Retired:     '#94a3b8',
  Locked:      '#c084fc',
};
const TABLES = ['equipment_units','equipment_types','maintenance'];

export default function WarehouseDashboard() {
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
      setData(await fetchWarehouseStats());
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
    <div className="neo-card p-10 text-center wh-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, byType, byStatus } = data;
  const totalUnits = byStatus.reduce((s, e) => s + e.value, 0);

  const utilisation = stats.total > 0
    ? Math.round(((stats.total - stats.available - stats.maintenance) / stats.total) * 100)
    : 0;

  const kpiCards = [
    { label: 'Total Units',    value: stats.total,       Icon: Package,      iconCls: 'text-amber-500', delay: '0ms'   },
    { label: 'Available',      value: stats.available,   Icon: CheckCircle,  iconCls: 'text-green-500', delay: '55ms'  },
    { label: 'Dispatched',     value: stats.dispatched,  Icon: Truck,        iconCls: 'text-blue-500',  delay: '110ms' },
    { label: 'In Maintenance', value: stats.maintenance, Icon: Wrench,       iconCls: 'text-red-500',   pulse: stats.maintenance > 0, delay: '165ms' },
  ];

  return (
    <>
      <style>{`
        @keyframes whFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes whSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes whPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes whPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes whGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0)} 50%{box-shadow:0 0 0 8px rgba(245,158,11,0.2)} }
        .wh-fade { animation: whFadeIn  0.28s ease both }
        .wh-up   { animation: whSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .wh-pop  { animation: whPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .wh-pulse{ animation: whPulse   1.8s ease-in-out infinite }
        .wh-glow { animation: whGlow    2.4s ease-in-out infinite }
      `}</style>

      <div className="space-y-6 wh-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-700 via-primary-600 to-gray-900 p-6 text-white shadow-lg wh-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center wh-glow">
                <Archive size={22} className="text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Warehouse Operator'}</h1>
                <p className="text-white/70 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · Inventory Hub
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center wh-pop" style={{ animationDelay: '180ms' }}>
                <p className="text-xl font-bold leading-none">{utilisation}%</p>
                <p className="text-white/70 text-xs mt-1">Fleet Utilisation</p>
              </div>
              <div className="bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center wh-pop" style={{ animationDelay: '230ms' }}>
                <p className="text-xl font-bold leading-none">{stats.reserved}</p>
                <p className="text-white/70 text-xs mt-1">Reserved</p>
              </div>
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
            <div key={label} className="neo-kpi wh-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-red-400 wh-pulse shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Equipment by Type — horizontal bar */}
          <div className="neo-card p-5 wh-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <BarChart2 size={14} className="text-amber-400" /> Equipment Count by Type
            </h3>
            {byType.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No equipment type data.</p>
              : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byType} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Bar dataKey="value" shape={Bar3D}
                      isAnimationActive animationDuration={900} animationEasing="ease-out">
                      {byType.map((_, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Equipment by Status — donut */}
          <div className="neo-card p-5 wh-up" style={{ animationDelay: '140ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Package size={14} className="text-orange-400" /> Fleet Status Overview
            </h3>
            {byStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No status data.</p>
              : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={byStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={70} outerRadius={105}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      activeIndex={activeIdx} activeShape={ActivePieShape}
                      onMouseEnter={(_, i) => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      isAnimationActive animationBegin={0} animationDuration={1000} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {byStatus.map(e => <Cell key={e.name} fill={STATUS_COLORS[e.name] ?? '#94a3b8'} />)}
                      <Label content={<DonutCentre total={totalUnits} label="units" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>
        </div>

      </div>
    </>
  );
}
