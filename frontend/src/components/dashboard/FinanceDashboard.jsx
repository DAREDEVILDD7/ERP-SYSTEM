import { useEffect, useState, useCallback } from 'react';
import { fetchFinanceStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import LoadingSpinner from '../common/LoadingSpinner';
import StatusBadge from '../common/StatusBadge';
import {
  DollarSign, FileText, Clock,
  TrendingUp, AlertTriangle, RefreshCw, Landmark,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, Label,
} from 'recharts';
import { format } from 'date-fns';
import { Bar3D, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const INV_STATUS_COLORS = {
  Draft:     '#94a3b8',
  Sent:      '#60a5fa',
  Paid:      '#34d399',
  Overdue:   '#f87171',
  Cancelled: '#cbd5e1',
};
const TABLES = ['invoices','quotations'];

export default function FinanceDashboard() {
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
      setData(await fetchFinanceStats());
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
    <div className="neo-card p-10 text-center fi-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  const { stats, recentInvoices, invoiceByStatus } = data;
  const totalInvoices = invoiceByStatus.reduce((s, i) => s + i.value, 0);
  const collectionRate = stats.totalBilled > 0
    ? Math.round((stats.totalCollected / stats.totalBilled) * 100)
    : 0;

  const revenueBar = [
    { name: 'Billed',      value: stats.totalBilled    },
    { name: 'Collected',   value: stats.totalCollected },
    { name: 'Outstanding', value: stats.outstanding    },
  ];

  const kpiCards = [
    { label: 'Pending Invoices', value: stats.pendingInvoices, Icon: FileText,   iconCls: 'text-yellow-500', pulse: stats.pendingInvoices > 0, delay: '0ms'   },
    { label: 'Needs Approval',   value: stats.approvalNeeded,  Icon: Clock,      iconCls: 'text-red-500',    pulse: stats.approvalNeeded > 0,  delay: '55ms'  },
    {
      label: 'Total Billed (KWD)',
      value: stats.totalBilled.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
      Icon: TrendingUp, iconCls: 'text-blue-500', small: true, delay: '110ms',
    },
    {
      label: 'Collected (KWD)',
      value: stats.totalCollected.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
      Icon: DollarSign, iconCls: 'text-emerald-500', small: true, sub: `${collectionRate}% collection rate`, delay: '165ms',
    },
  ];

  return (
    <>
      <style>{`
        @keyframes fiFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes fiSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes fiPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes fiPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes fiGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0)} 50%{box-shadow:0 0 0 8px rgba(16,185,129,0.18)} }
        .fi-fade { animation: fiFadeIn  0.28s ease both }
        .fi-up   { animation: fiSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .fi-pop  { animation: fiPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .fi-pulse{ animation: fiPulse   1.8s ease-in-out infinite }
        .fi-glow { animation: fiGlow    2.4s ease-in-out infinite }
        .fi-row  { animation: fiFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 fi-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-700 via-green-600 to-teal-500 p-6 text-white shadow-lg fi-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center fi-glow">
                <Landmark size={22} className="text-white" />
              </div>
              <div>
                <p className="text-green-100 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Finance Officer'}</h1>
                <p className="text-green-100 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · Finance Center
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center fi-pop" style={{ animationDelay: '180ms' }}>
                <p className="text-xl font-bold leading-none">{collectionRate}%</p>
                <p className="text-green-100 text-xs mt-1">Collection Rate</p>
              </div>
              {stats.outstanding > 0 && (
                <div className="bg-red-500/30 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center fi-pop" style={{ animationDelay: '230ms' }}>
                  <p className="text-xl font-bold leading-none">
                    {stats.outstanding.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-red-100 text-xs mt-1">KWD Outstanding</p>
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
          {kpiCards.map(({ label, value, Icon, iconCls, delay, pulse, small, sub }) => (
            <div key={label} className="neo-kpi fi-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-red-400 fi-pulse shrink-0" />}
              </div>
              <p className={`font-bold text-slate-800 leading-tight ${small ? 'text-sm' : 'text-2xl'}`}>{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
              {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Charts + feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Invoice status donut */}
          <div className="neo-card p-5 fi-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <FileText size={14} className="text-emerald-400" /> Invoice Status
            </h3>
            {invoiceByStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No invoice data.</p>
              : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={invoiceByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={56} outerRadius={82}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {invoiceByStatus.map(e => <Cell key={e.name} fill={INV_STATUS_COLORS[e.name] ?? '#94a3b8'} />)}
                      <Label content={<DonutCentre total={totalInvoices} label="invoices" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Revenue bar */}
          <div className="neo-card p-5 fi-up" style={{ animationDelay: '120ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-green-400" /> Revenue Overview (KWD)
            </h3>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={revenueBar} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={NEO_TOOLTIP_STYLE}
                  formatter={v => [v.toLocaleString(undefined, { minimumFractionDigits: 3 }), 'KWD']}
                />
                <Bar dataKey="value" shape={Bar3D}
                  isAnimationActive animationDuration={900} animationEasing="ease-out">
                  <Cell fill="#34d399" />
                  <Cell fill="#2dd4bf" />
                  <Cell fill="#f87171" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Invoices */}
          <div className="neo-card fi-up" style={{ animationDelay: '160ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <DollarSign size={13} className="text-emerald-400" /> Recent Invoices
              </h3>
              <span className="text-xs text-slate-400">{recentInvoices.length} shown</span>
            </div>
            <div className="divide-y neo-divider">
              {recentInvoices.length === 0
                ? <p className="text-sm text-slate-400 text-center py-10">No invoices yet.</p>
                : recentInvoices.map((inv, i) => (
                  <div key={inv.invoice_id}
                    className="px-5 py-3 flex items-center justify-between gap-3 neo-row transition-colors fi-row"
                    style={{ animationDelay: `${230 + i * 40}ms` }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{inv.customers?.company_name}</p>
                      <p className="text-xs text-slate-400">{format(new Date(inv.issue_date), 'dd MMM yyyy')}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={inv.status} />
                      <span className="text-xs font-mono text-slate-500">
                        {Number(inv.total_amount_kwd).toLocaleString(undefined, { minimumFractionDigits: 3 })} KWD
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
