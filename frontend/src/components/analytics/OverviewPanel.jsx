// OverviewPanel — the new default view for Analytics.
//
// Answers "what should I look at first?" with a fixed, opinionated layout:
//   1. Money Map — six headline KWD/count tiles across the top.
//   2. Forward forecast — booked lease revenue for 30/60/90 days.
//   3. (The AnomalyRibbon lives one level up and sits above this panel.)
//
// Every tile is a THIN presentational layer over existing useAnalytics
// queries — no new fetcher is invoked here for the Money Map, so a user who
// then jumps to the Ask tab and opens the matching section hits a warm
// cache rather than a fresh network round-trip.
//
// Failure modes are contained:
//   * Each row reads its data through guarded locals — a query still
//     loading or returning an unexpected shape renders as "—" instead of
//     throwing.
//   * A local error boundary wraps the whole panel so an unexpected render
//     exception in one tile cannot poison the tab.
//   * `onDrillIn({ promptId })` is the parent's chat hook — every tile
//     exposes a "See detail →" link that switches to Ask with that prompt
//     pre-appended.

import { Component } from 'react';
import {
  Wallet, TrendingUp, Package, Clock, Users, Gauge,
  Sparkles, ChevronRight, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { useAnalytics } from '../../hooks/useAnalytics';
import { kwd } from '../../lib/insightHelpers';
import { NEO_TOOLTIP_STYLE } from '../dashboard/DashUtils';
import { paramsFor } from '../../lib/analyticsWindow';

// A colour palette per tile so the six-tile row reads at a glance without
// being noisy. Kept subtle — the number is the message, the accent is a
// visual anchor for scanning.
const TILE_ACCENTS = {
  revenue:    { icon: 'text-emerald-600', dot: 'bg-emerald-500', border: 'border-emerald-500' },
  collected:  { icon: 'text-sky-600',     dot: 'bg-sky-500',     border: 'border-sky-500'     },
  fleet:      { icon: 'text-primary-600', dot: 'bg-primary-500', border: 'border-primary-500' },
  idle:       { icon: 'text-amber-600',   dot: 'bg-amber-500',   border: 'border-amber-500'   },
  ar:         { icon: 'text-rose-600',    dot: 'bg-rose-500',    border: 'border-rose-500'    },
  renewal:    { icon: 'text-violet-600',  dot: 'bg-violet-500',  border: 'border-violet-500'  },
};

// A formatter that returns '—' for non-finite / null / undefined so an
// unloaded query cannot render "0" and mislead. The tiles show a skeleton
// while the underlying query is loading, so "—" appears only when the
// query resolved with genuinely absent data.
function kwdOrDash(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return kwd(v);
}

class OverviewBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[Overview] render failed:', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="neo-card p-4 flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5" />
          <span>
            The Overview could not be rendered.{' '}
            <span className="text-slate-500">
              Switch to the Ask tab to browse individual sections while this is investigated.
            </span>
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

// A single Money Map tile. Coloured left-border accent signals the metric
// family at a glance. Delta is the most important signal so it leads the
// sub-line; the absolute sub-text follows.
function MoneyTile({
  accent, icon: Icon, label, value, sub, deltaPct, loading,
  promptId, onDrillIn, warned,
}) {
  const acc = TILE_ACCENTS[accent] ?? TILE_ACCENTS.fleet;
  const deltaTone = deltaPct > 0 ? 'text-emerald-600'
    : deltaPct < 0 ? 'text-rose-600'
    : 'text-slate-400';
  const deltaArrow = deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : null;
  const clickable = typeof onDrillIn === 'function' && promptId;
  const borderClass = warned ? 'border-rose-400' : acc.border;
  const warnedBg   = warned ? ' bg-rose-50/30' : '';

  const body = (
    <>
      <div className="flex items-center justify-between gap-1 min-w-0 mb-1">
        <div className="flex items-center gap-1 min-w-0">
          <Icon size={9} className={`${acc.icon} shrink-0`} />
          <p className={`text-[9px] uppercase tracking-wider font-semibold truncate ${acc.icon}`}>
            {label}
          </p>
        </div>
        {clickable && <ChevronRight size={9} className="text-slate-300 shrink-0" />}
      </div>
      {loading ? (
        <div className="h-5 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className="text-sm font-bold leading-tight truncate text-slate-800">{value}</p>
      )}
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap min-w-0">
        {deltaArrow && deltaPct != null && (
          <span className={`text-[10px] font-bold shrink-0 ${deltaTone}`}>
            {deltaArrow} {Math.abs(deltaPct)}%
          </span>
        )}
        {sub && (
          <span className="text-[10px] text-slate-400 truncate">{sub}</span>
        )}
      </div>
    </>
  );

  const base = `neo-kpi border-l-2 ${borderClass} p-2 pl-3 flex flex-col text-left min-w-0${warnedBg}`;
  if (!clickable) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onDrillIn({ promptId })}
      className={`${base} hover:ring-2 hover:ring-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 transition`}
      title={`Open ${promptId.replace(/_/g, ' ')}`}
    >
      {body}
    </button>
  );
}

