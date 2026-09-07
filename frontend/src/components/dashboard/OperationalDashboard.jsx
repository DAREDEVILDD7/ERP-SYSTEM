// ═════════════════════════════════════════════════════════════════════════
// Operational Dashboard — the default landing view for Super Admin.
//
// Three things the existing snapshot dashboard cannot show:
//   1. The chain over time — Quotes → Orders → Dispatch → Delivery →
//      Returns as six daily series with the conversion between each stage.
//   2. A 30 / 60 / 90-day forecast on any of those series, drawn past the
//      last day of real data so the projection is visibly a projection.
//   3. Record-level anomalies (KWD 0 quotes first) with the reason spelled
//      out, rather than a number quietly bent out of shape by them.
//
// The existing AdminDashboard renders underneath unchanged — it remains the
// fleet/status snapshot, and nothing here duplicates it.
//
// Every panel degrades on its own: a failed fetch, an empty window, a
// series too short to forecast and a malformed row all render a stated
// message instead of taking the page down.
// ═════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, FileText, PackageCheck,
  RefreshCw, RotateCcw, ShoppingCart, TrendingUp, Truck,
} from 'lucide-react';
import { getOperationalOverview } from '../../api/operations';
import { mergeForChart } from '../../lib/forecast';
import { SkeletonDashboard } from '../common/Skeleton';
import { NEO_TOOLTIP_STYLE } from './DashUtils';
import AdminDashboard from './AdminDashboard';

const HORIZONS = [30, 60, 90];

// Which series the trend chart can plot. `integer: false` on a currency
// series keeps the axis from pretending KWD comes in whole units only.
const METRICS = [
  { key: 'quotes',     label: 'Quotes',      colour: '#6366f1', unit: 'quotes'    },
  { key: 'quoteValue', label: 'Quote value', colour: '#0ea5e9', unit: 'KWD', money: true },
  { key: 'orders',     label: 'Orders',      colour: '#10b981', unit: 'orders'    },
  { key: 'dispatches', label: 'Dispatches',  colour: '#f59e0b', unit: 'dispatches' },
  { key: 'deliveries', label: 'Deliveries',  colour: '#8b5cf6', unit: 'deliveries' },
  { key: 'returns',    label: 'Returns',     colour: '#ef4444', unit: 'returns'   },
];

const SEVERITY_STYLE = {
  critical: { dot: 'bg-red-500',   chip: 'bg-red-50 text-red-600 border-red-100' },
  warning:  { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600 border-amber-100' },
  info:     { dot: 'bg-sky-500',   chip: 'bg-sky-50 text-sky-600 border-sky-100' },
};

const nf = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString() : '—');
const pf = (n) => (Number.isFinite(Number(n)) ? `${Number(n).toFixed(1)}%` : '—');
const shortDate = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(5) : '');

