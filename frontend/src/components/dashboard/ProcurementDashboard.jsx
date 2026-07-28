import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart, Clock, FileText, Building2, DollarSign, AlertTriangle,
  RefreshCw, Calendar, Truck,
} from 'lucide-react';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import {
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, Label,
} from 'recharts';
import { format, differenceInDays, parseISO } from 'date-fns';
import { SkeletonDashboard } from '../common/Skeleton';
import { useAuth } from '../../context/AuthContext';
import { fetchProcurementStats } from '../../api/dashboard';
import { ActivePieShape, Bar3D, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const PROC_COLORS = {
  'Draft':             '#94a3b8',
  'Pending Approval':  '#fbbf24',
  'Approved':          '#60a5fa',
  'Rejected':          '#f87171',
  'PO Issued':         '#a78bfa',
  'Delivered':         '#22d3ee',
  'Received':          '#34d399',
  'Cancelled':         '#cbd5e1',
};
const PO_COLORS = {
  'Draft':               '#94a3b8',
  'Submitted':           '#fbbf24',
  'Acknowledged':        '#60a5fa',
  'Partially Delivered': '#a78bfa',
  'Delivered':           '#34d399',
};
const PROC_STATUS_CLS = {
  'Draft':            'bg-slate-100 text-slate-600',
  'Pending Approval': 'bg-amber-100 text-amber-700',
  'Approved':         'bg-blue-100 text-blue-700',
  'Rejected':         'bg-red-100 text-red-700',
  'PO Issued':        'bg-violet-100 text-violet-700',
  'Delivered':        'bg-cyan-100 text-cyan-700',
  'Received':         'bg-green-100 text-green-700',
  'Cancelled':        'bg-gray-100 text-gray-400',
};
const PO_STATUS_CLS = {
  'Draft':               'bg-slate-100 text-slate-600',
  'Submitted':           'bg-amber-100 text-amber-700',
  'Acknowledged':        'bg-blue-100 text-blue-700',
  'Partially Delivered': 'bg-violet-100 text-violet-700',
  'Delivered':           'bg-green-100 text-green-700',
};

const TABLES = ['procurements','purchase_orders','vendors'];

export default function ProcurementDashboard() {
  const { profile } = useAuth();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeIdx,  setActiveIdx]  = useState(null);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today    = new Date().toISOString().split('T')[0];

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else        setLoading(true);
    setError(null);
    try {
      setData(await fetchProcurementStats());
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

  if (loading) return <SkeletonDashboard statCount={4} />;

  if (error) return (
    <div className="neo-card p-10 text-center pm-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, procByStatus, poByStatus, recentProcurements, upcomingPOs } = data;
  const totalProcCount = procByStatus.reduce((s, p) => s + p.value, 0);

  const kpiCards = [
    { label: 'Total Requests',   value: stats.totalProcurements, Icon: ShoppingCart,  iconCls: 'text-indigo-500', delay: '0ms'   },
    { label: 'Pending Approval', value: stats.pendingApproval,   Icon: Clock,         iconCls: 'text-amber-500',  pulse: stats.pendingApproval > 0,  delay: '55ms'  },
    { label: 'Active POs',       value: stats.activePOs,         Icon: FileText,      iconCls: 'text-blue-500',   delay: '110ms' },
    { label: 'Active Vendors',   value: stats.totalVendors,      Icon: Building2,     iconCls: 'text-teal-500',   delay: '165ms' },
    {
      label: 'Budget Committed',
      value: `${Number(stats.totalBudget).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD`,
      Icon: DollarSign, iconCls: 'text-purple-500', small: true, delay: '220ms',
    },
    { label: 'Overdue Deliveries', value: stats.overdueDeliveries, Icon: AlertTriangle, iconCls: 'text-red-500', pulse: stats.overdueDeliveries > 0, urgent: stats.overdueDeliveries > 0, delay: '275ms' },
  ];

  return (
    <>
      <style>{`
        @keyframes pmFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes pmSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes pmPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes pmPulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .pm-fade  { animation: pmFadeIn  0.28s ease both }
        .pm-up    { animation: pmSlideUp 0.3s cubic-bezier(0.34,1.56,0.64,1) both }
        .pm-pop   { animation: pmPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .pm-pulse { animation: pmPulse   1.9s ease-in-out infinite }
        .pm-row   { animation: pmFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 pm-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-700 via-primary-600 to-gray-900 p-6 text-white shadow-lg pm-up">
          <div className="absolute -top-12 -right-12 w-56 h-56 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-white/70 text-sm">{greeting},</p>
              <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Procurement Manager'}</h1>
              <p className="text-white/70 text-sm mt-1">
                {format(new Date(), 'EEEE, dd MMMM yyyy')} · Procurement Control Center
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats.pendingApproval > 0 && (
                <div className="bg-amber-400/25 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center pm-pop" style={{ animationDelay: '200ms' }}>
                  <p className="text-2xl font-bold leading-none">{stats.pendingApproval}</p>
                  <p className="text-amber-100 text-xs mt-1">Awaiting Approval</p>
                </div>
              )}
              {stats.overdueDeliveries > 0 && (
                <div className="bg-black/30 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center pm-pop pm-pulse" style={{ animationDelay: '270ms' }}>
                  <p className="text-2xl font-bold leading-none">{stats.overdueDeliveries}</p>
                  <p className="text-white/80 text-xs mt-1">Overdue POs</p>
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
          {kpiCards.map(({ label, value, Icon, iconCls, pulse, urgent, small, delay }) => (
            <div key={label}
              className={`neo-kpi pm-pop p-4 ${urgent ? 'outline outline-2 outline-red-300/60' : ''}`}
              style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && (
                  <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${urgent ? 'bg-red-400' : 'bg-amber-400'} pm-pulse`} />
                )}
              </div>
              <p className={`font-bold text-slate-800 leading-tight ${small ? 'text-sm' : 'text-2xl'}`}>{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Donut — Requests by Status */}
          <div className="neo-card p-5 pm-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <ShoppingCart size={14} className="text-indigo-400" /> Procurement Requests by Status
            </h3>
            {procByStatus.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No procurement data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  {PIE_FILTER_DEF}
                  <Pie
                    data={procByStatus} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={62} outerRadius={92}
                    paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                    activeIndex={activeIdx} activeShape={ActivePieShape}
                    onMouseEnter={(_, i) => setActiveIdx(i)}
                    onMouseLeave={() => setActiveIdx(null)}
                    isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                    style={PIE_STYLE}
                  >
                    {procByStatus.map(entry => (
                      <Cell key={entry.name} fill={PROC_COLORS[entry.name] ?? '#94a3b8'} />
                    ))}
                    <Label content={<DonutCentre total={totalProcCount} label="total" />} position="center" />
                  </Pie>
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} formatter={(v, n) => [v, n]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Horizontal Bar — PO Pipeline */}
          <div className="neo-card p-5 pm-up" style={{ animationDelay: '140ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <FileText size={14} className="text-blue-400" /> Purchase Order Pipeline
            </h3>
            {poByStatus.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No purchase orders yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={poByStatus} layout="vertical" margin={{ left: 12, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                  <Bar dataKey="value" shape={Bar3D}
                    isAnimationActive animationDuration={900} animationEasing="ease-out">
                    {poByStatus.map(entry => (
                      <Cell key={entry.name} fill={PO_COLORS[entry.name] ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Activity columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Recent Procurement Requests */}
          <div className="neo-card pm-up" style={{ animationDelay: '180ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ShoppingCart size={13} className="text-indigo-400" /> Recent Requests
              </h3>
              <span className="text-xs text-slate-400">{recentProcurements.length} records</span>
            </div>
            <div className="divide-y neo-divider">
              {recentProcurements.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">No requests yet.</p>
              ) : recentProcurements.map((p, i) => (
                <div key={p.procurement_id}
                  className="px-5 py-3 flex items-start justify-between gap-3 neo-row transition-colors pm-row"
                  style={{ animationDelay: `${230 + i * 45}ms` }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <p className="text-sm font-medium text-slate-800 truncate">{p.title}</p>
                      {p.priority === 'Urgent' && (
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded border bg-red-50 text-red-600 border-red-200 pm-pulse">⚡ Urgent</span>
                      )}
                      {p.priority === 'High' && (
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded border bg-orange-50 text-orange-600 border-orange-200">High</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {p.vendors?.name ?? 'No vendor'} · {p.type} · {format(new Date(p.created_at), 'dd MMM yyyy')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PROC_STATUS_CLS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                    {p.total_amount_kwd != null && (
                      <span className="text-xs font-mono text-slate-500">
                        {Number(p.total_amount_kwd).toLocaleString(undefined, { minimumFractionDigits: 3 })} KWD
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Purchase Orders */}
          <div className="neo-card pm-up" style={{ animationDelay: '220ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Truck size={13} className="text-blue-400" /> Active Purchase Orders
              </h3>
              <span className="text-xs text-slate-400">{upcomingPOs.length} records</span>
            </div>
            <div className="divide-y neo-divider">
              {upcomingPOs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">No active purchase orders.</p>
              ) : upcomingPOs.map((po, i) => {
                const isOverdue = po.expected_delivery && po.expected_delivery < today;
                const daysLeft  = po.expected_delivery
                  ? differenceInDays(parseISO(po.expected_delivery), new Date())
                  : null;
                return (
                  <div key={po.po_id}
                    className={`px-5 py-3 flex items-start justify-between gap-3 transition-colors pm-row ${isOverdue ? 'bg-red-50/40 hover:bg-red-50/60' : 'neo-row'}`}
                    style={{ animationDelay: `${270 + i * 45}ms` }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <p className="text-sm font-medium text-slate-800">{po.po_number}</p>
                        {isOverdue && (
                          <span className="shrink-0 text-xs text-red-600 font-semibold pm-pulse">⚠ Overdue</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate">
                        {po.vendors?.name ?? '—'} · {po.procurements?.title ?? '—'}
                      </p>
                      {po.expected_delivery && (
                        <p className={`mt-0.5 text-xs flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : daysLeft !== null && daysLeft <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>
                          <Calendar size={9} />
                          {format(parseISO(po.expected_delivery), 'dd MMM yyyy')}
                          {daysLeft !== null && (
                            <span className="ml-1">
                              {isOverdue
                                ? `· ${Math.abs(daysLeft)}d overdue`
                                : daysLeft === 0 ? '· due today'
                                : `· ${daysLeft}d left`}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PO_STATUS_CLS[po.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {po.status}
                      </span>
                      {po.total_amount_kwd != null && (
                        <span className="text-xs font-mono text-slate-500">
                          {Number(po.total_amount_kwd).toLocaleString(undefined, { minimumFractionDigits: 3 })} KWD
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
