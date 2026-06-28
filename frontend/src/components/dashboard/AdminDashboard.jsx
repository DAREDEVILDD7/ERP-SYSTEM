import { useEffect, useState, useCallback } from 'react';
import { fetchAdminStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { SkeletonDashboard } from '../common/Skeleton';
import StatusBadge from '../common/StatusBadge';
import {
  Package, ClipboardList, FileText, Truck, DollarSign,
  RefreshCw, AlertTriangle, ShieldCheck, TrendingUp,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, Label,
} from 'recharts';
import { format } from 'date-fns';
import { ActivePieShape, Bar3D, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const EQ_COLORS  = { Available: '#34d399', Reserved: '#fbbf24', Dispatched: '#60a5fa', Maintenance: '#f87171', Retired: '#94a3b8', Locked: '#c084fc' };
const REQ_COLORS = ['#818cf8','#fbbf24','#a78bfa','#34d399','#f87171','#94a3b8','#fb923c'];
const TABLES     = ['equipment_units','requirements','quotations','dispatches','maintenance'];

export default function AdminDashboard() {
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
      setData(await fetchAdminStats());
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
    <div className="neo-card p-10 text-center ad-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, recentRequirements, equipmentByStatus, requirementsByStatus } = data;
  const totalEq = equipmentByStatus.reduce((s, e) => s + e.value, 0);

  const kpiCards = [
    { label: 'Total Equipment',    value: stats.totalEquipment,                Icon: Package,       iconCls: 'text-blue-500',   delay: '0ms'   },
    { label: 'Available',          value: stats.availableEquipment,            Icon: Package,       iconCls: 'text-green-500',  delay: '55ms'  },
    { label: 'Active Requirements',value: stats.activeRequirements,            Icon: ClipboardList, iconCls: 'text-yellow-500', delay: '110ms', pulse: stats.activeRequirements > 0 },
    { label: 'Open Quotations',    value: stats.openQuotations,                Icon: FileText,      iconCls: 'text-purple-500', delay: '165ms' },
    { label: 'Pending Dispatches', value: stats.pendingDispatches,             Icon: Truck,         iconCls: 'text-indigo-500', delay: '220ms' },
    { label: 'Revenue (KWD)',      value: stats.totalRevenue.toLocaleString(), Icon: DollarSign,    iconCls: 'text-emerald-500',delay: '275ms', sub: 'Approved quotations' },
  ];

  return (
    <>
      <style>{`
        @keyframes adFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes adSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes adPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes adPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes adGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0)} 50%{box-shadow:0 0 0 8px rgba(59,130,246,0.15)} }
        .ad-fade { animation: adFadeIn  0.28s ease both }
        .ad-up   { animation: adSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .ad-pop  { animation: adPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .ad-pulse{ animation: adPulse   1.8s ease-in-out infinite }
        .ad-glow { animation: adGlow    2.4s ease-in-out infinite }
        .ad-row  { animation: adFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 ad-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-slate-600 p-6 text-white shadow-lg ad-up">
          <div className="absolute -top-14 -right-14 w-64 h-64 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute top-6 right-36 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center ad-glow">
                <ShieldCheck size={22} className="text-white" />
              </div>
              <div>
                <p className="text-blue-200 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Admin'}</h1>
                <p className="text-blue-200 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · System Command Center
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center ad-pop" style={{ animationDelay: '180ms' }}>
                <div className="flex items-center gap-1.5 justify-center">
                  <TrendingUp size={13} className="text-green-300" />
                  <p className="text-xl font-bold leading-none">{stats.totalRevenue.toLocaleString()}</p>
                </div>
                <p className="text-blue-200 text-xs mt-1">KWD Revenue</p>
              </div>
              {stats.openMaintenance > 0 && (
                <div className="bg-amber-400/25 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center ad-pop ad-pulse" style={{ animationDelay: '240ms' }}>
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

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpiCards.map(({ label, value, Icon, iconCls, delay, pulse, sub }) => (
            <div key={label} className="neo-kpi ad-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-yellow-400 ad-pulse shrink-0" />}
              </div>
              <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
              {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Equipment donut */}
          <div className="neo-card p-5 ad-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Package size={14} className="text-blue-400" /> Equipment by Status
            </h3>
            {equipmentByStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No equipment data.</p>
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={equipmentByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      activeIndex={activeIdx} activeShape={ActivePieShape}
                      onMouseEnter={(_, i) => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {equipmentByStatus.map(e => <Cell key={e.name} fill={EQ_COLORS[e.name] ?? '#9ca3af'} />)}
                      <Label content={<DonutCentre total={totalEq} label="units" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Requirements bar */}
          <div className="neo-card p-5 ad-up" style={{ animationDelay: '140ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <ClipboardList size={14} className="text-purple-400" /> Requirements by Status
            </h3>
            {requirementsByStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No requirement data.</p>
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={requirementsByStatus} layout="vertical" margin={{ left: 20, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Bar dataKey="value" shape={Bar3D}
                      isAnimationActive animationDuration={900} animationEasing="ease-out">
                      {requirementsByStatus.map((_, i) => <Cell key={i} fill={REQ_COLORS[i % REQ_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
          </div>
        </div>

        {/* Recent Requirements */}
        <div className="neo-card ad-up" style={{ animationDelay: '200ms' }}>
          <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <ClipboardList size={13} className="text-blue-400" /> Recent Requirements
            </h3>
            <span className="text-xs text-slate-400">{recentRequirements.length} shown</span>
          </div>
          <div className="divide-y neo-divider">
            {recentRequirements.length === 0
              ? <p className="text-sm text-slate-400 text-center py-10">No requirements yet.</p>
              : recentRequirements.map((r, i) => (
                <div key={r.requirement_id}
                  className="px-5 py-3 flex items-center justify-between gap-4 neo-row transition-colors ad-row"
                  style={{ animationDelay: `${260 + i * 40}ms` }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{r.requirement_summary}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{r.customers?.company_name} · {r.requirement_id}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-slate-400 hidden sm:block">
                      {format(new Date(r.created_at), 'dd MMM yyyy')}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>

      </div>
    </>
  );
}
