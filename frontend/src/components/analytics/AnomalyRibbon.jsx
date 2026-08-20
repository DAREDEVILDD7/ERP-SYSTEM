// AnomalyRibbon — priority signals surfaced above the analytics chat.
//
// Reuses the existing per-section fetchers (via useAnalytics) so there is
// no new query layer to feed. Runs the pure `buildAnomalies` rules over
// the results and renders a horizontally scrollable strip of flags ranked
// by severity, plus a single "start here" callout above them.
//
// Why this component rather than more chart cards: a manager's opening
// question is "what should I look at first?", and the current 13 sections
// answer "here is a decomposition". This turns the same underlying data
// into prescription — the sentence you would want an analyst to lead with.
//
// Failure modes are contained:
//  * A section still loading contributes nothing (its rules simply skip).
//  * A section that errored is treated as absent — never blocks the ribbon.
//  * Any rule that throws is caught in `safeRule` inside anomalyRules.js.
//  * A render exception is caught by RibbonBoundary so the rest of the
//    page keeps working.
//
// The click contract: if `onDrillIn` is passed, each chip becomes a
// button that calls `onDrillIn({ promptId })`. The parent decides what to
// do (Phase 4 wires this into `askFollowUp`); without it, chips render as
// static badges.

import { Component, useMemo, useState } from 'react';
import {
  Sparkles, Clock, TrendingDown, TrendingUp, Wallet, Wrench, Package,
  Users, AlertTriangle, ChevronRight, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useAnalytics } from '../../hooks/useAnalytics';
import { buildAnomalies } from '../../lib/anomalyRules';
import { paramsFor } from '../../lib/analyticsWindow';

const ICONS = {
  clock: Clock,
  'trending-down': TrendingDown,
  'trending-up': TrendingUp,
  wallet: Wallet,
  wrench: Wrench,
  package: Package,
  users: Users,
  'alert-triangle': AlertTriangle,
};

// Palette per severity. Kept small on purpose — three warning levels plus a
// positive tone. Neomorphism theme uses slate; accent colours are the JTC
// red family for critical, amber for warning, sky for info, emerald for
// positive.
const SEV_STYLE = {
  critical: {
    dot: 'bg-red-500',
    ring: 'ring-red-200',
    chipBg: 'bg-red-50/70 hover:bg-red-50',
    chipBorder: 'border-red-200',
    icon: 'text-red-600',
    label: 'Critical',
    labelBg: 'bg-red-100 text-red-700',
  },
  warning: {
    dot: 'bg-amber-500',
    ring: 'ring-amber-200',
    chipBg: 'bg-amber-50/70 hover:bg-amber-50',
    chipBorder: 'border-amber-200',
    icon: 'text-amber-600',
    label: 'Watch',
    labelBg: 'bg-amber-100 text-amber-700',
  },
  info: {
    dot: 'bg-sky-500',
    ring: 'ring-sky-200',
    chipBg: 'bg-sky-50/70 hover:bg-sky-50',
    chipBorder: 'border-sky-200',
    icon: 'text-sky-600',
    label: 'Note',
    labelBg: 'bg-sky-100 text-sky-700',
  },
  positive: {
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-200',
    chipBg: 'bg-emerald-50/70 hover:bg-emerald-50',
    chipBorder: 'border-emerald-200',
    icon: 'text-emerald-600',
    label: 'Good',
    labelBg: 'bg-emerald-100 text-emerald-700',
  },
};


// Isolated error boundary: a broken ribbon must never bring the whole
// analytics page down with it. The chat below stays fully functional.
class RibbonBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[AnomalyRibbon] render failed:', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      // Silent degrade: a one-line note, no scary error card. The rest of
      // the analytics page (the chat and every section) is unaffected.
      return (
        <div className="neo-card px-4 py-2 text-[11px] text-slate-400">
          Priority signals are temporarily unavailable.
        </div>
      );
    }
    return this.props.children;
  }
}