function DeltaChip({ pct }) {
  if (!Number.isFinite(Number(pct))) {
    return <span className="text-[11px] text-slate-400">no prior period</span>;
  }
  const v = Number(pct);
  const up = v >= 0;
  return (
    <span className={`text-[11px] font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '▲' : '▼'} {Math.abs(v)}% <span className="text-slate-400 font-normal">vs prev 30d</span>
    </span>
  );
}

function Kpi({ Icon, iconCls, label, value, sub, delta, delay }) {
  return (
    <div className="neo-kpi p-4 op-pop" style={{ animationDelay: delay }}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
          <Icon size={16} className={iconCls} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800 leading-tight break-words">{value}</p>
      <p className="text-xs text-slate-600 font-medium mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      <div className="mt-1"><DeltaChip pct={delta} /></div>
    </div>
  );
}

// One stage of the pipeline strip. The arrow between stages carries the
// conversion, which is the only place the chain is actually legible.
function Stage({ Icon, label, value, colour }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-9 h-9 neo-inset flex items-center justify-center shrink-0">
        <Icon size={15} style={{ color: colour }} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-slate-800 leading-none">{nf(value)}</p>
        <p className="text-[11px] text-slate-500 truncate">{label}</p>
      </div>
    </div>
  );
}

function Conversion({ pct }) {
  return (
    <div className="flex flex-col items-center px-1 shrink-0">
      <ArrowRight size={14} className="text-slate-300" />
      <span className="text-[10px] font-semibold text-slate-500 mt-0.5 whitespace-nowrap">{pf(pct)}</span>
    </div>
  );
}

function Panel({ title, icon: Icon, iconCls, right, children, delay }) {
  return (
    <div className="neo-card p-5 op-up" style={{ animationDelay: delay }}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          {Icon && <Icon size={14} className={iconCls} />} {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function OperationalDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [metricKey, setMetricKey] = useState('quotes');
  const [horizon, setHorizon] = useState(30);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await getOperationalOverview({ days: 180, horizons: HORIZONS });
      setData(result);
    } catch (err) {
      // getOperationalOverview swallows per-query failures, so reaching here
      // means something structural (no client, no network at all).
      setError(err?.message || 'Failed to load operational data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const metric = METRICS.find(m => m.key === metricKey) ?? METRICS[0];
  const forecast = data?.forecasts?.[metric.key] ?? null;

  // The chart shows 90 days of history plus the selected horizon, so the
  // projection never overwhelms the actuals it was fitted on.
  const chartRows = useMemo(() => {
    if (!data?.series?.[metric.key]) return [];
    const trimmed = forecast?.ok
      ? { ...forecast, points: forecast.points.slice(0, horizon) }
      : forecast;
    return mergeForChart(data.series[metric.key], trimmed, { tailDays: 90 });
  }, [data, metric.key, forecast, horizon]);

  if (loading) return <SkeletonDashboard statCount={4} />;

  if (error && !data) {
    return (
      <div className="neo-card p-10 text-center">
        <AlertTriangle size={36} className="mx-auto text-amber-400 mb-3" />
        <p className="font-medium text-slate-700">Failed to load the Operational Dashboard</p>
        <p className="text-sm text-slate-400 mt-1">{error}</p>
        <button onClick={() => load()}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
          Try Again
        </button>
      </div>
    );
  }

  const kpis = data?.kpis ?? {};
  const anomalies = data?.anomalies ?? [];
  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const zeroCount = anomalies.filter(a => a.code === 'zero_value').length;
  const meta = data?.meta ?? {};

  return (
    <>
      <style>{`
        @keyframes opFadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes opSlideUp { from { opacity:0;transform:translateY(12px) } to { opacity:1;transform:none } }
        @keyframes opPop     { 0%{transform:scale(0.9);opacity:0} 60%{transform:scale(1.03)} 100%{transform:scale(1);opacity:1} }
        .op-fade { animation: opFadeIn  0.28s ease both }
        .op-up   { animation: opSlideUp 0.32s cubic-bezier(0.34,1.56,0.64,1) both }
        .op-pop  { animation: opPop     0.34s cubic-bezier(0.34,1.56,0.64,1) both }
      `}</style>

      <div className="space-y-4 op-fade">

        {/* Window / refresh strip */}
        <div className="neo-card px-5 py-3 flex items-center justify-between gap-3 flex-wrap op-up">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Activity size={14} className="text-blue-500" /> Operational performance
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {meta.fromDate && meta.toDate
                ? `${meta.fromDate} → ${meta.toDate} · ${meta.days} days of history`
                : 'History window unavailable'}
              {meta.failed ? ' · some sources did not respond' : ''}
            </p>
          </div>
          <button onClick={() => load(true)} disabled={refreshing}
            className="neo-flat px-3 py-2 rounded-xl flex items-center gap-2 text-xs text-slate-600 disabled:opacity-60">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {meta.empty && (
          <div className="neo-card p-8 text-center op-up">
            <Activity size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="font-medium text-slate-700">No operational activity in this window</p>
            <p className="text-sm text-slate-400 mt-1">
              No quotations, dispatches or requirements were recorded between {meta.fromDate} and {meta.toDate}.
              Trends, forecasts and anomaly checks resume as soon as records exist.
            </p>
          </div>
        )}

        {/* KPI row — last 30 days against the 30 before */}
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <Kpi Icon={FileText}     iconCls="text-indigo-500"  label="Quotes raised"  value={nf(kpis.quotes?.value)}      sub="last 30 days"                      delta={kpis.quotes?.deltaPct}     delay="0ms" />
          <Kpi Icon={TrendingUp}   iconCls="text-sky-500"     label="Quote value"    value={nf(kpis.quoteValue?.value)}  sub={`KWD · avg ${nf(kpis.avgQuoteValue)}/quote`} delta={kpis.quoteValue?.deltaPct} delay="55ms" />
          <Kpi Icon={ShoppingCart} iconCls="text-emerald-500" label="Orders booked"  value={nf(kpis.orders?.value)}      sub={`${pf(kpis.quoteToOrderPct)} of quotes`} delta={kpis.orders?.deltaPct}     delay="110ms" />
          <Kpi Icon={Truck}        iconCls="text-amber-500"   label="Dispatches"     value={nf(kpis.dispatches?.value)}  sub={`${pf(kpis.orderToDispatchPct)} of orders`} delta={kpis.dispatches?.deltaPct} delay="165ms" />
          <Kpi Icon={PackageCheck} iconCls="text-violet-500"  label="Deliveries"     value={nf(kpis.deliveries?.value)}  sub={`${pf(kpis.dispatchToDeliveryPct)} of dispatches`} delta={kpis.deliveries?.deltaPct} delay="220ms" />
          <Kpi Icon={RotateCcw}    iconCls="text-red-500"     label="Returns"        value={nf(kpis.returns?.value)}     sub={`${pf(kpis.returnRatePct)} return rate`} delta={kpis.returns?.deltaPct}    delay="275ms" />
        </div>

        {/* Pipeline chain */}
        <Panel title="Pipeline — last 30 days" icon={ArrowRight} iconCls="text-slate-400" delay="60ms"
          right={
            <span className="text-[11px] text-slate-400">
              Open dispatch backlog: <strong className="text-slate-600">{nf(kpis.backlog)}</strong> orders
            </span>
          }>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Stage Icon={FileText}     label="Quotes"     value={kpis.quotes?.value}     colour="#6366f1" />
            <Conversion pct={kpis.quoteToOrderPct} />
            <Stage Icon={ShoppingCart} label="Orders"     value={kpis.orders?.value}     colour="#10b981" />
            <Conversion pct={kpis.orderToDispatchPct} />
            <Stage Icon={Truck}        label="Dispatched" value={kpis.dispatches?.value} colour="#f59e0b" />
            <Conversion pct={kpis.dispatchToDeliveryPct} />
            <Stage Icon={PackageCheck} label="Delivered"  value={kpis.deliveries?.value} colour="#8b5cf6" />
            <Conversion pct={kpis.returnRatePct} />
            <Stage Icon={RotateCcw}    label="Returned"   value={kpis.returns?.value}    colour="#ef4444" />
          </div>
        </Panel>

        {/* Trend + forecast */}
        <Panel title="Trend and forecast" icon={TrendingUp} iconCls="text-blue-400" delay="120ms"
          right={
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1 flex-wrap">
                {METRICS.map(m => (
                  <button key={m.key} onClick={() => setMetricKey(m.key)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      m.key === metricKey ? 'bg-slate-800 text-white' : 'neo-flat text-slate-500 hover:text-slate-700'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {HORIZONS.map(h => (
                  <button key={h} onClick={() => setHorizon(h)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      h === horizon ? 'bg-blue-600 text-white' : 'neo-flat text-slate-500 hover:text-slate-700'
                    }`}>
                    {h}d
                  </button>
                ))}
              </div>
            </div>
          }>

          {/* A long run of trailing zeros almost always means the data feed
              stopped rather than the business stopping, and it drags the
              forecast to ~0. Saying so is the difference between a number
              that looks broken and one that explains itself. */}
          {forecast?.ok && forecast.quality.staleDays >= 7 && (
            <div className="mb-3 flex items-start gap-2 text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-slate-400" />
              <span>
                No {metric.label.toLowerCase()} recorded for the last {forecast.quality.staleDays} days
                {forecast.quality.lastNonZeroDate ? ` (latest: ${forecast.quality.lastNonZeroDate})` : ''} —
                the forecast reflects that silence. Check the data feed before reading these numbers as a decline.
              </span>
            </div>
          )}

          {!forecast?.ok && (
            <div className="mb-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{forecast?.reason ?? 'Forecast unavailable for this metric.'} The chart below shows actuals only.</span>
            </div>
          )}

          {chartRows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-16">No data to plot for this metric.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 10 }} width={54} allowDecimals={false} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE}
                  formatter={(v, name) => {
                    if (Array.isArray(v)) return [`${nf(v[0])} – ${nf(v[1])}`, '80% range'];
                    return [metric.money ? `${nf(v)} KWD` : nf(v), name];
                  }} />
                <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="band" name="80% range" stroke="none"
                  fill={metric.colour} fillOpacity={0.12} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="actual" name="Actual" stroke={metric.colour}
                  strokeWidth={2} dot={false} isAnimationActive animationDuration={700} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" name={`Forecast (${horizon}d)`} stroke={metric.colour}
                  strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}

          {/* 30 / 60 / 90 summary — always all three, so the horizon buttons
              change the chart without hiding the other two numbers. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {HORIZONS.map(h => {
              const t = forecast?.ok ? forecast.totals?.[h] : null;
              return (
                <div key={h} className={`neo-inset p-3 rounded-xl ${h === horizon ? 'ring-1 ring-blue-200' : ''}`}>
                  <p className="text-[11px] text-slate-500 font-medium">Next {h} days</p>
                  {t ? (
                    <>
                      <p className="text-lg font-bold text-slate-800 leading-tight mt-0.5">
                        {nf(t.total)}{metric.money ? ' KWD' : ` ${metric.unit}`}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        80% range {nf(t.lower)} – {nf(t.upper)} · ≈{nf(t.dailyAvg)}/day
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{t.from} → {t.to}</p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400 mt-1">Not available</p>
                  )}
                </div>
              );
            })}
          </div>

          {forecast?.ok && (
            <p className="text-[11px] text-slate-400 mt-3">
              Damped Theil–Sen trend with a day-of-week profile, fitted on {forecast.quality.fittedOn} days
              ({forecast.quality.observations} in window). Daily drift {forecast.quality.slopePerDay >= 0 ? '+' : ''}
              {forecast.quality.slopePerDay}. Forecast starts the day after {forecast.lastActualDate}, which is the
              last day with actual data.
            </p>
          )}
        </Panel>

        {/* Anomalies */}
        <Panel title="Anomaly detection" icon={AlertTriangle}
          iconCls={criticalCount ? 'text-red-500' : 'text-emerald-500'} delay="180ms"
          right={
            <div className="flex items-center gap-2 flex-wrap">
              {zeroCount > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-100">
                  {zeroCount} KWD 0 quote{zeroCount === 1 ? '' : 's'}
                </span>
              )}
              <span className="text-[11px] text-slate-400">
                {data?.quality?.quotations?.total ?? 0} quotes screened · {data?.quality?.excluded ?? 0} excluded from totals
              </span>
            </div>
          }>
          {anomalies.length === 0 ? (
            <div className="text-center py-10">
              <BadgeCheck size={30} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">No anomalies detected</p>
              <p className="text-xs text-slate-400 mt-1">
                Every quotation in the window has a valid date and a positive, non-duplicate value.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto -mx-5 px-5 divide-y neo-divider">
              {anomalies.slice(0, 60).map(a => {
                const s = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info;
                return (
                  <div key={a.id} className="py-3 flex items-start gap-3">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700 leading-snug">{a.reason}</p>
                      {a.detail && <p className="text-xs text-slate-400 mt-0.5">{a.detail}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] font-medium text-slate-600">{a.entityId}</p>
                      <p className="text-[10px] text-slate-400">{a.date ?? 'no date'}</p>
                      {a.customer && <p className="text-[10px] text-slate-400 truncate max-w-[9rem]">{a.customer}</p>}
                    </div>
                  </div>
                );
              })}
              {anomalies.length > 60 && (
                <p className="py-3 text-xs text-slate-400 text-center">
                  {anomalies.length - 60} further anomalies not shown.
                </p>
              )}
            </div>
          )}
        </Panel>

        {/* The existing snapshot dashboard, untouched. */}
        <AdminDashboard />
      </div>
    </>
  );
}
