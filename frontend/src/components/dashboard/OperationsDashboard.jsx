import { useEffect, useState, useCallback } from 'react';
import { fetchOperationsStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import LoadingSpinner from '../common/LoadingSpinner';
import StatusBadge from '../common/StatusBadge';
import {
  ClipboardList, Package, Truck, Wrench,
  Layers, AlertTriangle, RefreshCw,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, Label,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ActivePieShape, Bar3D, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const LOC_COLORS  = ['#2dd4bf','#60a5fa','#a78bfa','#fbbf24','#f87171','#22d3ee','#34d399','#fb923c'];
const REQ_STATUS_COLORS = {
  'Pending Review':    '#fbbf24',
  'Operations Review': '#60a5fa',
  'Approved':          '#34d399',
  'In Progress':       '#a78bfa',
  'Completed':         '#2dd4bf',
  'Rejected':          '#f87171',
  'Cancelled':         '#94a3b8',
};
const PRIORITY_CLS = {
  Urgent: 'bg-red-100 text-red-700',
  High:   'bg-orange-100 text-orange-700',
  Normal: 'bg-gray-100 text-gray-600',
  Low:    'bg-blue-100 text-blue-600',
};
const TABLES = ['requirements','equipment_units','dispatches','maintenance'];

export default function OperationsDashboard() {
  const { profile } = useAuth();
  const navigate    = useNavigate();
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
      setData(await fetchOperationsStats());
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
    <div className="neo-card p-10 text-center op-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, pendingRequirements, equipmentByLocation, requirementsByStatus } = data;
  const totalReqs = requirementsByStatus.reduce((s, r) => s + r.value, 0);

  const kpiCards = [
    { label: 'Needs Review',       value: stats.pendingReview,      Icon: ClipboardList, iconCls: 'text-yellow-500', pulse: stats.pendingReview > 0,      delay: '0ms'   },
    { label: 'Available Equipment',value: stats.availableEquipment, Icon: Package,       iconCls: 'text-green-500',  delay: '55ms'  },
    { label: 'Active Dispatches',  value: stats.activeDispatches,   Icon: Truck,         iconCls: 'text-blue-500',   delay: '110ms' },
    { label: 'Open Maintenance',   value: stats.openMaintenance,    Icon: Wrench,        iconCls: 'text-red-500',    pulse: stats.openMaintenance > 3, delay: '165ms' },
  ];

  return (
    <>
      <style>{`
        @keyframes opFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes opSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes opPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes opPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes opGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(20,184,166,0)} 50%{box-shadow:0 0 0 8px rgba(20,184,166,0.18)} }
        .op-fade { animation: opFadeIn  0.28s ease both }
        .op-up   { animation: opSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .op-pop  { animation: opPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .op-pulse{ animation: opPulse   1.8s ease-in-out infinite }
        .op-glow { animation: opGlow    2.4s ease-in-out infinite }
        .op-row  { animation: opFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 op-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-700 via-teal-600 to-cyan-500 p-6 text-white shadow-lg op-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute top-4 right-32 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-12 -left-8 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center op-glow">
                <Layers size={22} className="text-white" />
              </div>
              <div>
                <p className="text-teal-100 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Operations Manager'}</h1>
                <p className="text-teal-100 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · Operations Center
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats.pendingReview > 0 && (
                <div className="bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center op-pop op-pulse" style={{ animationDelay: '180ms' }}>
                  <p className="text-xl font-bold leading-none">{stats.pendingReview}</p>
                  <p className="text-teal-100 text-xs mt-1">Needs Review</p>
                </div>
              )}
              <button onClick={() => navigate('/requirements')}
                className="bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl px-4 py-2.5 text-sm font-medium transition-colors op-pop"
                style={{ animationDelay: '230ms' }}>
                Review Requirements
              </button>
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
            <div key={label} className="neo-kpi op-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-teal-400 op-pulse shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Equipment by Location */}
          <div className="neo-card p-5 op-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Package size={14} className="text-teal-400" /> Equipment by Location
            </h3>
            {equipmentByLocation.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No location data available.</p>
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={equipmentByLocation} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Bar dataKey="value" shape={Bar3D}
                      isAnimationActive animationDuration={900} animationEasing="ease-out">
                      {equipmentByLocation.map((_, i) => <Cell key={i} fill={LOC_COLORS[i % LOC_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Requirements donut */}
          <div className="neo-card p-5 op-up" style={{ animationDelay: '140ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <ClipboardList size={14} className="text-cyan-400" /> Requirements by Status
            </h3>
            {requirementsByStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No requirement data.</p>
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={requirementsByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={58} outerRadius={86}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      activeIndex={activeIdx} activeShape={ActivePieShape}
                      onMouseEnter={(_, i) => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {requirementsByStatus.map(e => <Cell key={e.name} fill={REQ_STATUS_COLORS[e.name] ?? '#94a3b8'} />)}
                      <Label content={<DonutCentre total={totalReqs} label="reqs" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>
        </div>

        {/* Pending Requirements */}
        <div className="neo-card op-up" style={{ animationDelay: '200ms' }}>
          <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <ClipboardList size={13} className="text-teal-400" /> Pending Review
            </h3>
            <button onClick={() => navigate('/requirements')} className="text-xs text-teal-600 hover:underline">Review all</button>
          </div>
          <div className="divide-y neo-divider">
            {pendingRequirements.length === 0
              ? (
                <div className="flex flex-col items-center py-10 gap-2">
                  <Package size={28} className="text-green-300" />
                  <p className="text-sm text-slate-400">All clear — no pending requirements.</p>
                </div>
              )
              : pendingRequirements.map((r, i) => (
                <div key={r.requirement_id}
                  className="px-5 py-3 flex items-center justify-between gap-3 neo-row transition-colors op-row"
                  style={{ animationDelay: `${260 + i * 40}ms` }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{r.requirement_summary}</p>
                    <p className="text-xs text-slate-400">{r.customers?.company_name} · {r.requirement_id}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.priority && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_CLS[r.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                        {r.priority}
                      </span>
                    )}
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
          </div>
        </div>

      </div>
    </>
  );
}
