import { useEffect, useState, useCallback } from 'react';
import { fetchSalesStats } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { SkeletonDashboard } from '../common/Skeleton';
import StatusBadge from '../common/StatusBadge';
import {
  ClipboardList, FileText, Clock, Plus, DollarSign,
  TrendingUp, AlertTriangle, RefreshCw,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Label,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ActivePieShape, DonutCentre, NEO_TOOLTIP_STYLE, PIE_FILTER_DEF, PIE_STYLE } from './DashUtils';

const QUOT_COLORS = {
  Draft:     '#94a3b8',
  Sent:      '#60a5fa',
  Approved:  '#34d399',
  Rejected:  '#f87171',
  Cancelled: '#cbd5e1',
};
const TABLES = ['requirements','quotations','customers'];

export default function SalesDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeIdx,  setActiveIdx]  = useState(null);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const load = useCallback(async (silent = false) => {
    if (!profile?.user_id) return;
    if (silent) setRefreshing(true);
    else        setLoading(true);
    setError(null);
    try {
      setData(await fetchSalesStats(profile.user_id));
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => { load(); }, [load]);
  const realtimeLoad = useCallback(() => load(true), [load]);
  useRealtimeRefresh(TABLES, realtimeLoad);

  if (loading) return <SkeletonDashboard statCount={4} />;

  if (error && !data) return (
    <div className="neo-card p-10 text-center sa-fade">
      <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
      <p className="font-medium text-slate-700">Failed to load dashboard</p>
      <p className="text-sm text-slate-400 mt-1">{error}</p>
      <button onClick={() => load()}
        className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors">
        Try Again
      </button>
    </div>
  );

  if (!data) return null;

  const { stats, myRecentQuotations, myRecentRequirements, quotationsByStatus } = data;
  const totalQuots = quotationsByStatus.reduce((s, q) => s + q.value, 0);

  const kpiCards = [
    { label: 'My Requirements',   value: stats.myRequirements,  Icon: ClipboardList, iconCls: 'text-purple-500', delay: '0ms'   },
    { label: 'My Quotations',     value: stats.myQuotations,    Icon: FileText,      iconCls: 'text-indigo-500', delay: '55ms'  },
    { label: 'Awaiting Approval', value: stats.pendingApproval, Icon: Clock,         iconCls: 'text-amber-500',  delay: '110ms', pulse: stats.pendingApproval > 0 },
    {
      label: 'Revenue (KWD)',
      value: Number(stats.myRevenue).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
      Icon: DollarSign, iconCls: 'text-green-500', small: true, delay: '165ms', sub: 'Approved quotations',
    },
  ];

  return (
    <>
      <style>{`
        @keyframes saFadeIn  { from { opacity:0 }                             to { opacity:1 } }
        @keyframes saSlideUp { from { opacity:0;transform:translateY(14px) }  to { opacity:1;transform:none } }
        @keyframes saPop     { 0%{transform:scale(0.88);opacity:0} 60%{transform:scale(1.04)} 100%{transform:scale(1);opacity:1} }
        @keyframes saPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes saGlow    { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0)} 50%{box-shadow:0 0 0 8px rgba(139,92,246,0.18)} }
        .sa-fade { animation: saFadeIn  0.28s ease both }
        .sa-up   { animation: saSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .sa-pop  { animation: saPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
        .sa-pulse{ animation: saPulse   1.8s ease-in-out infinite }
        .sa-glow { animation: saGlow    2.4s ease-in-out infinite }
        .sa-row  { animation: saFadeIn  0.22s ease both }
      `}</style>

      <div className="space-y-6 sa-fade">

        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-700 via-primary-600 to-gray-900 p-6 text-white shadow-lg sa-up">
          <div className="absolute -top-14 -right-14 w-60 h-60 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute top-4 right-32 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-10 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center sa-glow">
                <TrendingUp size={22} className="text-white" />
              </div>
              <div>
                <p className="text-white/70 text-sm">{greeting},</p>
                <h1 className="text-2xl font-bold mt-0.5">{profile?.name ?? 'Sales Executive'}</h1>
                <p className="text-white/70 text-sm mt-0.5">
                  {format(new Date(), 'EEEE, dd MMMM yyyy')} · Sales Hub
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stats.pendingApproval > 0 && (
                <div className="bg-amber-400/25 backdrop-blur-sm rounded-xl px-4 py-2.5 text-center sa-pop sa-pulse" style={{ animationDelay: '180ms' }}>
                  <p className="text-xl font-bold leading-none">{stats.pendingApproval}</p>
                  <p className="text-amber-100 text-xs mt-1">Awaiting Approval</p>
                </div>
              )}
              <button onClick={() => navigate('/requirements')}
                className="bg-white text-primary-700 font-semibold rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm hover:bg-primary-50 transition-colors sa-pop"
                style={{ animationDelay: '230ms' }}>
                <Plus size={14} /> New Requirement
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
          {kpiCards.map(({ label, value, Icon, iconCls, delay, pulse, small, sub }) => (
            <div key={label} className="neo-kpi sa-pop p-4" style={{ animationDelay: delay }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
                  <Icon size={16} className={iconCls} />
                </div>
                {pulse && <span className="mt-1 w-2.5 h-2.5 rounded-full bg-amber-400 sa-pulse shrink-0" />}
              </div>
              <p className={`font-bold text-slate-800 leading-tight ${small ? 'text-base' : 'text-2xl'}`}>{value}</p>
              <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
              {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Charts + feeds */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Quotations donut */}
          <div className="neo-card p-5 sa-up" style={{ animationDelay: '80ms' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <FileText size={14} className="text-violet-400" /> Quotations by Status
            </h3>
            {quotationsByStatus.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">No quotations yet.</p>
              : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    {PIE_FILTER_DEF}
                    <Pie data={quotationsByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={56} outerRadius={84}
                      paddingAngle={5} stroke="white" strokeWidth={3} labelLine={false}
                      activeIndex={activeIdx} activeShape={ActivePieShape}
                      onMouseEnter={(_, i) => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(null)}
                      isAnimationActive animationBegin={0} animationDuration={900} animationEasing="ease-out"
                      style={PIE_STYLE}>
                      {quotationsByStatus.map(e => <Cell key={e.name} fill={QUOT_COLORS[e.name] ?? '#94a3b8'} />)}
                      <Label content={<DonutCentre total={totalQuots} label="total" />} position="center" />
                    </Pie>
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </div>

          {/* Recent Requirements */}
          <div className="neo-card sa-up" style={{ animationDelay: '120ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ClipboardList size={13} className="text-purple-400" /> My Requirements
              </h3>
              <button onClick={() => navigate('/requirements')} className="text-xs text-purple-500 hover:underline">View all</button>
            </div>
            <div className="divide-y neo-divider">
              {myRecentRequirements.length === 0
                ? <p className="text-sm text-slate-400 text-center py-10">No requirements yet.</p>
                : myRecentRequirements.map((r, i) => (
                  <div key={r.requirement_id}
                    className="px-5 py-3 flex items-center justify-between gap-3 neo-row transition-colors sa-row"
                    style={{ animationDelay: `${200 + i * 40}ms` }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{r.requirement_summary}</p>
                      <p className="text-xs text-slate-400">{r.customers?.company_name}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
            </div>
          </div>

          {/* Recent Quotations */}
          <div className="neo-card sa-up" style={{ animationDelay: '160ms' }}>
            <div className="px-5 py-4 border-b neo-divider flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <FileText size={13} className="text-indigo-400" /> My Quotations
              </h3>
              <button onClick={() => navigate('/quotations')} className="text-xs text-purple-500 hover:underline">View all</button>
            </div>
            <div className="divide-y neo-divider">
              {myRecentQuotations.length === 0
                ? <p className="text-sm text-slate-400 text-center py-10">No quotations yet.</p>
                : myRecentQuotations.map((q, i) => (
                  <div key={q.quotation_id}
                    className="px-5 py-3 flex items-center justify-between gap-3 neo-row transition-colors sa-row"
                    style={{ animationDelay: `${240 + i * 40}ms` }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{q.customers?.company_name}</p>
                      <p className="text-xs text-slate-400">{format(new Date(q.quotation_date), 'dd MMM yyyy')}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={q.status} />
                      <span className="text-xs font-mono text-slate-500">
                        {Number(q.total_amount_kwd).toLocaleString(undefined, { minimumFractionDigits: 3 })} KWD
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