function MoneyMap({ ctx, onDrillIn }) {
  // Same fetchers as the chat sections that produce these numbers,
  // resolved with the same per-section clamps via paramsFor(). Sharing
  // one React Query cache entry per (key, params) means the Money Map
  // tile and the drill-in section it links to cannot disagree.
  const monthly   = useAnalytics('monthly_kpis',   paramsFor('monthly_kpis',   ctx));
  const leases    = useAnalytics('recent_leases',  paramsFor('recent_leases',  ctx));
  const customers = useAnalytics('top_customers',  paramsFor('top_customers',  ctx));
  const util      = useAnalytics('utilization',    paramsFor('utilization',    ctx));
  const idle      = useAnalytics('idle_vs_active', paramsFor('idle_vs_active', ctx));

  // Guarded reads for every KPI — a query that is still loading returns
  // undefined and the tile shows its skeleton; a query that returned but
  // is missing the key shows '—' rather than a fake 0.
  const rev = monthly.data?.kpis?.revenue;
  const revDelta = monthly.data?.kpis?.revenueDeltaPct;

  const collected = monthly.data?.kpis?.collected;
  const collRate = monthly.data?.kpis?.collectionRatePct;

  const inUse = util.data?.kpis?.inUse;
  const fleetTotal = util.data?.kpis?.totalUnits;
  const fleetUtil = util.data?.kpis?.fleetUtilPct;

  const idleCount = idle.data?.kpis?.idle;
  const longestIdle = idle.data?.kpis?.longestIdleDays;

  const outstanding = customers.data?.kpis?.totalOutstanding;
  const worstDebtor = customers.data?.kpis?.worstDebtorName;

  const atRiskKwd = leases.data?.kpis?.monthlyAtRisk30;
  const atRiskCount = leases.data?.kpis?.expiring30;

  // The revenue tile's sub-line has to describe the ACTUAL period the
  // fetcher queried, not a fixed "this month" label — the underlying
  // monthly_kpis fetcher honours an explicit range via meta.fromDate /
  // meta.toDate and NULLs monthKey in that case. Reading those fields
  // straight prevents the tile from claiming "this month" while showing
  // a 30- or 90-day rolling total.
  const revenueSub = (() => {
    const m = monthly.data?.meta;
    if (!m) return 'this month';
    if (m.allTime) return 'all recorded activity';
    if (m.monthKey) return m.monthKey;           // default calendar-month path
    if (m.fromDate && m.toDate) {
      return `${m.fromDate.slice(5)} → ${m.toDate.slice(5)}`;
    }
    return 'current period';
  })();

  return (
    <section
      className="neo-card p-2.5 sm:p-3 flex flex-col gap-2.5 min-w-0 max-w-full"
      aria-label="Money Map"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={13} className="text-primary-500 shrink-0" />
        <span className="text-xs font-semibold text-slate-700">Money Map</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {/* Group 1 — Revenue & Collections */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">
              Revenue &amp; Collections
            </span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
            <MoneyTile
              accent="revenue"
              icon={TrendingUp}
              label="Revenue"
              value={kwdOrDash(rev)}
              sub={revenueSub}
              deltaPct={revDelta ?? null}
              loading={monthly.isLoading}
              promptId="monthly_kpis"
              onDrillIn={onDrillIn}
            />
            <MoneyTile
              accent="collected"
              icon={Wallet}
              label="Collected"
              value={kwdOrDash(collected)}
              sub={Number.isFinite(collRate) ? `${collRate}% of billed` : 'not settled'}
              loading={monthly.isLoading}
              promptId="monthly_kpis"
              onDrillIn={onDrillIn}
            />
            <MoneyTile
              accent="ar"
              icon={Users}
              label="Outstanding A/R"
              value={kwdOrDash(outstanding)}
              sub={worstDebtor ? `top: ${worstDebtor}` : 'all customers'}
              loading={customers.isLoading}
              promptId="top_customers"
              onDrillIn={onDrillIn}
              warned={Number.isFinite(outstanding) && outstanding >= 5000}
            />
          </div>
        </div>

        {/* Group 2 — Fleet Health */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">
              Fleet Health
            </span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
            <MoneyTile
              accent="fleet"
              icon={Gauge}
              label="Fleet earning"
              value={
                Number.isFinite(inUse) && Number.isFinite(fleetTotal)
                  ? `${inUse} / ${fleetTotal}`
                  : '—'
              }
              sub={Number.isFinite(fleetUtil) ? `${fleetUtil}% utilised` : 'live snapshot'}
              loading={util.isLoading}
              promptId="utilization"
              onDrillIn={onDrillIn}
            />
            <MoneyTile
              accent="idle"
              icon={Package}
              label="Idle units"
              value={Number.isFinite(idleCount) ? String(idleCount) : '—'}
              sub={
                Number.isFinite(longestIdle) && longestIdle > 0
                  ? `longest ${longestIdle}d`
                  : 'live snapshot'
              }
              loading={idle.isLoading}
              promptId="idle_vs_active"
              onDrillIn={onDrillIn}
              warned={Number.isFinite(idleCount) && idleCount >= 5}
            />
            <MoneyTile
              accent="renewal"
              icon={Clock}
              label="At-risk lease"
              value={Number.isFinite(atRiskKwd) ? `${kwd(atRiskKwd)}/mo` : '—'}
              sub={
                Number.isFinite(atRiskCount) && atRiskCount > 0
                  ? `${atRiskCount} lease${atRiskCount === 1 ? '' : 's'} ≤30d`
                  : 'none expiring'
              }
              loading={leases.isLoading}
              promptId="recent_leases"
              onDrillIn={onDrillIn}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ForecastCard({ onDrillIn }) {
  // Forecast is forward-looking (horizonDays), unaffected by the page's
  // historical date filter. paramsFor('forward_forecast', ctx) returns
  // undefined so this fetcher keeps its default horizon.
  const q = useAnalytics('forward_forecast');
  const d = q.data;

  const buckets = d?.series?.buckets ?? [];
  const k = d?.kpis;

  return (
    <section
      className="neo-card p-2.5 sm:p-3 flex flex-col gap-2 min-w-0 max-w-full"
      aria-label="Forward revenue forecast"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={14} className="text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold text-slate-700">
            Forward forecast — booked lease commitments
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          Floor, not a plan — excludes new deals and renewals.
        </span>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : q.error ? (
        <p className="text-[11px] text-amber-700">
          Forecast temporarily unavailable — {String(q.error?.message ?? q.error)}
        </p>
      ) : !k || k.leaseCount === 0 ? (
        <p className="text-[11px] text-slate-500">
          No open leases with a monthly rate on file — nothing to forecast yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <div className="neo-inset px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Next 30d</p>
              <p className="text-sm font-bold text-slate-800 leading-tight">{kwdOrDash(k.forecast30)}</p>
              <p className="text-[10px] text-slate-400">
                {buckets.find(b => b.edge === 30)?.leases ?? 0} lease
                {(buckets.find(b => b.edge === 30)?.leases ?? 0) === 1 ? '' : 's'} contributing
              </p>
            </div>
            <div className="neo-inset px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Next 60d</p>
              <p className="text-sm font-bold text-slate-800 leading-tight">{kwdOrDash(k.forecast60)}</p>
              <p className="text-[10px] text-slate-400">cumulative</p>
            </div>
            <div className="neo-inset px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Next 90d</p>
              <p className="text-sm font-bold text-slate-800 leading-tight">{kwdOrDash(k.forecast90)}</p>
              <p className="text-[10px] text-slate-400">
                {k.expiringCount || 0} lease
                {k.expiringCount === 1 ? '' : 's'} expire in this horizon
              </p>
            </div>
          </div>

          {buckets.length > 0 && (
            <div className="h-28">
              <ResponsiveContainer>
                <BarChart data={buckets} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    width={54}
                    tickFormatter={(v) => v.toLocaleString()}
                  />
                  <Tooltip
                    contentStyle={NEO_TOOLTIP_STYLE}
                    formatter={(v) => [kwd(v), 'Forecast']}
                  />
                  <Bar dataKey="forecastKwd" radius={[6, 6, 0, 0]}>
                    {buckets.map((b) => (
                      <Cell
                        key={b.label}
                        fill={b.expiringInBucket > 0 ? '#f59e0b' : '#10b981'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Expiring-lease surface: renewal risk sits next to the forecast
              number rather than in a separate section, because the forecast
              is only as safe as its renewals. */}
          {Array.isArray(d?.breakdowns?.expiringSoon) && d.breakdowns.expiringSoon.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Expiring inside the horizon
              </p>
              <ul className="space-y-1.5">
                {d.breakdowns.expiringSoon.slice(0, 5).map((r) => (
                  <li
                    key={r.equipment_id}
                    className="flex items-baseline justify-between gap-2 text-[11px] rounded-md bg-white/60 border border-slate-100 px-2 py-1"
                    title={r.equipment_id}
                  >
                    <span className="text-slate-700 truncate">{r.label}</span>
                    <span className="text-slate-500 whitespace-nowrap">
                      {kwd(r.monthly)}/mo · {r.daysToEnd}d left
                    </span>
                  </li>
                ))}
              </ul>
              {typeof onDrillIn === 'function' && (
                <button
                  type="button"
                  onClick={() => onDrillIn({ promptId: 'recent_leases' })}
                  className="mt-2 text-[10px] text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  See all in Recent leases <ChevronRight size={11} />
                </button>
              )}
            </div>
          )}

          <p className="text-[10px] text-slate-400 leading-relaxed">
            {d.meta?.basisNote}
          </p>
        </>
      )}
    </section>
  );
}

// The panel composes ribbon-position siblings on the page rather than
// wrapping them, because the AnomalyRibbon sits above (visible in both
// tabs). This panel is Money Map + Forecast only.
export default function OverviewPanel({ ctx, onDrillIn }) {
  return (
    <OverviewBoundary>
      <div className="flex flex-col gap-2 min-w-0 max-w-full">
        <MoneyMap ctx={ctx} onDrillIn={onDrillIn} />
        <ForecastCard onDrillIn={onDrillIn} />
      </div>
    </OverviewBoundary>
  );
}