function Skeleton() {
  return (
    <div
      className="neo-card p-2.5 sm:p-3 flex flex-col gap-2 min-w-0 max-w-full"
      aria-busy="true"
      aria-label="Loading priority signals"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={13} className="text-primary-500" />
        <span className="text-xs font-semibold text-slate-600">Priority signals</span>
      </div>
      <div className="flex gap-2 overflow-hidden">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-12 min-w-[200px] flex-none rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function Chip({ anomaly, onDrillIn }) {
  const sev = SEV_STYLE[anomaly.severity] ?? SEV_STYLE.info;
  const Icon = ICONS[anomaly.icon] ?? AlertTriangle;
  const clickable = typeof onDrillIn === 'function' && anomaly.promptId;

  // Two-line compact layout: severity + headline on line 1, detail on line 2.
  // Left colour rail (sev.dot) replaces the old icon-box so the severity reads
  // before the text and the chip stays narrow enough to show 4-5 on screen.
  const inner = (
    <div className="flex flex-col gap-0.5 min-w-0 text-left">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon size={10} className={`${sev.icon} shrink-0`} />
        <span className={`text-[9px] font-bold uppercase tracking-wide shrink-0 ${sev.icon}`}>
          {sev.label}
        </span>
        <span className="text-[11px] font-semibold text-slate-800 truncate">
          {anomaly.headline}
        </span>
        {clickable && (
          <ChevronRight size={10} className="text-slate-400 shrink-0 ml-auto" />
        )}
      </div>
      <p className="text-[10px] text-slate-500 leading-snug truncate pl-[22px]">
        {anomaly.detail}
      </p>
    </div>
  );

  const wrapBase = `flex overflow-hidden rounded-lg min-w-[190px] max-w-[260px] flex-none ${sev.chipBg}`;
  const rail = <div className={`w-0.5 shrink-0 self-stretch ${sev.dot}`} />;
  const content = <div className="flex-1 px-2.5 py-2">{inner}</div>;

  if (!clickable) {
    return <div className={wrapBase}>{rail}{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onDrillIn({ promptId: anomaly.promptId, days: anomaly.days })}
      className={`${wrapBase} text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:z-10 focus:outline-none focus-visible:ring-2 ${sev.ring}`}
      title={`Open ${anomaly.promptId.replace(/_/g, ' ')}`}
    >
      {rail}{content}
    </button>
  );
}

function RibbonInner({ ctx, onDrillIn }) {
  // Reuse the same fetchers the sections themselves use, RESOLVED WITH
  // THE SAME PARAMS. `paramsFor(sectionKey, ctx)` looks up the same
  // per-section clamps AnalyticsPage applies to its chat renders, so the
  // ribbon and the section that produces the same insight share ONE
  // React Query cache entry.
  //
  // Before this change the ribbon called useAnalytics without params —
  // always the fetcher's own default (e.g. 365 days for top_customers).
  // If the user had picked a shorter date range on the page, the chat
  // section then ran a DIFFERENT query and rendered a different chart,
  // while the ribbon still displayed prose from the 365-day snapshot.
  // The two disagreed on the same screen. Now they can't.
  const monthly   = useAnalytics('monthly_kpis',    paramsFor('monthly_kpis',    ctx));
  const leases    = useAnalytics('recent_leases',   paramsFor('recent_leases',   ctx));
  const customers = useAnalytics('top_customers',   paramsFor('top_customers',   ctx));
  const idle      = useAnalytics('idle_vs_active',  paramsFor('idle_vs_active',  ctx));
  const util      = useAnalytics('utilization',     paramsFor('utilization',     ctx));
  const maint     = useAnalytics('maintenance_cost',paramsFor('maintenance_cost',ctx));

  // Collapsed by default only after the user has expanded once and
  // opted to hide — first mount stays expanded so the ribbon is
  // visible on landing. State is ephemeral (page-scope), because a
  // persisted setting is not what was asked for and adds a moving
  // part. Every fetch continues in the background so re-expanding is
  // instant.
  const [collapsed, setCollapsed] = useState(false);

  // Clicking a signal chip drills into the matching section (via the
  // parent's onDrillIn) AND rolls the ribbon up, so the freshly-appended
  // answer gets the vertical space back. Wrapped in try/catch so a
  // drill-in that throws still collapses the ribbon cleanly — the two
  // side-effects are independent and neither should block the other.
  const handleChipDrillIn = useMemo(() => {
    if (typeof onDrillIn !== 'function') return undefined;
    return (suggestion) => {
      try { onDrillIn(suggestion); }
      catch (err) { console.warn('[AnomalyRibbon] drill-in threw', err?.message ?? err); }
      setCollapsed(true);
    };
  }, [onDrillIn]);

  const allLoading =
    monthly.isLoading && leases.isLoading && customers.isLoading &&
    idle.isLoading && util.isLoading && maint.isLoading;

  const anomalies = useMemo(() => {
    try {
      return buildAnomalies({
        monthly:   monthly.data,
        leases:    leases.data,
        customers: customers.data,
        idle:      idle.data,
        util:      util.data,
        maint:     maint.data,
      });
    } catch (err) {
      console.warn('[AnomalyRibbon] buildAnomalies threw', err?.message ?? err);
      return [];
    }
  }, [monthly.data, leases.data, customers.data, idle.data, util.data, maint.data]);

  if (allLoading) return <Skeleton />;

  // Never gate on "any loading" — a slow single section should not hide
  // insights the other five already produced. Rules for the still-loading
  // section simply do not contribute yet.
  const counts = anomalies.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});

  const ToggleIcon = collapsed ? ChevronDown : ChevronUp;

  return (
    <section
      className="neo-card p-2.5 sm:p-3 flex flex-col gap-2 min-w-0 max-w-full"
      aria-label="Priority signals"
    >
      <style>{`
        @keyframes psFlow {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: none; }
        }
        .ps-flow-item {
          opacity: 0;
          animation: psFlow 0.35s cubic-bezier(.22,.61,.36,1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .ps-flow-item { animation-duration: 0.01ms; animation-delay: 0ms !important; }
        }
      `}</style>

      {/* Header: title + severity counts on the left, collapse toggle on the right */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className="flex items-center gap-1.5 shrink-0">
            <Sparkles size={13} className="text-primary-500" />
            <span className="text-xs font-semibold text-slate-700">Priority signals</span>
          </div>
          {anomalies.length > 0 ? (
            <div className="flex items-center gap-1">
              {['critical', 'warning', 'info', 'positive'].map(sev =>
                counts[sev] ? (
                  <span
                    key={sev}
                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${SEV_STYLE[sev].labelBg}`}
                  >
                    {counts[sev]} {SEV_STYLE[sev].label}
                  </span>
                ) : null
              )}
            </div>
          ) : (
            <span className="text-[10px] text-slate-400">All clear</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
          aria-controls="priority-signals-body"
          className="p-1 rounded-md hover:bg-slate-100 text-slate-400 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 transition-colors"
          title={collapsed ? 'Expand priority signals' : 'Collapse priority signals'}
          aria-label={collapsed ? 'Expand priority signals' : 'Collapse priority signals'}
        >
          <ToggleIcon size={13} />
        </button>
      </div>

      {/* Chip strip — always a single horizontal-scroll row so height is
          predictable regardless of how many signals fire. */}
      {!collapsed && anomalies.length > 0 && (
        <div
          id="priority-signals-body"
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory"
        >
          {anomalies.map((a, i) => (
            <div
              key={a.id}
              className="snap-start ps-flow-item flex-none"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <Chip anomaly={a} onDrillIn={handleChipDrillIn} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AnomalyRibbon({ ctx, onDrillIn }) {
  return (
    <RibbonBoundary>
      <RibbonInner ctx={ctx} onDrillIn={onDrillIn} />
    </RibbonBoundary>
  );
}
