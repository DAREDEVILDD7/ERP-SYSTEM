// One React component per analytics section (§§4.1–4.13). Each is a thin
// presentational layer: it reads a single useAnalytics(...) query and
// renders KPIs + a chart + an InsightList wired to the matching template.
//
// Every section is deliberately isolated — a failing query, an empty
// result, or a template that raises will only affect its own tile.

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Label,
  LineChart, Line, AreaChart, Area, ReferenceArea,
} from 'recharts';
import {
  Package, ShoppingCart, Calendar, Wrench, Truck, RefreshCcw, Gauge,
  DollarSign, Repeat, Activity, Users, LineChart as LineChartIcon,
  LayoutDashboard, ChevronRight, TrendingUp, TrendingDown,
  ArrowLeft, Loader2, AlertOctagon, Clock, RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAnalytics } from '../../hooks/useAnalytics';
import {
  getEquipmentMaintenanceRecords, getEquipmentRentalRecords,
  getEquipmentProcurementRecords, getSupplierTransactions,
  getCustomerBillingDetails, getEquipmentUnitsByType,
} from '../../api/analytics';
import { paramsFor } from '../../lib/analyticsWindow';
import { resolveRange, DEFAULT_RANGE } from '../../lib/dateRange';
import DateRangeFilter from './DateRangeFilter';
import SectionCard from './SectionCard';
import { scheduleChartDrawIn, OWN_ANIM_ATTR, CHART_ANIM_MS } from './chartAnimation';
import InsightList from './InsightList';
import AnalysisBrief from './AnalysisBrief';
import {
  NEO_TOOLTIP_STYLE, Bar3D, ActivePieShape, DonutCentre,
} from '../dashboard/DashUtils';
import { kwd } from '../../lib/insightHelpers';
import { axisLabel } from '../../lib/analyticsLabels';
import { buildBrief } from '../../lib/insightBrief';
import {
  tmpl_mostRentedEquipment, tmpl_mostProcuredEquipment, tmpl_recentLeases,
  tmpl_maintenanceFrequency, tmpl_dispatchTrends, tmpl_returnTrends,
  tmpl_utilization, tmpl_revenueByCategory, tmpl_procurementVsLease,
  tmpl_idleVsActive, tmpl_topCustomers, tmpl_maintenanceCostTrends,
  tmpl_monthlyKPIs, tmpl_fleetActionQueue,
} from '../../lib/insightTemplates';

// Viewport check for Recharts pixel props (YAxis width, chart heights) that can't
// be expressed with Tailwind media queries. Bumps a state flag on resize so a
// portrait→landscape flip re-renders the charts at their new size.
function useIsMobile(breakpoint = 640) {
  const get = () => {
    try { return typeof window !== 'undefined' && window.innerWidth < breakpoint; }
    catch { return false; }
  };
  const [isMobile, setIsMobile] = useState(get);
  useEffect(() => {
    const onResize = () => setIsMobile(get());
    try { window.addEventListener('resize', onResize); } catch { /* SSR */ }
    return () => { try { window.removeEventListener('resize', onResize); } catch { /* no-op */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpoint]);
  return isMobile;
}

// Recharts axis pixel widths that can't be expressed via CSS. On a narrow
// viewport the 92px name-axis leaves almost nothing for the bars themselves,
// so it and the label truncation both step down on mobile.
function useHorizontalBarAxis() {
  const isMobile = useIsMobile();
  return {
    yAxisWidth: isMobile ? 66 : 92,
    labelMax:   isMobile ? 12 : 22,
  };
}

const PALETTE = ['#EE1C25', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

// ── Per-card date filter ─────────────────────────────────────────────────
// The EXACT same control as the page-level "Analytics period" filter
// (components/analytics/DateRangeFilter.jsx) — same presets, same custom
// range editor, same popover — reused per chart card so one chart can be
// re-queried over a different period without refetching the other twelve
// sections and without touching the page-level filter.
//
// Each card owns an independent `range` object in the exact `{ preset }` /
// `{ preset: 'custom', from, to }` shape the page itself uses, defaulting to
// the SAME `DEFAULT_RANGE` the page starts on. Resolving it through
// `paramsFor(sectionKey, ctx)` — the identical function the page's own
// render call uses — means an untouched card reproduces the page's default
// behaviour exactly (including this section's own min/max clamp), and a
// range the user actually picks is `explicit`, which is what lets it bypass
// that clamp (e.g. Top customers' forced 365-day floor) instead of being
// silently re-clamped back.
function useCardRange(sectionKey, params) {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const effectiveParams = useMemo(() => {
    let resolved;
    try {
      resolved = resolveRange(range);
    } catch (err) {
      // A card filter that can throw would take its whole section down with
      // it — fall back to whatever the page-level params already were.
      console.warn(`[Analytics] card filter (${sectionKey}) could not resolve range`, err?.message ?? err);
      return params;
    }
    return paramsFor(sectionKey, {
      windowDays: resolved.days,
      from: resolved.from,
      to: resolved.to,
      allTime: resolved.allTime,
      explicit: resolved.explicit,
    });
  }, [sectionKey, params, range]);
  return [effectiveParams, range, setRange];
}

// Reset button — same icon, label and "clear back to default" intent as the
// page header's Reset, scoped to just this card's own filter.
function CardResetButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Reset this chart's period to the default"
      aria-label="Reset chart period"
      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:scale-90 transition-all disabled:opacity-40"
    >
      <RotateCcw size={13} />
    </button>
  );
}

// ── Chart drag-to-zoom drill-down ────────────────────────────────────────
// Drag directly across a trend chart's plotted area to zoom into that exact
// span — a PURELY CLIENT-SIDE crop of the series the section already
// fetched. It must never call the fetcher again: re-querying would mint a
// brand-new React Query cache key with no cached data yet, so `SectionCard`
// sees a genuine `isLoading` and mounts the AI loading animation over what
// looks like a second chart replacing the first — exactly the "opens a new
// chart" bug this replaced. Zooming instead just narrows the SAME `<LineChart
// data={...}>` / `<AreaChart data={...}>` instance's `data` prop to the
// dragged sub-range of the array it already has in memory: same component,
// same position, no network, no refetch, KPIs/insights/the AI response/chat
// state all untouched because `d` itself never changes.
//
// Only wired onto charts with a genuine calendar-keyed X axis (day / month)
// — a rank-ordered or category axis has no date range for a drag to select,
// which is why this is NOT attached to every chart.
const MIN_DRAG_PX = 8; // below this, treat it as a tap/click, not a drag

// "YYYY-MM" → "Aug 2026", for the zoom banner only — filtering itself
// compares the raw "YYYY-MM" strings directly (they already sort and equal
// correctly as plain text), so this is display formatting, not a range
// conversion.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(m) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(m ?? ''));
  if (!match) return m ?? '—';
  return MONTH_ABBR[Number(match[2]) - 1] ? `${MONTH_ABBR[Number(match[2]) - 1]} ${match[1]}` : m;
}

// `onZoom(lo, hi)` receives the two dragged-over axis labels in chronological
// order (raw values as they appear in the chart's own data, e.g. "2026-08-05"
// or "2026-08") — never assumes which end the user started dragging from.
// `orderIsAscending(a, b)` decides drag-start/drag-end ordering. Defaults to
// string comparison, which is correct for every ISO-date/month-key label this
// hook has been used with so far. A chart whose axis labels are NOT
// lexicographically sortable (e.g. "12 Aug" vs "5 Aug" — day-of-month text)
// must pass its own comparator (see `useIndexZoom`, which orders by each
// label's position in the underlying array instead).
function useChartZoomDrag(onZoom, orderIsAscending = (a, b) => String(a) <= String(b)) {
  const [drag, setDrag] = useState(null); // { startLabel, endLabel, startX }

  const begin = useCallback((state) => {
    const label = state?.activeLabel;
    if (label == null) return;
    setDrag({ startLabel: label, endLabel: label, startX: state?.activeCoordinate?.x ?? null });
  }, []);

  const move = useCallback((state) => {
    const label = state?.activeLabel;
    if (label == null) return;
    setDrag(prev => (prev ? { ...prev, endLabel: label } : prev));
  }, []);

  const settle = useCallback((state) => {
    setDrag(prev => {
      if (!prev) return null;
      try {
        const endLabel = state?.activeLabel ?? prev.endLabel;
        const endX = state?.activeCoordinate?.x;
        const movedPx = (endX != null && prev.startX != null)
          ? Math.abs(endX - prev.startX)
          : null;
        // Pixel distance is the primary "was this a real drag" signal, so
        // dragging start-to-end within a single day/month bar still commits
        // (supports a genuine single-bucket zoom); falling back to "did the
        // label change" only when a coordinate genuinely was not available.
        const isRealDrag = movedPx != null ? movedPx > MIN_DRAG_PX : endLabel !== prev.startLabel;
        if (isRealDrag && prev.startLabel != null && endLabel != null) {
          const [lo, hi] = orderIsAscending(prev.startLabel, endLabel)
            ? [prev.startLabel, endLabel]
            : [endLabel, prev.startLabel];
          onZoom(lo, hi);
        }
      } catch (err) {
        // A drag gesture must never take the chart down with it.
        console.warn('[Analytics] chart zoom drag failed', err?.message ?? err);
      }
      return null;
    });
  }, [onZoom, orderIsAscending]);

  const cancel = useCallback(() => setDrag(null), []);

  return {
    drag,
    // Spread directly onto the chart element. Mouse and touch share the same
    // handler — Recharts' event middleware hands both the same
    // `{ activeLabel, activeCoordinate, ... }` state object as the first
    // argument, so one set of callbacks covers desktop drag AND mobile touch
    // range-selection without a separate touch code path.
    handlers: {
      onMouseDown: begin,
      onMouseMove: move,
      onMouseUp: settle,
      onMouseLeave: cancel,
      onTouchStart: begin,
      onTouchMove: move,
      onTouchEnd: settle,
    },
  };
}

const EMPTY_ZOOM_ROWS = []; // stable fallback reference — a fresh `[]` literal every render would itself be a new dependency identity

// Wraps a ZOOMABLE chart's sizing box and re-plays the draw-on whenever
// `animKey` changes — which is how drill-down gets the same animation as
// the entrance. Every OTHER chart is covered by `SectionCard`'s card-level
// sweep (see runChartDrawIn), which needs no per-chart wiring; this wrapper
// exists only where a REPLAY on zoom/reset is required, and marks itself
// with OWN_ANIM_ATTR so that sweep skips it and nothing is animated twice.
// `bars` declares the wrapped chart's bar orientation — 'vertical' (the
// default chart shape, bars rise bottom→top) or 'horizontal' (Recharts
// `layout="vertical"`, bars extend from the value axis). Always pass it for
// a bar chart: inferring orientation from rendered geometry is a fallback,
// and a chart whose values are all small enough to render short, wide stubs
// is exactly where inference is least reliable.
function ChartAnim({ animKey, bars, signed, className, style, children }) {
  const rootRef = useRef(null);

  useLayoutEffect(
    () => scheduleChartDrawIn(() => rootRef.current, { bars, signed }),
    [animKey, bars, signed],
  );

  return (
    <div ref={rootRef} className={className} style={style} {...{ [OWN_ANIM_ATTR]: 'own' }}>
      {children}
    </div>
  );
}

// Stable key for charts whose only animation trigger is "it appeared" —
// `ChartAnim`'s layout effect runs on mount regardless, so a constant is
// exactly right here; it exists to make that intent explicit at call sites.
function useEntranceKey() {
  const [key] = useState(1);
  return key;
}

// Drag-to-zoom over the series the section already fetched. `data` snaps
// directly to the dragged sub-range — a plain array filter, no fetcher, no
// query key, no loading state, ever — and `animKey` bumps, which is what
// makes `<ChartAnim>` re-play the draw-on into the new range. Entrance and
// drill-down therefore share one mechanism: the chart is drawn on when it
// appears, and drawn on again into each new range.
//
// `resetKey` calls `hardReset` — INSTANT, no animation — when it changes: it
// represents "the underlying fetched window itself changed" (the card's own
// period picker, or ITS Reset), a genuinely different dataset. A plain
// background refetch of the SAME window produces a new `fullData` array
// reference too, which is why the reset is keyed on `resetKey` (e.g. a
// card's `cardRange`) and not on `fullData` itself — that would yank an
// active zoom out from under whoever is still looking at it every time data
// quietly revalidates. `hardReset` is also exposed directly so a card's
// header Reset button can force this even when `cardRange` is ALREADY at
// its default (setting state to an identical value is a no-op in React —
// the `resetKey` effect would never fire on its own).
function useLocalZoom(fullData, xKey, resetKey) {
  const rows = fullData ?? EMPTY_ZOOM_ROWS;

  const [zoomDomain, setZoomDomain] = useState(null); // { from, to } labels, or null = full series
  // The dragged [fromLabel, toLabel] band, kept visible for the FULL draw-in
  // (not just the raw drag, which ends the instant the mouse/finger
  // releases) — cleared once that draw-in settles.
  const [highlightRange, setHighlightRange] = useState(null);
  const [animKey, setAnimKey] = useState(1);
  const skipNextResetRef = useRef(true);
  const clearHighlightRef = useRef(null);

  // The highlight band outlives the raw drag so it stays up while the chart
  // draws into the selected range, then clears itself.
  const holdHighlight = useCallback((range) => {
    if (clearHighlightRef.current) clearTimeout(clearHighlightRef.current);
    setHighlightRange(range);
    if (!range) return;
    clearHighlightRef.current = setTimeout(() => {
      setHighlightRange(null);
      clearHighlightRef.current = null;
    }, CHART_ANIM_MS);
  }, []);

  useEffect(() => () => {
    if (clearHighlightRef.current) clearTimeout(clearHighlightRef.current);
  }, []);

  const hardReset = useCallback(() => {
    setZoomDomain(null);
    holdHighlight(null);
    setAnimKey((k) => k + 1);
  }, [holdHighlight]);

  // The window itself changed (a different fetched dataset) — snap back to
  // full. Skips its own first invocation (every effect fires once on mount
  // regardless of whether its dependency "changed") purely to avoid a
  // redundant reset the instant this hook is created.
  useEffect(() => {
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    hardReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const zoomDrag = useChartZoomDrag((lo, hi) => {
    setZoomDomain({ from: lo, to: hi });
    holdHighlight([lo, hi]);
    setAnimKey((k) => k + 1);
  });

  const resetZoom = useCallback(() => {
    setZoomDomain(null);
    holdHighlight(null); // returning to the full view selects nothing to highlight
    setAnimKey((k) => k + 1);
  }, [holdHighlight]);

  const data = useMemo(() => {
    if (!zoomDomain) return rows;
    const filtered = rows.filter((r) => {
      const v = r?.[xKey];
      return v != null && v >= zoomDomain.from && v <= zoomDomain.to;
    });
    // A filter that somehow matches nothing must never blank the chart.
    return filtered.length ? filtered : rows;
  }, [rows, zoomDomain, xKey]);

  return {
    data,
    zoomDomain,
    resetZoom,
    hardReset,
    zoomDrag,
    highlightRange,
    animKey,
  };
}

// Same drag-to-zoom experience as `useLocalZoom`, for charts whose x-axis
// label is NOT lexicographically sortable — `comparativeSeries`'s `bucket`
// field is a formatted day string ("5 Aug", "12 Aug"), and comparing those as
// plain strings orders "12 Aug" before "5 Aug". Resolving each dragged label
// to its POSITION in the already-fetched array (rather than comparing the
// label values themselves) sidesteps that entirely and works for any label
// shape. Returns the identical shape `useLocalZoom` does, so callers (
// `ChartAnim`, `ZoomBanner`, `ReferenceArea`) wire up exactly the same way.
function useIndexZoom(fullData, xKey, resetKey) {
  const rows = fullData ?? EMPTY_ZOOM_ROWS;

  const [zoomRange, setZoomRange] = useState(null); // [fromIdx, toIdx], or null = full series
  const [highlightRange, setHighlightRange] = useState(null);
  const [animKey, setAnimKey] = useState(1);
  const skipNextResetRef = useRef(true);
  const clearHighlightRef = useRef(null);

  const holdHighlight = useCallback((range) => {
    if (clearHighlightRef.current) clearTimeout(clearHighlightRef.current);
    setHighlightRange(range);
    if (!range) return;
    clearHighlightRef.current = setTimeout(() => {
      setHighlightRange(null);
      clearHighlightRef.current = null;
    }, CHART_ANIM_MS);
  }, []);

  useEffect(() => () => {
    if (clearHighlightRef.current) clearTimeout(clearHighlightRef.current);
  }, []);

  const hardReset = useCallback(() => {
    setZoomRange(null);
    holdHighlight(null);
    setAnimKey((k) => k + 1);
  }, [holdHighlight]);

  useEffect(() => {
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    hardReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const indexOf = useCallback(
    (label) => rows.findIndex((r) => r?.[xKey] === label),
    [rows, xKey],
  );

  const zoomDrag = useChartZoomDrag(
    (lo, hi) => {
      setZoomRange([indexOf(lo), indexOf(hi)]);
      holdHighlight([lo, hi]);
      setAnimKey((k) => k + 1);
    },
    (a, b) => indexOf(a) <= indexOf(b),
  );

  const resetZoom = useCallback(() => {
    setZoomRange(null);
    holdHighlight(null);
    setAnimKey((k) => k + 1);
  }, [holdHighlight]);

  const data = useMemo(() => {
    if (!zoomRange) return rows;
    const [a, b] = zoomRange;
    if (a < 0 || b < 0) return rows;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const sliced = rows.slice(lo, hi + 1);
    return sliced.length ? sliced : rows;
  }, [rows, zoomRange]);

  const zoomDomain = useMemo(() => {
    if (!zoomRange) return null;
    const lo = Math.min(...zoomRange);
    const hi = Math.max(...zoomRange);
    return { from: rows[lo]?.[xKey] ?? null, to: rows[hi]?.[xKey] ?? null };
  }, [rows, zoomRange, xKey]);

  return {
    data,
    zoomDomain,
    resetZoom,
    hardReset,
    zoomDrag,
    highlightRange,
    animKey,
  };
}

// Slim strip above a zoomed chart — "Reset zoom" lives right next to the
// data it affects, in addition to the card header's own Reset button.
function ZoomBanner({ active, fromDate, toDate, onReset, detail }) {
  if (!active) return null;
  return (
    <div className="mb-1.5 text-[10px] text-primary-700 bg-primary-50 border border-primary-100 rounded-md px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">
          Zoomed to <span className="font-medium">{fromDate ?? '—'} → {toDate ?? '—'}</span>
        </span>
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 font-medium text-primary-600 hover:text-primary-800 underline underline-offset-2"
        >
          Reset zoom
        </button>
      </div>
      {/* Optional per-chart enrichment (e.g. Dispatch trends' range summary +
          status breakdown) — omitted by callers that don't have one, so this
          is purely additive to every existing use of this banner. */}
      {detail && <div className="mt-1 pt-1 border-t border-primary-100">{detail}</div>}
    </div>
  );
}

// Common runInsight helper: templates are pure but a malformed row could
// theoretically throw. Never let a template crash a whole section.
function safeInsights(fn, result) {
  try { return fn(result) ?? []; }
  catch (e) {
    console.warn('[insight template]', e?.message ?? e);
    return [];
  }
}

// Small KPI pill used across sections. `title` carries the identifier or any
// other hover-only detail — never rendered inline, per the "names in the UI,
// IDs on hover" rule.
function Kpi({ label, value, sub, title }) {
  return (
    <div className="neo-inset px-3 py-2 min-w-0" title={title || undefined}>
      <p className="text-[10px] uppercase tracking-wide text-slate-400 truncate">{label}</p>
      <p className="text-lg font-bold text-slate-800 leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
    </div>
  );
}

// Analyst brief + template bullets, in that order. Every section renders this
// instead of a bare InsightList, so "each analysis produces a brief" holds
// across the board rather than only where it was hand-wired. buildBrief
// returns null when it cannot say anything truthful, and the bullets below
// are exactly what they always were.
function Analysis({ sectionKey, result, template }) {
  const insights = safeInsights(template, result);
  let brief = null;
  try { brief = buildBrief(sectionKey, result, insights); }
  catch (e) { console.warn('[analysis brief]', e?.message ?? e); }
  return (
    <div className="space-y-3">
      {brief && <AnalysisBrief brief={brief} />}
      <InsightList insights={insights} />
    </div>
  );
}

// Chart tooltip that leads with the row's NAME and relegates the database
// identifier to the hover panel — which is the only place an id is allowed to
// appear. `rows` maps a payload row to `[{ label, value }]`.
function NamedTooltip({ active, payload, rows, idOf, subtitleOf, titleOf }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const id = idOf?.(row);
  const subtitle = subtitleOf?.(row);
  // `titleOf` is optional — every existing call site keeps its current
  // `row.label ?? row.name` title unchanged when it doesn't pass one.
  let title = row.label ?? row.name ?? '—';
  try { title = titleOf?.(row) ?? title; } catch (_) { /* keep the default */ }
  let lines = [];
  try { lines = rows?.(row) ?? []; } catch (_) { lines = []; }

  return (
    <div style={NEO_TOOLTIP_STYLE} className="min-w-[168px] max-w-[260px]">
      <p className="text-xs font-semibold text-slate-800 leading-snug break-words">
        {title}
      </p>
      {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
      <div className="mt-1.5 space-y-0.5">
        {lines.filter(l => l && l.value !== null && l.value !== undefined).map(l => (
          <div key={l.label} className="flex justify-between gap-3 text-[11px]">
            <span className="text-slate-500">{l.label}</span>
            <span className="text-slate-800 font-medium">{l.value}</span>
          </div>
        ))}
      </div>
      {id && (
        <p className="text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-200/70 font-mono break-all">
          {id}
        </p>
      )}
    </div>
  );
}

// Expandable ranking row — the drill-down. Collapsed it shows name + headline
// metrics; expanded it reveals the identifiers and the secondary detail that
// would otherwise clutter the list. Keyboard operable because it is a button.
function RankRow({ rank, label, metrics, detail, expanded, onToggle }) {
  return (
    <li className="rounded-lg border border-slate-100 bg-white/70 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-slate-50 transition-colors"
      >
        <span className="shrink-0 w-5 h-5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center">
          {rank}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold text-slate-800 truncate">{label}</span>
          <span className="block text-[10px] text-slate-400 truncate">{metrics}</span>
        </span>
        <ChevronRight
          size={13}
          className={clsx(
            'shrink-0 text-slate-300 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && detail && (
        <div className="px-3 pb-2.5 pt-0.5 border-t border-slate-100 bg-slate-50/60">
          {detail}
        </div>
      )}
    </li>
  );
}

// Definition pair used inside the expanded drill-down.
function Detail({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[11px] text-slate-700 break-words">{value}</p>
    </div>
  );
}

function dateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Every row in dispatch trends' `series.daily` carries a per-STATUS count as
// a dynamic key alongside `day`/`total` (e.g. `{ day, total, Completed: 8,
// Pending: 3 }`) — the fetcher already computes it to build `total`, it is
// just never surfaced anywhere. Summarising the CURRENTLY VISIBLE slice
// (the full series, or the dragged-to sub-range once zoomed) is therefore
// free: no new data, no fetch, just reading what is already in memory.
function summarizeDailyRange(rows) {
  if (!rows?.length) return null;
  let total = 0;
  let peak = null;
  const byStatus = new Map();
  for (const r of rows) {
    const t = Number(r?.total) || 0;
    total += t;
    if (!peak || t > (Number(peak.total) || 0)) peak = r;
    for (const k of Object.keys(r ?? {})) {
      if (k === 'day' || k === 'total') continue;
      const v = Number(r[k]) || 0;
      if (v > 0) byStatus.set(k, (byStatus.get(k) ?? 0) + v);
    }
  }
  return {
    days: rows.length,
    total,
    avgPerDay: rows.length ? total / rows.length : 0,
    peakDay: peak?.day ?? null,
    peakCount: peak ? (Number(peak.total) || 0) : 0,
    // Highest count first — a status with zero occurrences in this slice
    // was already dropped above, so every entry here is worth showing.
    statusBreakdown: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// Same purpose as `summarizeDailyRange` above, for Return Trends' weekly
// series: `{week, count, avgTurnaroundDays}`. Turnaround is averaged
// weighted by each week's own return count, so a week with one slow return
// cannot outweigh a week with a dozen quick ones.
function summarizeWeeklyRange(rows) {
  if (!rows?.length) return null;
  let total = 0;
  let peak = null;
  let turnaroundWeightedSum = 0;
  let turnaroundWeight = 0;
  for (const r of rows) {
    const c = Number(r?.count) || 0;
    total += c;
    if (!peak || c > (Number(peak.count) || 0)) peak = r;
    if (r?.avgTurnaroundDays != null && c > 0) {
      turnaroundWeightedSum += r.avgTurnaroundDays * c;
      turnaroundWeight += c;
    }
  }
  return {
    weeks: rows.length,
    total,
    avgPerWeek: rows.length ? total / rows.length : 0,
    peakWeek: peak?.week ?? null,
    peakCount: peak ? (Number(peak.count) || 0) : 0,
    avgTurnaroundDays: turnaroundWeight ? Math.round((turnaroundWeightedSum / turnaroundWeight) * 10) / 10 : null,
  };
}

// Sort toggle shared by the ranking sections.
function SortToggle({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-slate-400 pr-0.5">Rank by</span>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={clsx(
            'text-[10px] px-2 py-1 rounded-full border transition-colors',
            value === o.key
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Shared contextual visualisations ─────────────────────────────────────
// These exist so "this period against the last one", "the top N by name" and
// "the composition behind the headline" render identically in every section
// that has the data for them. A section that does not is simply expected to
// render nothing — every one of these returns null on empty input, so the
// call sites stay free of conditionals.

// Period-over-period area chart, reading `api/analytics.js`'s
// `series.compare` shape: `[{ bucket, current, previous }]`, index-aligned so
// the two curves are directly comparable. The previous period is drawn as a
// dashed unfilled line deliberately — it is the reference, not a second
// result, and filling both makes the chart read as a stacked total.
function TrendCompare({
  data, title = 'This period vs the previous one', height = 150,
  format = (v) => v, currentLabel = 'This period', prevLabel = 'Previous period',
  // The card's own period picker — a different fetched window snaps an
  // active zoom back to full, same as every other zoomable chart. Optional:
  // a caller that never changes its window (none currently do) can omit it.
  resetKey,
}) {
  // Called unconditionally, before the early returns below, so hook order
  // never varies between a render with data and one without. `bucket` is a
  // formatted day string ("5 Aug"), not lexicographically sortable, so this
  // resolves drag positions by array INDEX rather than by comparing labels.
  const zoom = useIndexZoom(data, 'bucket', resetKey);

  if (!data?.length) return null;
  // With no baseline at all the dashed line is a flat zero, which reads as a
  // real "we did nothing last period" rather than "there was no last period".
  const hasPrev = data.some(d => Number(d.previous) > 0);
  const hasCurrent = data.some(d => Number(d.current) > 0);
  if (!hasCurrent && !hasPrev) return null;

  return (
    <div>
      <p className="text-[11px] font-medium text-slate-500 mb-1.5">
        {title}
        {!hasPrev && (
          <span className="text-slate-400 font-normal"> — no comparable prior period</span>
        )}
        <span className="text-slate-400 font-normal"> · drag to zoom</span>
      </p>
      <ZoomBanner
        active={!!zoom.zoomDomain}
        fromDate={zoom.zoomDomain?.from}
        toDate={zoom.zoomDomain?.to}
        onReset={zoom.resetZoom}
      />
      <ChartAnim animKey={zoom.animKey} variant="draw" className="select-none" style={{ height, touchAction: 'none' }}>
        <ResponsiveContainer>
          <AreaChart data={zoom.data} margin={{ left: 4, right: 8, top: 4 }} {...zoom.zoomDrag.handlers}>
            <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
            <XAxis dataKey="bucket" tick={{ fontSize: 9 }} minTickGap={12} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} width={44} tickFormatter={(v) => format(v)} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={NEO_TOOLTIP_STYLE}
              formatter={(v, name) => [format(v), name]}
            />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
            {hasPrev && (
              <Area
                type="monotone"
                dataKey="previous"
                name={prevLabel}
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="none"
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Area
              type="monotone"
              dataKey="current"
              name={currentLabel}
              stroke="#EE1C25"
              strokeWidth={2}
              fill="#EE1C25"
              fillOpacity={0.13}
              dot={false}
              isAnimationActive={false}
            />
            {(zoom.zoomDrag.drag || zoom.highlightRange) && (
              <ReferenceArea
                x1={zoom.zoomDrag.drag?.startLabel ?? zoom.highlightRange[0]}
                x2={zoom.zoomDrag.drag?.endLabel ?? zoom.highlightRange[1]}
                strokeOpacity={0.3}
                fill="#EE1C25"
                fillOpacity={0.12}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </ChartAnim>
    </div>
  );
}

// Compact horizontal "name — value" list with a proportional bar. Used for
// the contextual breakdowns (locations, destinations, issue types) that do
// not warrant a full chart but are the natural next question after a KPI.
// `title` on each row carries the hover-only detail.
// `pickValue`, NOT `valueOf`. Destructuring a defaulted `valueOf` out of a
// props object resolves `Object.prototype.valueOf` through the prototype
// chain, so the default never applies and every call site that omitted the
// prop invoked `Object.prototype.valueOf` as a bare function — which throws
// "Cannot convert undefined or null to object" and took the whole section
// down. This is the SAME trap `comparativeSeries` hit and was renamed to
// `sumOf` for; it simply existed in a second place. Never name a prop or
// option after an `Object.prototype` member (`valueOf`, `toString`,
// `constructor`, `hasOwnProperty`, ...).
// Anything that reaches a text node has to BE text. A name arriving as an
// object (a relation Supabase returned as a row rather than a scalar) would
// otherwise throw "Objects are not valid as a React child" and take the whole
// section down for a cosmetic reason.
function asText(v, fallback = '—') {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v || fallback;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

// Ranking rows — label and value together, bar underneath.
//
// The previous layout was `name | ────bar──── | value`, with the name in a
// fixed `w-28 sm:w-36` column and the value pinned right in a `w-16` column.
// Reading one row meant travelling the full width of the card, and short names
// left a large dead gap in the middle. Both columns are gone: the name now
// sizes to its own content and the value sits immediately after it, so the
// datum is read in one fixation.
//
// The bar moved BELOW that line and spans the full width. It is decorative
// now — the number above it is the value — so it carries `aria-hidden` and a
// screen reader reads "Yard A 12" rather than the same figure twice.
//
// No fixed widths anywhere, which is what makes this work unchanged from a
// phone to a wide desktop: the name truncates into whatever space there is
// and the bar simply spans it.
function MiniBars({ title, rows, pickValue, format = (v) => v, hint }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  const read = typeof pickValue === 'function' ? pickValue : (r) => r?.value;
  const max = Math.max(1, ...list.map(r => Number(read(r)) || 0));
  return (
    <div>
      {title && (
        <p className="text-[11px] font-medium text-slate-500 mb-1.5">
          {title}
          {hint && <span className="text-slate-400 font-normal"> — {hint}</span>}
        </p>
      )}
      <ul className="space-y-2">
        {list.map((r, i) => {
          const v = Number(read(r)) || 0;
          // A caller's formatter must not be able to take the card down.
          let shown;
          try { shown = format(v); } catch { shown = v; }
          const name = asText(r.name);
          return (
            <li
              key={r.key ?? asText(r.name, String(i)) ?? i}
              className="min-w-0 text-[11px] leading-tight"
              /* Hover keeps the detail the row cannot show inline, and falls
                 back to the full name so a truncated label stays readable. */
              title={r.hoverTitle || name}
            >
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="min-w-0 truncate text-slate-600">{name}</span>
                <span className="shrink-0 font-semibold text-slate-800 tabular-nums">
                  {asText(shown, String(v))}
                </span>
              </div>
              <span
                className="mt-1 block h-1 rounded-full bg-slate-100 overflow-hidden"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full bg-primary-400"
                  style={{ width: `${Math.max(2, Math.round((v / max) * 100))}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Funnel-style stand-in for a bar chart's traditional Legend — one chip per
// series, matching `PipelineFunnel`'s label / large value / accent-bar
// stack instead of a swatch-and-text row, so the whole Analytics surface
// reads as one visual language rather than a conventional-legend chart
// sitting beside a funnel-styled one.
//
// Laid out as an EQUAL-WIDTH GRID with every chip centred in its own
// column, not a left-packed flex row: the funnel spaces its stages evenly
// across the plot and centres each label over the data it describes, and a
// legend bunched at the left edge visibly does not belong to the chart
// underneath it. `offsetLeft` shifts the whole strip past the y-axis
// gutter so column centres line up with the plotting area rather than with
// the chart element's outer box — pass the chart's y-axis width plus its
// left margin. It is capped and drops out entirely on a narrow viewport,
// where surrendering that much width to a gutter would squash the chips.
//
// `raw` is the numeric value used to pick the leading series, which is
// rendered in the emphasised JTC style (solid accent, darker value) exactly
// as the funnel marks its own leading stage; the rest keep a muted accent.
// It is separate from `value` because `value` is already display-formatted
// (KWD strings, thousands separators) and cannot be compared numerically.
// `activeKey` / `onHover` make the chips and the bars ONE interactive unit,
// mirroring `PipelineFunnel`: hovering a bar emphasises its chip, hovering a
// chip emphasises the bar (the chart dims its other series via
// `.jtc-series-dim`), and leaving either clears both. Hover therefore always
// wins over the resting leader emphasis — otherwise two things would look
// "selected" at once.
function BarLegendChips({ items, offsetLeft = 0, activeKey = null, onHover }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const isMobile = useIsMobile();
  if (!list.length) return null;

  const numeric = list
    .map(it => (Number.isFinite(Number(it.raw)) ? Number(it.raw) : null))
    .filter(v => v !== null);
  const leader = numeric.length ? Math.max(...numeric) : null;
  // Every series at zero has no meaningful leader — emphasising an
  // arbitrary one of several zeroes would be inventing a ranking.
  const hasLeader = leader !== null && leader > 0;

  const pad = isMobile ? 0 : Math.max(0, Math.min(96, Number(offsetLeft) || 0));
  const hovering = activeKey != null;

  return (
    <div
      className="grid gap-x-2 gap-y-1 mb-2"
      style={{
        gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`,
        paddingLeft: pad || undefined,
      }}
    >
      {list.map((it) => {
        // While anything is hovered, exactly that one is emphasised; at
        // rest, the leading series is.
        const isActive = hovering
          ? it.key === activeKey
          : (hasLeader && Number(it.raw) === leader);
        const dimmed = hovering && it.key !== activeKey;
        return (
          <div
            key={it.key}
            className={clsx(
              'min-w-0 text-center transition-opacity duration-150',
              onHover && 'cursor-default',
              dimmed && 'opacity-45',
            )}
            onMouseEnter={onHover ? () => onHover(it.key) : undefined}
            onMouseLeave={onHover ? () => onHover(null) : undefined}
          >
            <p className={clsx(
              'text-[10px] uppercase tracking-wide truncate transition-colors',
              isActive ? 'text-slate-500' : 'text-slate-400',
            )}>
              {it.label}
            </p>
            <p className={clsx(
              'font-bold leading-tight truncate transition-all',
              isActive ? 'text-base text-slate-900' : 'text-sm text-slate-600',
            )}>
              {it.value}
            </p>
            <span
              aria-hidden="true"
              className="block h-[3px] w-7 rounded-full mt-1 mx-auto transition-opacity"
              style={{ background: it.color, opacity: isActive ? 0.95 : 0.28 }}
            />
          </div>
        );
      })}
    </div>
  );
}

// Shared hover state binding a chart's series to its `BarLegendChips`.
// `barProps(key)` spreads onto a `<Bar>`: it reports hover in, and dims the
// series while a DIFFERENT one is hovered, via a class rather than by
// touching `Bar3D` (which the dashboards also render and must not change).
function useSeriesHover() {
  const [activeKey, setActiveKey] = useState(null);
  const onHover = useCallback((key) => setActiveKey(key ?? null), []);
  const barProps = useCallback((key) => ({
    onMouseEnter: () => setActiveKey(key),
    onMouseLeave: () => setActiveKey(null),
    className: activeKey && activeKey !== key ? 'jtc-series-dim' : undefined,
  }), [activeKey]);
  return { activeKey, onHover, barProps };
}

// Signed percentage delta, rendered with a direction and a tone.
//
// `goodWhen` flips the colour for metrics where down is the good outcome
// (turnaround, maintenance spend) — a green "up 40%" on repair cost
// would be wrong.
//
// When `value` is null / undefined / not-finite (i.e. the fetcher's
// `deltaPct(current, previous)` returned null because previous was 0),
// the display depends on `current`:
//   * `current > 0` → the entity is present now but had nothing in the
//     equivalent prior period. Rendered as "new", not "no baseline",
//     because "no baseline" reads as an error while "new" is the actual
//     business meaning.
//   * otherwise → "—" (truly empty, no useful comparison to state).
//
// `compareTitle` is an optional hover string like "Aug 1–14 vs Jul 1–14"
// that spells out which two periods are being compared. Passed in by
// callers that have `meta` in scope; falls back to a generic label.
function Delta({ value, current, goodWhen = 'up', suffix = '', compareTitle }) {
  const nullish = value === null || value === undefined || !Number.isFinite(value);
  if (nullish) {
    if (Number.isFinite(Number(current)) && Number(current) > 0) {
      return (
        <span
          className="text-emerald-600 font-medium"
          title={compareTitle
            ? `New this period — no activity in ${compareTitle.split(' vs ')[1] ?? 'the previous period'}.`
            : 'New this period — no activity in the previous period.'}
        >
          new
        </span>
      );
    }
    return (
      <span
        className="text-slate-400"
        title={compareTitle ?? 'No comparable prior period.'}
      >
        —
      </span>
    );
  }
  const good = value === 0 ? null : (goodWhen === 'up' ? value > 0 : value < 0);
  return (
    <span
      className={clsx(
        good === null ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-rose-600',
      )}
      title={compareTitle ?? undefined}
    >
      {value > 0 ? '▲' : value < 0 ? '▼' : '·'} {Math.abs(value)}%{suffix}
    </span>
  );
}

// Build a human "this vs previous" hover string from the section's meta.
// Same source of truth every tile / row uses, so a section's Delta
// tooltips and its subtitle can never disagree about which windows are
// being compared.
function compareLabel(meta) {
  const m = meta ?? {};
  if (m.allTime) return 'All recorded activity (no prior period)';
  const from = m.fromDate;
  const to   = m.toDate;
  if (!from || !to) return null;
  // Same rule as resolvePrevWindow: month-aligned + within one calendar
  // month → previous calendar month same days; else equal-length before.
  const fromD = new Date(`${from}T00:00:00`);
  const toD   = new Date(`${to}T00:00:00`);
  if (!Number.isFinite(fromD.getTime()) || !Number.isFinite(toD.getTime())) return null;
  const sameMonth =
    fromD.getFullYear() === toD.getFullYear() &&
    fromD.getMonth() === toD.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (fromD.getDate() === 1 && sameMonth) {
    const prevFrom = new Date(fromD.getFullYear(), fromD.getMonth() - 1, 1);
    const lastDayPrev = new Date(prevFrom.getFullYear(), prevFrom.getMonth() + 1, 0).getDate();
    const prevTo = new Date(prevFrom.getFullYear(), prevFrom.getMonth(), Math.min(toD.getDate(), lastDayPrev));
    return `${from} → ${to} vs ${iso(prevFrom)} → ${iso(prevTo)}`;
  }
  const spanDays = Math.max(1, Math.round((toD - fromD) / 86_400_000));
  const prevTo = new Date(fromD.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);
  return `${from} → ${to} vs ${iso(prevFrom)} → ${iso(prevTo)}`;
}

// A section subtitle that reflects the ACTUAL queried period, not a
// hardcoded "Rolling N days" line that lies when the user picked a
// custom range or All time. Reads the same meta fields the fetchers
// stamp on every payload (fromDate/toDate/allTime/explicitRange/
// windowDays), so section header, chart, and analyst brief always agree
// on what period they describe. `suffix` is optional trailing detail
// like " · completed jobs only".
function sectionPeriod(meta, fallbackDays, suffix = '') {
  const m = meta ?? {};
  const days = Number(m.windowDays) || fallbackDays;
  if (m.allTime === true) return `All recorded activity${suffix}`;
  const explicit =
    m.explicitRange === true || m.rangeApplied === true ||
    (!!m.fromDate && !!m.toDate &&
     Number.isFinite(days) && Math.abs(days - fallbackDays) > 0);
  if (explicit && m.fromDate && m.toDate) {
    return `${m.fromDate} → ${m.toDate}${suffix}`;
  }
  return `Rolling ${days} days${suffix}`;
}

// A subtitle line stating how far the analysis can be trusted, from the
// `meta.confidence` the API derives. Rendered under a section's header row so
// the reader meets it before the numbers rather than after them.
function ConfidenceNote({ confidence, comparedTo }) {
  if (!confidence?.level) return null;
  return (
    <p className="text-[10px] text-slate-400 leading-relaxed">
      <span className="font-medium text-slate-500">{confidence.level} confidence</span>
      {confidence.reason ? ` · ${confidence.reason}` : ''}
      {comparedTo ? ` Compared against the ${comparedTo}.` : ''}
    </p>
  );
}

// ── 4.1 Most rented equipment ────────────────────────────────────────────

export function MostRentedSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('most_rented', params);
  const q = useAnalytics('most_rented', effectiveParams);
  const d = q.data;
  const [openKey, setOpenKey] = useState(null);
  const [drillUnit, setDrillUnit] = useState(null); // { equipment_id, label } or null
  const { yAxisWidth, labelMax } = useHorizontalBarAxis();

  const byType = d?.breakdowns?.byType;
  // Recharts draws top-to-bottom, so a descending ranking has to be reversed
  // for the bars to read downward. Same pattern as every other ranking here.
  const chartRows = useMemo(
    () => [...(byType ?? [])].slice(0, 8)
      .map(r => ({ ...r, axis: axisLabel(r.name, labelMax) }))
      .reverse(),
    [byType, labelMax],
  );

  const toggle = useCallback((key) => {
    setOpenKey(prev => (prev === key ? null : key));
  }, []);

  // The window is no longer always "rolling": a chosen date range has real
  // edges, and the subtitle has to say which period the numbers came from or
  // the card silently contradicts the filter above it.
  const meta = d?.meta ?? {};
  const period = meta.allTime
    ? 'All time'
    : meta.fromDate && meta.toDate
      ? `${meta.fromDate} to ${meta.toDate}`
      : `Rolling ${meta.windowDays ?? 30} days`;
  const sourceNote = meta.source === 'quotations'
    ? ' · from quotation lines (no dispatches in this period)'
    : '';

  return (
    <SectionCard
      title="Most rented equipment"
      subtitle={`${period}${sourceNote}`}
      icon={Package}
      {...q}
      hasData={(r) => Number(r?.kpis?.totalRentals) > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={<CardResetButton onClick={() => setCardRange(DEFAULT_RANGE)} disabled={q.isLoading} />}
      /* When there genuinely is nothing, say what the database DOES hold and
         what to do about it, rather than the generic "insufficient data" that
         gave the reader no next step. */
      emptyMessage={meta.emptyReason
        ?? 'No rentals recorded in this period. Try a wider date range.'}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Top type"
              value={d.kpis.topName ?? '—'}
              sub={`${d.kpis.topRentals} rentals · ${d.kpis.topSharePct}%`}
              title={byType?.[0]?.type_id ? `Type ID ${byType[0].type_id}` : undefined}
            />
            <Kpi
              label="Total rentals"
              value={d.kpis.totalRentals}
              sub={<Delta value={d.kpis.rentalsDeltaPct} />}
            />
            <Kpi
              label="Busiest unit"
              value={d.kpis.busiestUnitLabel ?? '—'}
              sub={`${d.kpis.busiestUnitRentals} dispatches`}
              /* The unit id is hover-only, per the names-in-the-UI rule. */
              title={d.kpis.busiestUnitId ? `Unit ${d.kpis.busiestUnitId}` : undefined}
            />
            {/* Concentration is the portfolio-level risk question — how much
                of the period rides on the biggest few lines — where the tile
                to the left answers it for a single line only. `avgPerUnit`
                moved out of this sub-line to make room; it is still in the
                payload and the template still reads it. */}
            <Kpi
              label="Fleet spread"
              value={`${d.kpis.distinctTypes} type${d.kpis.distinctTypes === 1 ? '' : 's'}`}
              sub={d.kpis.top3Count > 0
                ? `Top ${d.kpis.top3Count} = ${d.kpis.top3SharePct}% · ${d.kpis.distinctUnits} units`
                : `${d.kpis.distinctUnits} units · ${d.kpis.avgPerUnit} each`}
              title={d.kpis.top3Names?.length
                ? `Top ${d.kpis.top3Count}: ${d.kpis.top3Names.join(', ')}`
                : undefined}
            />
          </div>

          <TrendCompare
            data={d.series?.compare}
            title={`Rental volume vs the previous ${d.meta?.windowDays ?? 30} days`}
            resetKey={cardRange}
          />

          {chartRows.length > 0 && (
            <ChartAnim animKey={q.dataUpdatedAt} bars="horizontal" style={{ height: Math.max(140, chartRows.length * 30 + 24) }}>
              <ResponsiveContainer>
                <BarChart data={chartRows} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  {/* Equipment NAME on the axis — never the type id. */}
                  <YAxis type="category" dataKey="axis" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={false}
                    content={
                      <NamedTooltip
                        idOf={(r) => (r.type_id ? `Type ID: ${r.type_id}` : null)}
                        subtitleOf={(r) => r.category}
                        rows={(r) => [
                          { label: 'Rentals', value: r.rentals },
                          { label: 'Total rental days', value: r.total_days != null ? `${r.total_days}d` : '—' },
                          { label: 'Share of volume', value: `${r.sharePct}%` },
                          { label: 'Units dispatched', value: r.unitsUsed },
                          { label: 'Previous period', value: r.prevRentals },
                          {
                            label: 'vs previous',
                            value: r.trendPct === null
                              ? (Number(r.rentals ?? r.quantity ?? 0) > 0 ? 'new this period' : '—')
                              : `${r.trendPct >= 0 ? '+' : ''}${r.trendPct}%`,
                          },
                          { label: 'Last dispatched', value: dateShort(r.lastDispatchAt) ?? '—' },
                        ]}
                      />
                    }
                  />
                  <Bar dataKey="rentals" shape={Bar3D} isAnimationActive={false}>
                    {chartRows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartAnim>
          )}

          {/* Drill-down: names and headline metrics collapsed, identifiers
              and period comparison on expand. */}
          {byType?.length > 0 && (
            <ul className="space-y-1.5">
              {byType.slice(0, 8).map((r, i) => (
                <RankRow
                  key={r.type_id ?? r.name}
                  rank={i + 1}
                  label={r.name}
                  metrics={`${r.rentals} rental${r.rentals === 1 ? '' : 's'}${r.total_days > 0 ? ` · ${r.total_days}d total` : ''} · ${r.sharePct}% of volume · ${r.unitsUsed} unit${r.unitsUsed === 1 ? '' : 's'}${r.trendPct !== null ? ` · ${r.trendPct >= 0 ? '+' : ''}${r.trendPct}% vs prev` : ''}`}
                  expanded={openKey === (r.type_id ?? r.name)}
                  onToggle={() => toggle(r.type_id ?? r.name)}
                  detail={
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                      <Detail label="Rentals" value={r.rentals} />
                      <Detail label="Total rental days" value={r.total_days != null ? `${r.total_days}d` : '—'} />
                      <Detail label="Previous period" value={r.prevRentals} />
                      <Detail label="Change" value={r.trendPct === null ? 'No baseline' : `${r.trendPct >= 0 ? '+' : ''}${r.trendPct}%`} />
                      <Detail label="Share of volume" value={`${r.sharePct}%`} />
                      <Detail label="Units dispatched" value={r.unitsUsed} />
                      <Detail label="Last dispatched" value={dateShort(r.lastDispatchAt) ?? '—'} />
                      <Detail label="Category" value={r.category ?? '—'} />
                      {/* The one place the identifier is shown. */}
                      <Detail label="Type ID" value={r.type_id ?? '—'} />
                    </div>
                  }
                />
              ))}
            </ul>
          )}

          <MiniBars
            title="Where it went"
            rows={d.breakdowns?.byDestination}
            hint="dispatches by destination"
          />

          {/* Fleet/rental drill-down: the specific units behind the type
              ranking above — click one for its individual dispatch/rental
              history. */}
          {d.breakdowns?.byUnit?.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Top rented units
                <span className="text-slate-400 font-normal"> — click a unit for its rental history</span>
              </p>
              <ul className="space-y-1.5">
                {d.breakdowns.byUnit.slice(0, 6).map((u) => (
                  <li key={u.equipment_id}>
                    <button
                      type="button"
                      onClick={() => setDrillUnit({ equipment_id: u.equipment_id, label: u.label })}
                      className="w-full text-left neo-inset px-3 py-2 hover:bg-white/60 transition-colors rounded-xl group flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0" title={u.equipment_id}>
                        <p className="text-[11px] font-semibold text-slate-800 truncate">{u.label}</p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {u.type_name}{u.location ? ` · ${u.location}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-slate-800">
                          {u.rentals} rental{u.rentals === 1 ? '' : 's'}
                        </span>
                        <ChevronRight size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {/* Expands in place, directly under the unit that was clicked,
                  so the ranking it came from stays on screen. */}
              {drillUnit && (
                <div className="mt-2">
                  <RentalRecordsPanel
                    params={effectiveParams}
                    equipmentId={drillUnit.equipment_id}
                    unitLabelText={drillUnit.label}
                    onClose={() => setDrillUnit(null)}
                  />
                </div>
              )}
            </div>
          )}

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="most_rented" result={d} template={tmpl_mostRentedEquipment} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.2 Most procured equipment ──────────────────────────────────────────

const PROC_SORTS = [
  { key: 'spend',    label: 'Spend',    get: r => r.spend },
  { key: 'quantity', label: 'Quantity', get: r => r.quantity },
  { key: 'avgUnit',  label: 'Avg cost', get: r => r.avgUnitCost },
];

export function MostProcuredSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('most_procured', params);
  const q = useAnalytics('most_procured', effectiveParams);
  const d = q.data;
  const [sortKey, setSortKey] = useState('spend');
  const [openKey, setOpenKey] = useState(null);
  const [drillEquipment, setDrillEquipment] = useState(null); // ranked row or null
  const [drillSupplier, setDrillSupplier] = useState(null); // {vendor_id, name} or null
  const { yAxisWidth, labelMax } = useHorizontalBarAxis();
  // Purely local zoom on the already-fetched monthly series — see useLocalZoom.
  const monthlyZoom = useLocalZoom(d?.series?.byMonth, 'month', cardRange);

  // Sorted client-side so switching the ranking basis is instant and never
  // re-queries — the whole ranking is already in memory. The `?? []` lives
  // inside the memo because a fresh literal in the dependency array would
  // defeat it on every render.
  const byEquipment = d?.breakdowns?.byEquipment;
  const ranked = useMemo(() => {
    const get = (PROC_SORTS.find(s => s.key === sortKey) ?? PROC_SORTS[0]).get;
    return [...(byEquipment ?? [])].sort((a, b) => (get(b) ?? 0) - (get(a) ?? 0));
  }, [byEquipment, sortKey]);

  // Recharts renders top-to-bottom, so reverse for a descending visual order.
  const chartRows = useMemo(
    () => ranked.slice(0, 8).map(r => ({ ...r, label: axisLabel(r.name, labelMax) })).reverse(),
    [ranked, labelMax],
  );

  const toggle = useCallback((key) => {
    setOpenKey(prev => (prev === key ? null : key));
  }, []);

  const mixHover = useSeriesHover();
  // Funnel-style chips replacing the monthly mix chart's legend — totals
  // over whatever range is CURRENTLY visible (the full series, or the
  // zoomed-to sub-range), same data the chart itself is already drawing.
  const monthMixChips = useMemo(() => {
    const rows = monthlyZoom.data ?? [];
    const t = { Buy: 0, Lease: 0, Other: 0 };
    for (const row of rows) {
      t.Buy += Number(row.Buy) || 0;
      t.Lease += Number(row.Lease) || 0;
      t.Other += Number(row.Other) || 0;
    }
    return [
      { key: 'Buy', label: 'Buy', value: t.Buy, raw: t.Buy, color: '#EE1C25' },
      { key: 'Lease', label: 'Lease', value: t.Lease, raw: t.Lease, color: '#3b82f6' },
      { key: 'Other', label: 'Other', value: t.Other, raw: t.Other, color: '#94a3b8' },
    ];
  }, [monthlyZoom.data]);

  return (
    <SectionCard
      title="Most procured equipment"
      subtitle={sectionPeriod(d?.meta, 90)}
      icon={ShoppingCart}
      {...q}
      hasData={(r) => r?.kpis?.totalCount > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={(
        <CardResetButton
          onClick={() => { setCardRange(DEFAULT_RANGE); monthlyZoom.hardReset(); }}
          disabled={q.isLoading}
        />
      )}
    >
      {d && (
        <div className="space-y-4">
          {/* The answer to "what are we procuring the most?" is an equipment
              NAME, so it leads the KPI row. The type identifier is hover-only. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Most procured"
              value={d.kpis.topEquipmentName ?? '—'}
              sub={d.kpis.topEquipmentName
                ? `${d.kpis.topEquipmentQty} units · ${d.kpis.topEquipmentSharePct}% of spend`
                : 'No itemised lines'}
              title={ranked[0]?.type_id ? `Type ID ${ranked[0].type_id}` : undefined}
            />
            <Kpi label="Total spend" value={kwd(d.kpis.totalSpend)}
              sub={d.kpis.spendDeltaPct !== null && d.kpis.spendDeltaPct !== undefined
                ? `${d.kpis.spendDeltaPct >= 0 ? '+' : ''}${d.kpis.spendDeltaPct}% vs previous period`
                : 'No prior period'} />
            <Kpi label="Avg deal" value={kwd(d.kpis.avgDealSize)} sub={`${d.kpis.totalCount} procurements`} />
            <Kpi label="Buy share" value={`${d.kpis.buySharePct}%`} sub={`${d.kpis.buyCount} buy · ${d.kpis.leaseCount} lease`} />
          </div>

          {chartRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                <p className="text-[11px] font-medium text-slate-500">Top equipment by {(PROC_SORTS.find(s => s.key === sortKey) ?? PROC_SORTS[0]).label.toLowerCase()}</p>
                <SortToggle options={PROC_SORTS} value={sortKey} onChange={setSortKey} />
              </div>
              <ChartAnim
                animKey={`${q.dataUpdatedAt ?? ''}-${sortKey}`}
                bars="horizontal"
                style={{ height: Math.max(140, chartRows.length * 30 + 24) }}
              >
                <ResponsiveContainer>
                  <BarChart data={chartRows} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    {/* Equipment NAME on the axis — never the type id. */}
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      content={
                        <NamedTooltip
                          idOf={(r) => (r.type_id ? `Type ID: ${r.type_id}` : null)}
                          subtitleOf={(r) => r.category}
                          rows={(r) => [
                            { label: 'Quantity', value: r.quantity },
                            { label: 'Total spend', value: kwd(r.spend) },
                            { label: 'Avg unit cost', value: kwd(r.avgUnitCost) },
                            { label: 'Suppliers', value: r.supplierCount },
                            {
                              label: 'vs previous',
                              value: r.trendPct === null ? 'no baseline'
                                : `${r.trendPct >= 0 ? '+' : ''}${r.trendPct}%`,
                            },
                          ]}
                        />
                      }
                    />
                    <Bar
                      dataKey={sortKey === 'quantity' ? 'quantity' : sortKey === 'avgUnit' ? 'avgUnitCost' : 'spend'}
                      shape={Bar3D} isAnimationActive={false}
                      fill="#EE1C25"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          {/* Drill-down ranking. Collapsed rows are names + headline metrics;
              expanding one reveals the identifier and the sourcing detail. */}
          {ranked.length > 0 && (
            <ul className="space-y-1.5">
              {ranked.slice(0, 8).map((r, i) => (
                <RankRow
                  key={r.key}
                  rank={i + 1}
                  label={r.name}
                  metrics={`${r.quantity} unit${r.quantity === 1 ? '' : 's'} · ${kwd(r.spend)} · ${kwd(r.avgUnitCost)} avg${r.trendPct !== null ? ` · ${r.trendPct >= 0 ? '+' : ''}${r.trendPct}% vs prev` : ''}`}
                  expanded={openKey === r.key}
                  onToggle={() => toggle(r.key)}
                  detail={
                    <div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                        <Detail label="Orders" value={r.orders} />
                        <Detail label="Quantity" value={r.quantity} />
                        <Detail label="Total spend" value={kwd(r.spend)} />
                        <Detail label="Avg unit cost" value={kwd(r.avgUnitCost)} />
                        <Detail label="Previous period" value={`${r.prevQuantity} unit${r.prevQuantity === 1 ? '' : 's'}`} />
                        <Detail label="Last ordered" value={dateShort(r.lastOrderedAt) ?? '—'} />
                        <Detail
                          label={`Supplier${r.supplierCount === 1 ? '' : 's'} (${r.supplierCount})`}
                          value={r.suppliers?.length ? r.suppliers.join(', ') : 'Not recorded'}
                        />
                        <Detail label="Category" value={r.category ?? '—'} />
                        {/* The one place the identifier is shown. */}
                        <Detail label="Type ID" value={r.type_id ?? '—'} />
                      </div>
                      <button
                        type="button"
                        onClick={() => setDrillEquipment(r)}
                        className="mt-2 text-[10px] font-medium text-primary-600 hover:text-primary-800 underline underline-offset-2"
                      >
                        View procurement orders →
                      </button>
                    </div>
                  }
                />
              ))}
            </ul>
          )}

          {/* Inline, immediately below the ranking it was opened from. */}
          {drillEquipment && (
            <ProcurementRecordsPanel
              params={effectiveParams}
              typeId={drillEquipment.type_id}
              description={drillEquipment.type_id ? null : drillEquipment.name}
              name={drillEquipment.name}
              onClose={() => setDrillEquipment(null)}
            />
          )}

          {d.breakdowns?.bySupplier?.length ? (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Supplier contribution
                {d.kpis.topSupplierName && (
                  <span className="text-slate-400 font-normal">
                    {' '}— {d.kpis.topSupplierName} leads with {d.kpis.topSupplierSharePct}%
                  </span>
                )}
                <span className="text-slate-400 font-normal"> — click a supplier for its transactions</span>
              </p>
              <ul className="space-y-1">
                {d.breakdowns.bySupplier.slice(0, 5).map(s => (
                  <li key={s.name}>
                    <button
                      type="button"
                      onClick={() => setDrillSupplier(s)}
                      className="w-full flex items-center gap-2 text-[11px] py-1 rounded hover:bg-slate-50 transition-colors text-left"
                      title={[s.vendor_id && `Vendor ID ${s.vendor_id}`, s.equipment.length && s.equipment.join(', ')]
                        .filter(Boolean).join(' · ')}
                    >
                      <span className="flex-1 min-w-0 truncate text-slate-700">{s.name}</span>
                      <span className="shrink-0 text-slate-400">{s.orders} order{s.orders === 1 ? '' : 's'}</span>
                      <span className="shrink-0 w-20 text-right font-medium text-slate-800">{kwd(s.spend)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {drillSupplier && (
                <div className="mt-2">
                  <SupplierTransactionsPanel
                    params={effectiveParams}
                    vendorId={drillSupplier.vendor_id}
                    vendorName={drillSupplier.name}
                    onClose={() => setDrillSupplier(null)}
                  />
                </div>
              )}
            </div>
          ) : null}

          {d.series?.byMonth?.length ? (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Monthly procurement mix
                <span className="text-slate-400 font-normal"> — drag to zoom</span>
              </p>
              <ZoomBanner
                active={!!monthlyZoom.zoomDomain}
                fromDate={monthLabel(monthlyZoom.zoomDomain?.from)}
                toDate={monthLabel(monthlyZoom.zoomDomain?.to)}
                onReset={monthlyZoom.resetZoom}
              />
              <BarLegendChips items={monthMixChips} offsetLeft={72} activeKey={mixHover.activeKey} onHover={mixHover.onHover} />
              <ChartAnim
                animKey={monthlyZoom.animKey}
                bars="vertical"
                className="h-44 select-none"
                style={{ touchAction: 'none' }}
              >
                <ResponsiveContainer>
                  <BarChart data={monthlyZoom.data} margin={{ left: 12, right: 8 }} {...monthlyZoom.zoomDrag.handlers}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} cursor={false} />
                    <Bar dataKey="Buy"   stackId="a" fill="#EE1C25" shape={Bar3D} isAnimationActive={false} {...mixHover.barProps('Buy')} />
                    <Bar dataKey="Lease" stackId="a" fill="#3b82f6" shape={Bar3D} isAnimationActive={false} {...mixHover.barProps('Lease')} />
                    <Bar dataKey="Other" stackId="a" fill="#94a3b8" shape={Bar3D} isAnimationActive={false} {...mixHover.barProps('Other')} />
                    {(monthlyZoom.zoomDrag.drag || monthlyZoom.highlightRange) && (
                      <ReferenceArea
                        x1={monthlyZoom.zoomDrag.drag?.startLabel ?? monthlyZoom.highlightRange[0]}
                        x2={monthlyZoom.zoomDrag.drag?.endLabel ?? monthlyZoom.highlightRange[1]}
                        strokeOpacity={0.3}
                        fill="#EE1C25"
                        fillOpacity={0.12}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          ) : null}

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="most_procured" result={d} template={tmpl_mostProcuredEquipment} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.3 Recent leases ────────────────────────────────────────────────────

export function RecentLeasesSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('recent_leases', params);
  const q = useAnalytics('recent_leases', effectiveParams);
  const d = q.data;
  const [openKey, setOpenKey] = useState(null);

  const toggle = useCallback((key) => {
    setOpenKey(prev => (prev === key ? null : key));
  }, []);

  return (
    <SectionCard
      title="Recent lease activity"
      subtitle={sectionPeriod(d?.meta, 30, ' · active book and renewal runway')}
      icon={Calendar}
      {...q}
      hasData={(r) => (r?.kpis?.newLeases > 0) || (r?.kpis?.activeLeases > 0)}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={<CardResetButton onClick={() => setCardRange(DEFAULT_RANGE)} disabled={q.isLoading} />}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="New leases"
              value={d.kpis.newLeases}
              sub={<Delta value={d.kpis.newLeasesDeltaPct} />}
            />
            <Kpi
              label="New monthly commit"
              value={kwd(d.kpis.monthlyCommit)}
              sub={`Avg term ${d.kpis.avgTermDays}d`}
            />
            <Kpi
              label="Active lease book"
              value={kwd(d.kpis.activeMonthlyCommit)}
              sub={`${d.kpis.activeLeases} unit${d.kpis.activeLeases === 1 ? '' : 's'} on lease`}
            />
            <Kpi
              label="At risk ≤30d"
              value={kwd(d.kpis.monthlyAtRisk30)}
              sub={`${d.kpis.expiring30} lease${d.kpis.expiring30 === 1 ? '' : 's'} · ${d.kpis.atRiskSharePct}% of book`}
            />
          </div>

          {d.series?.expiryBuckets?.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Renewal runway
                <span className="text-slate-400 font-normal"> — monthly income by expiry horizon</span>
              </p>
              <ChartAnim animKey={q.dataUpdatedAt} bars="vertical" className="h-40">
                <ResponsiveContainer>
                  <BarChart data={d.series.expiryBuckets} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} width={48} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={NEO_TOOLTIP_STYLE}
                      cursor={false}
                      formatter={(v, k) => (k === 'monthly' ? [kwd(v), 'Monthly income'] : [v, 'Units'])}
                    />
                    <Bar dataKey="monthly" shape={Bar3D} isAnimationActive={false} radius={[4, 4, 0, 0]}>
                      {d.series.expiryBuckets.map((r, i) => (
                        <Cell
                          key={i}
                          /* The nearest horizon is the one that needs acting
                             on, so it is the one that reads as urgent. */
                          fill={r.bucket === '≤30d' ? '#EE1C25' : r.bucket === '31–60d' ? '#f59e0b' : '#94a3b8'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          <div>
            <h4 className="text-xs uppercase tracking-wide text-slate-400 mb-2">
              Expiring soon
              {d.kpis.expiredCount > 0 && (
                <span className="ml-1.5 text-[10px] normal-case text-primary-600 font-semibold">
                  {d.kpis.expiredCount} already past the end date
                </span>
              )}
            </h4>
            {d.breakdowns.expiringSoon?.length ? (
              <ul className="space-y-1.5">
                {d.breakdowns.expiringSoon.map((u, i) => (
                  <RankRow
                    key={u.equipment_id}
                    rank={i + 1}
                    /* Equipment NAME leads; the unit id is in the drill-down
                       below, never on the row itself. */
                    label={u.label}
                    metrics={`${u.daysToExpiry != null && u.daysToExpiry < 0
                      ? `${Math.abs(u.daysToExpiry)}d overdue`
                      : `expires in ${u.daysToExpiry ?? '—'}d`} · ${kwd(u.monthly)}/mo${u.lease_end_date ? ` · ends ${dateShort(u.lease_end_date)}` : ''}`}
                    expanded={openKey === u.equipment_id}
                    onToggle={() => toggle(u.equipment_id)}
                    detail={
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                        <Detail label="Equipment type" value={u.type_name} />
                        <Detail label="Monthly rate" value={kwd(u.monthly)} />
                        <Detail label="Lease start" value={dateShort(u.lease_start_date) ?? '—'} />
                        <Detail label="Lease end" value={dateShort(u.lease_end_date) ?? '—'} />
                        <Detail label="Term" value={u.termDays != null ? `${u.termDays} days` : '—'} />
                        <Detail
                          label="Days to expiry"
                          value={u.daysToExpiry == null ? '—'
                            : u.daysToExpiry < 0 ? `${Math.abs(u.daysToExpiry)} days overdue`
                              : `${u.daysToExpiry} days`}
                        />
                        <Detail label="Location" value={u.location ?? '—'} />
                        <Detail label="Category" value={u.category ?? '—'} />
                        {/* Identifiers, drill-down only. */}
                        <Detail label="Unit ID" value={u.equipment_id} />
                        <Detail label="Serial number" value={u.serial_number ?? '—'} />
                      </div>
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400 italic">No leases expiring in the next 30 days.</p>
            )}
          </div>

          <MiniBars
            title="Lease book by equipment line"
            rows={d.breakdowns?.byType}
            pickValue={(r) => r.monthly}
            format={(v) => kwd(v)}
            hint="monthly commitment"
          />

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="recent_leases" result={d} template={tmpl_recentLeases} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.4 Maintenance frequency ────────────────────────────────────────────

const MAINT_SORTS = [
  { key: 'effort',   label: 'Effort',   get: r => r.effort,        bar: 'effort' },
  { key: 'jobs',     label: 'Visits',   get: r => r.jobs,          bar: 'jobs' },
  { key: 'downtime', label: 'Downtime', get: r => r.downtime_days, bar: 'downtime_days' },
  { key: 'cost',     label: 'Cost',     get: r => r.total_cost,    bar: 'total_cost' },
];

export function MaintenanceFrequencySection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('maintenance_frequency', params);
  const q = useAnalytics('maintenance_frequency', effectiveParams);
  const d = q.data;
  const [sortKey, setSortKey] = useState('effort');
  const [openKey, setOpenKey] = useState(null);
  const [drillUnit, setDrillUnit] = useState(null); // {equipment_id, label} or null
  const { yAxisWidth, labelMax } = useHorizontalBarAxis();

  const topUnits = d?.breakdowns?.topUnits;
  const active = MAINT_SORTS.find(s => s.key === sortKey) ?? MAINT_SORTS[0];
  // Same reason as the procurement ranking: the empty-array fallback belongs
  // inside the memo, not in its dependency list.
  const ranked = useMemo(
    () => [...(topUnits ?? [])].sort((a, b) => (active.get(b) ?? 0) - (active.get(a) ?? 0)),
    [topUnits, active],
  );
  const chartRows = useMemo(
    () => ranked.slice(0, 8).map(u => ({ ...u, label: axisLabel(u.label, labelMax) })).reverse(),
    [ranked, labelMax],
  );

  const toggle = useCallback((key) => {
    setOpenKey(prev => (prev === key ? null : key));
  }, []);

  const top = ranked[0];

  return (
    <SectionCard
      title="Highest maintenance load"
      subtitle={sectionPeriod(d?.meta, 180, ' · ranked by maintenance effort')}
      icon={Wrench}
      {...q}
      hasData={(r) => r?.kpis?.totalJobs > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={<CardResetButton onClick={() => setCardRange(DEFAULT_RANGE)} disabled={q.isLoading} />}
    >
      {d && (
        <div className="space-y-4">
          {/* Equipment NAME leads; the unit id is the tile's hover title. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Heaviest load"
              value={d.kpis.topUnitLabel ?? '—'}
              sub={`${d.kpis.topUnitJobs} visits · ${d.kpis.topUnitDowntime}d down`}
              title={d.kpis.topUnitId ? `Unit ${d.kpis.topUnitId}` : undefined}
            />
            <Kpi
              label="Avg repair interval"
              value={d.kpis.topUnitIntervalDays != null ? `${d.kpis.topUnitIntervalDays}d` : '—'}
              sub={d.kpis.topUnitLastService ? `Last ${dateShort(d.kpis.topUnitLastService)}` : 'Single visit'}
            />
            <Kpi label="Fleet downtime" value={`${d.kpis.totalDowntimeDays}d`} sub={`${d.kpis.unitsInvolved} units involved`} />
            <Kpi label="Total jobs" value={d.kpis.totalJobs} sub={`${d.kpis.openCount} open · ${kwd(d.kpis.avgCostPerJob)} avg`} />
          </div>

          {chartRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                <p className="text-[11px] font-medium text-slate-500">
                  Top units by {active.label.toLowerCase()}
                </p>
                <SortToggle options={MAINT_SORTS} value={sortKey} onChange={setSortKey} />
              </div>
              <ChartAnim
                animKey={`${q.dataUpdatedAt ?? ''}-${sortKey}`}
                bars="horizontal"
                style={{ height: Math.max(140, chartRows.length * 30 + 24) }}
              >
                <ResponsiveContainer>
                  <BarChart data={chartRows} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    {/* Human-readable unit label, not equipment_id. */}
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      content={
                        <NamedTooltip
                          idOf={(r) => [r.equipment_id && `Unit: ${r.equipment_id}`, r.serial_number && `S/N: ${r.serial_number}`]
                            .filter(Boolean).join('  ·  ') || null}
                          subtitleOf={(r) => [r.type_name, r.location].filter(Boolean).join(' · ')}
                          rows={(r) => [
                            { label: 'Maintenance count', value: r.jobs },
                            { label: 'Total downtime', value: `${r.downtime_days} days` },
                            { label: 'Maintenance cost', value: kwd(r.total_cost) },
                            { label: 'Cost vs revenue', value: r.maint_cost_pct != null ? `${r.maint_cost_pct}%` : '—' },
                            { label: 'Avg repair interval', value: r.avg_interval_days != null ? `${r.avg_interval_days} days` : 'single visit' },
                            { label: 'Last maintenance', value: dateShort(r.last_service) ?? '—' },
                            { label: 'Effort score', value: `${r.effort}/100` },
                          ]}
                        />
                      }
                    />
                    <Bar dataKey={active.bar} shape={Bar3D} isAnimationActive={false} fill="#EE1C25" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
              <p className="text-[10px] text-slate-400 mt-1">
                Effort blends visit count (40%), downtime (35%) and cost (25%), each scaled
                against the heaviest unit in this window.
              </p>
            </div>
          )}

          {ranked.length > 0 && (
            <ul className="space-y-1.5">
              {ranked.slice(0, 8).map((u, i) => (
                <RankRow
                  key={u.equipment_id}
                  rank={i + 1}
                  label={u.label}
                  metrics={`${u.jobs} visit${u.jobs === 1 ? '' : 's'} · ${u.downtime_days}d down · ${kwd(u.total_cost)}${u.maint_cost_pct != null ? ` · ${u.maint_cost_pct}% of rev` : ''}${u.avg_interval_days != null ? ` · every ${u.avg_interval_days}d` : ''}`}
                  expanded={openKey === u.equipment_id}
                  onToggle={() => toggle(u.equipment_id)}
                  detail={
                    <div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                        <Detail label="Maintenance count" value={u.jobs} />
                        <Detail label="Total downtime" value={`${u.downtime_days} days`} />
                        <Detail label="Maintenance cost" value={kwd(u.total_cost)} />
                        <Detail label="Revenue in period" value={u.revenue_kwd != null ? kwd(u.revenue_kwd) : '—'} />
                        <Detail label="Cost of revenue %" value={u.maint_cost_pct != null ? `${u.maint_cost_pct}%` : '—'} />
                        <Detail label="Avg cost / visit" value={kwd(u.avg_cost)} />
                        <Detail label="Avg repair interval" value={u.avg_interval_days != null ? `${u.avg_interval_days} days` : 'Single visit'} />
                        <Detail label="Last maintenance" value={dateShort(u.last_service) ?? '—'} />
                        <Detail label="Days since last" value={u.days_since_last != null ? `${u.days_since_last} days` : '—'} />
                        <Detail label="Open jobs" value={u.open_jobs} />
                        <Detail label="Effort score" value={`${u.effort}/100`} />
                        <Detail label="Equipment type" value={u.type_name} />
                        <Detail label="Location" value={u.location ?? '—'} />
                        {/* Identifiers, shown only in the drill-down. */}
                        <Detail label="Unit ID" value={u.equipment_id} />
                        <Detail label="Serial number" value={u.serial_number ?? '—'} />
                      </div>
                      <button
                        type="button"
                        onClick={() => setDrillUnit({ equipment_id: u.equipment_id, label: u.label })}
                        className="mt-2 text-[10px] font-medium text-primary-600 hover:text-primary-800 underline underline-offset-2"
                      >
                        View maintenance records →
                      </button>
                    </div>
                  }
                />
              ))}
            </ul>
          )}

          {drillUnit && (
            <MaintRecordsPanel
              params={effectiveParams}
              equipmentId={drillUnit.equipment_id}
              unitLabelText={drillUnit.label}
              onClose={() => setDrillUnit(null)}
            />
          )}

          {top && d.breakdowns?.byIssueType?.length > 0 && (
            <p className="text-[10px] text-slate-400">
              Most common failure mode: <span className="text-slate-600 font-medium">{d.breakdowns.byIssueType[0].name}</span>
              {' '}({d.breakdowns.byIssueType[0].value} of {d.kpis.totalJobs} jobs)
            </p>
          )}

          <ConfidenceNote confidence={d.meta?.confidence} />
          <Analysis sectionKey="maintenance_frequency" result={d} template={tmpl_maintenanceFrequency} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.5 Dispatch trends ──────────────────────────────────────────────────

export function DispatchTrendsSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('dispatch_trends', params);
  const q = useAnalytics('dispatch_trends', effectiveParams);
  const d = q.data;
  // Purely local zoom on the already-fetched series — see useLocalZoom.
  const dailyZoom = useLocalZoom(d?.series?.daily, 'day', cardRange);
  // Summarises whatever is CURRENTLY VISIBLE in the chart — the full series
  // normally, or the dragged-to sub-range once zoomed — so the zoom banner
  // can describe the selected range instead of just naming its edges.
  const rangeSummary = useMemo(() => summarizeDailyRange(dailyZoom.data), [dailyZoom.data]);
  // A chosen date range has real edges, so the subtitle states the period the
  // numbers came from rather than describing every window as "rolling".
  const meta = d?.meta ?? {};
  const period = meta.allTime
    ? 'All time'
    : meta.fromDate && meta.toDate
      ? `${meta.fromDate} to ${meta.toDate}`
      : `Rolling ${meta.windowDays ?? 90} days`;
  // Dispatches raised without a rental start date carry no `dispatch_date`;
  // they are dated by when the record was created, and that is disclosed
  // rather than quietly folded in.
  const undatedNote = meta.undatedCount > 0
    ? ` · ${meta.undatedCount} dated by record creation`
    : '';

  return (
    <SectionCard
      title="Dispatch trends"
      subtitle={`${period}${undatedNote}`}
      icon={Truck}
      {...q}
      hasData={(r) => Number(r?.kpis?.totalDispatches) > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={(
        <CardResetButton
          onClick={() => { setCardRange(DEFAULT_RANGE); dailyZoom.hardReset(); }}
          disabled={q.isLoading}
        />
      )}
      emptyMessage={meta.emptyReason
        ?? 'No dispatches recorded in this period. Try a wider date range.'}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Dispatches"
              value={d.kpis.totalDispatches}
              sub={<Delta value={d.kpis.dispatchesDeltaPct} />}
            />
            <Kpi
              label="Daily avg"
              value={d.kpis.dailyAvg.toFixed(1)}
              sub={d.kpis.busiestDay ? `Peak ${d.kpis.busiestDayCount} on ${dateShort(d.kpis.busiestDay)}` : undefined}
            />
            <Kpi
              label="Avg turnaround"
              value={`${d.kpis.avgTurnaroundDays.toFixed(1)}d`}
              /* Down is the good direction for turnaround. */
              sub={<Delta value={d.kpis.turnaroundDeltaPct} goodWhen="down" />}
            />
            <Kpi
              label="Backlog"
              value={d.kpis.pendingBacklog}
              sub={d.kpis.backlogVsDailyAvg != null ? `${d.kpis.backlogVsDailyAvg}× daily rate` : undefined}
            />
          </div>

          <TrendCompare
            data={d.series?.compare}
            title={`Dispatch volume vs the previous ${d.meta?.windowDays ?? 90} days`}
            resetKey={cardRange}
          />

          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">
              Daily dispatch volume
              <span className="text-slate-400 font-normal"> — drag to zoom into a date range</span>
            </p>
            <ZoomBanner
              active={!!dailyZoom.zoomDomain}
              fromDate={dateShort(dailyZoom.zoomDomain?.from)}
              toDate={dateShort(dailyZoom.zoomDomain?.to)}
              onReset={dailyZoom.resetZoom}
              detail={rangeSummary && (
                <div className="space-y-0.5">
                  <p>
                    {rangeSummary.days} day{rangeSummary.days === 1 ? '' : 's'}
                    {' · '}{rangeSummary.total} dispatch{rangeSummary.total === 1 ? '' : 'es'}
                    {' · '}{rangeSummary.avgPerDay.toFixed(1)}/day avg
                    {rangeSummary.peakDay && (
                      <> · peak {rangeSummary.peakCount} on {dateShort(rangeSummary.peakDay)}</>
                    )}
                  </p>
                  {rangeSummary.statusBreakdown.length > 0 && (
                    <p className="text-primary-600">
                      {rangeSummary.statusBreakdown
                        .map(([status, count]) => `${count} ${status}`)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              )}
            />
            {/* `touchAction: 'none'` stops the browser turning a drag-to-zoom
                touch gesture into a page scroll — the trade a draggable chart
                embedded in a scrollable page always makes; the page still
                scrolls normally from just outside the chart's bounds. */}
            <ChartAnim
              animKey={dailyZoom.animKey}
              variant="draw"
              className="h-44 select-none"
              style={{ touchAction: 'none' }}
            >
              <ResponsiveContainer>
                <LineChart data={dailyZoom.data} margin={{ left: 8, right: 8 }} {...dailyZoom.zoomDrag.handlers}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="day" tick={{ fontSize: 9 }} minTickGap={30} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  {/* Per-status counts (Completed/Pending/Assigned/…) are
                      already computed into every `daily` row to build
                      `total` — surfacing them here is free, no new data. */}
                  <Tooltip
                    content={
                      <NamedTooltip
                        titleOf={(r) => dateShort(r.day) ?? r.day}
                        rows={(r) => {
                          const statusKeys = Object.keys(r ?? {}).filter((k) => k !== 'day' && k !== 'total');
                          return [
                            { label: 'Total', value: r.total },
                            ...statusKeys
                              .filter((k) => Number(r[k]) > 0)
                              .map((k) => ({ label: k, value: r[k] })),
                          ];
                        }}
                      />
                    }
                  />
                  {/* Recharts' own animation is off — `ChartAnim` draws this
                      path on with stroke-dashoffset instead, on mount AND on
                      every zoom/reset. */}
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#EE1C25"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {/* Live drag preview while dragging, THEN the settled
                      target while the chart draws into it — the highlight
                      stays visible the whole time, not just for the raw drag
                      (which ends the instant the mouse/finger releases). */}
                  {(dailyZoom.zoomDrag.drag || dailyZoom.highlightRange) && (
                    <ReferenceArea
                      x1={dailyZoom.zoomDrag.drag?.startLabel ?? dailyZoom.highlightRange[0]}
                      x2={dailyZoom.zoomDrag.drag?.endLabel ?? dailyZoom.highlightRange[1]}
                      strokeOpacity={0.3}
                      fill="#EE1C25"
                      fillOpacity={0.12}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </ChartAnim>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Equipment NAMES — the dispatch table's own equipment_id never
                reaches the UI here. */}
            <MiniBars
              title="What moved most"
              rows={d.breakdowns?.byEquipment}
              pickValue={(r) => r.dispatches}
              hint="dispatches by equipment line"
            />
            <MiniBars
              title="Where it went"
              rows={d.breakdowns?.byDestination}
              hint="dispatches by destination"
            />
          </div>

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="dispatch_trends" result={d} template={tmpl_dispatchTrends} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.6 Return trends ────────────────────────────────────────────────────

export function ReturnTrendsSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('return_trends', params);
  const q = useAnalytics('return_trends', effectiveParams);
  const d = q.data;
  const [openKey, setOpenKey] = useState(null);
  // Purely local zoom on the already-fetched weekly series — see useLocalZoom.
  const weeklyZoom = useLocalZoom(d?.series?.byWeek, 'week', cardRange);
  const weeklyRangeSummary = useMemo(() => summarizeWeeklyRange(weeklyZoom.data), [weeklyZoom.data]);

  const toggle = useCallback((key) => {
    setOpenKey(prev => (prev === key ? null : key));
  }, []);

  return (
    <SectionCard
      title="Return trends"
      subtitle={sectionPeriod(d?.meta, 90)}
      icon={RefreshCcw}
      {...q}
      hasData={(r) => (r?.kpis?.rentalReturnsWindow > 0) || (r?.kpis?.overdueCount > 0)}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={(
        <CardResetButton
          onClick={() => { setCardRange(DEFAULT_RANGE); weeklyZoom.hardReset(); }}
          disabled={q.isLoading}
        />
      )}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Rental returns"
              value={d.kpis.rentalReturnsWindow}
              sub={<Delta value={d.kpis.returnsDeltaPct} />}
            />
            <Kpi
              label="Avg hire length"
              value={`${d.kpis.avgReturnDays}d`}
              sub={`${d.kpis.leaseReturnsWindow} lease return${d.kpis.leaseReturnsWindow === 1 ? '' : 's'}`}
            />
            <Kpi
              label="Overdue"
              value={d.kpis.overdueCount}
              sub={d.kpis.overdueOver60 > 0 ? `${d.kpis.overdueOver60} past 60 days` : 'None past 60 days'}
            />
            <Kpi
              label="Worst overdue"
              value={d.kpis.worstOverdueLabel ?? '—'}
              sub={d.kpis.worstOverdueDays ? `${d.kpis.worstOverdueDays} days out` : undefined}
              /* Unit id is hover-only. */
              title={d.kpis.worstOverdueId ? `Unit ${d.kpis.worstOverdueId}` : undefined}
            />
          </div>

          <TrendCompare
            data={d.series?.compare}
            title={`Returns vs the previous ${d.meta?.windowDays ?? 90} days`}
            resetKey={cardRange}
          />

          {d.series?.byWeek?.length ? (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Weekly return cadence
                <span className="text-slate-400 font-normal"> — drag to zoom</span>
              </p>
              <ZoomBanner
                active={!!weeklyZoom.zoomDomain}
                fromDate={weeklyZoom.zoomDomain?.from}
                toDate={weeklyZoom.zoomDomain?.to}
                onReset={weeklyZoom.resetZoom}
                detail={weeklyRangeSummary && (
                  <p>
                    {weeklyRangeSummary.weeks} week{weeklyRangeSummary.weeks === 1 ? '' : 's'}
                    {' · '}{weeklyRangeSummary.total} return{weeklyRangeSummary.total === 1 ? '' : 's'}
                    {' · '}{weeklyRangeSummary.avgPerWeek.toFixed(1)}/week avg
                    {weeklyRangeSummary.avgTurnaroundDays != null && (
                      <> · {weeklyRangeSummary.avgTurnaroundDays}d avg turnaround</>
                    )}
                    {weeklyRangeSummary.peakWeek && (
                      <> · peak {weeklyRangeSummary.peakCount} in {weeklyRangeSummary.peakWeek}</>
                    )}
                  </p>
                )}
              />
              <ChartAnim
                animKey={weeklyZoom.animKey}
                variant="draw"
                className="h-36 select-none"
                style={{ touchAction: 'none' }}
              >
                <ResponsiveContainer>
                  <AreaChart data={weeklyZoom.data} margin={{ left: 8, right: 8 }} {...weeklyZoom.zoomDrag.handlers}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="week" tick={{ fontSize: 9 }} minTickGap={16} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      content={
                        <NamedTooltip
                          titleOf={(r) => r.week}
                          rows={(r) => [
                            { label: 'Returns', value: r.count },
                            { label: 'Avg turnaround', value: r.avgTurnaroundDays != null ? `${r.avgTurnaroundDays}d` : '—' },
                          ]}
                        />
                      }
                    />
                    <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} isAnimationActive={false} />
                    {(weeklyZoom.zoomDrag.drag || weeklyZoom.highlightRange) && (
                      <ReferenceArea
                        x1={weeklyZoom.zoomDrag.drag?.startLabel ?? weeklyZoom.highlightRange[0]}
                        x2={weeklyZoom.zoomDrag.drag?.endLabel ?? weeklyZoom.highlightRange[1]}
                        strokeOpacity={0.3}
                        fill="#3b82f6"
                        fillOpacity={0.12}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          ) : null}

          {/* Overdue units by NAME — the list a collections call is made
              from. Previously this section rendered no per-unit detail at
              all, so the "who is late" question had to be answered elsewhere. */}
          {d.breakdowns?.overdue?.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Overdue units
                <span className="text-slate-400 font-normal"> — past the 30-day return threshold</span>
              </p>
              <ul className="space-y-1.5">
                {d.breakdowns.overdue.map((r, i) => (
                  <RankRow
                    key={r.dispatch_id}
                    rank={i + 1}
                    label={r.label}
                    metrics={`${r.days_out ?? '—'} days out · ${r.days_overdue ?? 0}d past threshold${r.destination ? ` · ${r.destination}` : ''}`}
                    expanded={openKey === r.dispatch_id}
                    onToggle={() => toggle(r.dispatch_id)}
                    detail={
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                        <Detail label="Equipment type" value={r.type_name} />
                        <Detail label="Dispatched" value={dateShort(r.dispatch_date) ?? '—'} />
                        <Detail label="Days out" value={r.days_out != null ? `${r.days_out} days` : '—'} />
                        <Detail label="Past threshold" value={r.days_overdue != null ? `${r.days_overdue} days` : '—'} />
                        <Detail label="Status" value={r.status ?? '—'} />
                        <Detail label="Destination" value={r.destination ?? 'Unrecorded'} />
                        <Detail label="Yard location" value={r.location ?? '—'} />
                        {/* Identifiers, drill-down only. */}
                        <Detail label="Unit ID" value={r.equipment_id ?? '—'} />
                        <Detail label="Serial number" value={r.serial_number ?? '—'} />
                        <Detail label="Dispatch ID" value={r.dispatch_id} />
                      </div>
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          <MiniBars
            title="Overdue by destination"
            rows={d.breakdowns?.overdueByDestination}
            hint="where a collection run would recover most"
          />

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="return_trends" result={d} template={tmpl_returnTrends} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.7 Utilization ──────────────────────────────────────────────────────

export function UtilizationSection({ params }) {
  const q = useAnalytics('utilization', params);
  const d = q.data;
  const [drillType, setDrillType] = useState(null); // {type_id, name} or null
  const { yAxisWidth } = useHorizontalBarAxis();
  // Read through locals rather than `d.kpis.x` / `d.breakdowns.y.map(...)`.
  // A payload that is present but partial — a fetcher that returned early, a
  // cached entry written by an older build — otherwise throws inside the
  // render, and a render-phase throw surfaces as the chat boundary's generic
  // "could not render this insight" instead of the section's own empty state.
  const k = d?.kpis ?? {};
  const b = d?.breakdowns ?? {};
  const byType = Array.isArray(b.byType) ? b.byType : [];
  // Depends on the raw `d?.series?.composition` reference (stable between
  // renders of the same query result), not the `composition` local below —
  // that local falls back to a fresh `[]` literal on every render when the
  // series is absent, which would defeat this memo entirely.
  const composition = Array.isArray(d?.series?.composition) ? d.series.composition : [];
  const compHover = useSeriesHover();
  // Funnel-style chips replacing the composition chart's legend.
  const compositionChips = useMemo(() => {
    const rows = Array.isArray(d?.series?.composition) ? d.series.composition : [];
    const t = { 'In use': 0, Idle: 0, Maintenance: 0 };
    for (const row of rows) {
      t['In use'] += Number(row['In use']) || 0;
      t.Idle += Number(row.Idle) || 0;
      t.Maintenance += Number(row.Maintenance) || 0;
    }
    return [
      { key: 'In use', label: 'In use', value: t['In use'], raw: t['In use'], color: '#10b981' },
      { key: 'Idle', label: 'Idle', value: t.Idle, raw: t.Idle, color: '#f59e0b' },
      { key: 'Maintenance', label: 'Maintenance', value: t.Maintenance, raw: t.Maintenance, color: '#EE1C25' },
    ];
  }, [d?.series?.composition]);

  return (
    <SectionCard
      title="Fleet utilisation"
      subtitle="Live snapshot · % of non-maintenance fleet in use · not date-filtered"
      icon={Gauge}
      {...q}
      hasData={(r) => Number(r?.kpis?.totalUnits) > 0}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Fleet"
              value={`${k.fleetUtilPct ?? 0}%`}
              sub={`Median ${k.medianUtilPct ?? 0}% · ${k.spreadPct ?? 0}pt spread`}
            />
            <Kpi label="Highest" value={k.topName ?? '—'} sub={`${k.topPct ?? 0}%`} />
            <Kpi label="Lowest" value={k.lowName ?? '—'} sub={`${k.lowPct ?? 0}%`} />
            <Kpi
              label="In use"
              value={`${k.inUse ?? 0}/${k.totalUnits ?? 0}`}
              sub={`${k.idleCount ?? 0} idle · ${k.inMaint ?? 0} in workshop`}
            />
          </div>

          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">
              Utilisation by equipment line
              <span className="text-slate-400 font-normal"> — % of hireable units on hire · click a bar for its units</span>
            </p>
            <ChartAnim animKey={q.dataUpdatedAt} bars="horizontal" style={{ height: Math.max(150, Math.min(10, byType.length) * 26 + 24) }}>
              <ResponsiveContainer>
                <BarChart data={byType.slice(0, 10)} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={false}
                    content={
                      <NamedTooltip
                        subtitleOf={(r) => r.category}
                        rows={(r) => [
                          { label: 'Utilisation', value: `${r.utilization_pct}%` },
                          { label: 'On hire', value: r.in_use },
                          { label: 'Idle', value: r.idle },
                          { label: 'In maintenance', value: r.in_maint },
                          { label: 'Total units', value: r.total },
                        ]}
                      />
                    }
                  />
                  <Bar
                    dataKey="utilization_pct"
                    shape={Bar3D}
                    isAnimationActive={false}
                    onClick={(r) => r?.type_id && setDrillType({ type_id: r.type_id, name: r.name })}
                    style={{ cursor: 'pointer' }}
                  >
                    {byType.slice(0, 10).map((r, i) => (
                      <Cell key={i} fill={r.utilization_pct > 85 ? '#EE1C25' : r.utilization_pct > 50 ? '#10b981' : '#f59e0b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartAnim>
            {/* Expands under the bar that was clicked, keeping the chart
                and the rest of the response in view. */}
            {drillType && (
              <div className="mt-2">
                <EquipmentUnitsPanel
                  typeId={drillType.type_id}
                  typeName={drillType.name}
                  onClose={() => setDrillType(null)}
                />
              </div>
            )}
          </div>

          {/* Composition answers "why is this line at 40%?" — idle capital
              and workshop time are different problems with different fixes,
              and the percentage above cannot distinguish them. */}
          {composition.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Where each line&apos;s units actually are
              </p>
              <BarLegendChips items={compositionChips} offsetLeft={yAxisWidth + 4} activeKey={compHover.activeKey} onHover={compHover.onHover} />
              <ChartAnim animKey={q.dataUpdatedAt} bars="horizontal" style={{ height: Math.max(150, composition.length * 26 + 30) }}>
                <ResponsiveContainer>
                  <BarChart data={composition} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} cursor={false} />
                    <Bar dataKey="In use"       stackId="u" fill="#10b981" shape={Bar3D} isAnimationActive={false} {...compHover.barProps('In use')} />
                    <Bar dataKey="Idle"         stackId="u" fill="#f59e0b" shape={Bar3D} isAnimationActive={false} {...compHover.barProps('Idle')} />
                    <Bar dataKey="Maintenance"  stackId="u" fill="#EE1C25" shape={Bar3D} isAnimationActive={false} {...compHover.barProps('Maintenance')} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          <MiniBars
            title="Utilisation by location"
            rows={b.byLocation}
            pickValue={(r) => r.utilization_pct}
            format={(v) => `${v}%`}
            hint="relocating stock is the cheapest capacity increase"
          />

          <ConfidenceNote confidence={d.meta?.confidence} />
          <Analysis sectionKey="utilization" result={d} template={tmpl_utilization} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.8 Revenue by category ──────────────────────────────────────────────

export function RevenueByCategorySection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('revenue_by_category', params);
  const q = useAnalytics('revenue_by_category', effectiveParams);
  const d = q.data;
  const { yAxisWidth } = useHorizontalBarAxis();
  // Which basis produced these numbers has to be visible: contracted value is
  // a legitimate answer to "which categories drive revenue" on a system that
  // is quoting but not yet billing, but presenting it as billed revenue would
  // not be.
  const meta = d?.meta ?? {};
  const period = meta.allTime
    ? 'All time'
    : meta.fromDate && meta.toDate
      ? `${meta.fromDate} to ${meta.toDate}`
      : `Rolling ${meta.windowDays ?? 90} days`;
  const basisNote = meta.revenueBasis === 'contracted'
    ? ' · contracted value (nothing invoiced in this period)'
    : meta.leaseBasisBilled
      ? ' · includes lease value billed but not yet paid'
      : '';

  return (
    <SectionCard
      title="Revenue by equipment category"
      subtitle={`${period}${basisNote}`}
      icon={DollarSign}
      {...q}
      hasData={(r) => Number(r?.kpis?.totalRevenue) > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={<CardResetButton onClick={() => setCardRange(DEFAULT_RANGE)} disabled={q.isLoading} />}
      emptyMessage={meta.emptyReason
        ?? 'No revenue recorded in this period. Try a wider date range.'}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Total revenue"
              value={kwd(d.kpis.totalRevenue)}
              sub={<Delta value={d.kpis.revenueDeltaPct} />}
            />
            <Kpi
              label="Rental / Lease"
              value={`${100 - d.kpis.leaseSharePct}% / ${d.kpis.leaseSharePct}%`}
              sub={`${kwd(d.kpis.totalRental)} · ${kwd(d.kpis.totalLease)}`}
            />
            <Kpi
              label="Top earner"
              value={d.kpis.topEquipmentName ?? d.kpis.topCategory ?? '—'}
              sub={d.kpis.topEquipmentName
                ? `${kwd(d.kpis.topEquipmentRevenue)} · ${d.kpis.topEquipmentSharePct}%`
                : `${d.kpis.topSharePct}% of revenue`}
              title={d.breakdowns?.byEquipment?.[0]?.type_id
                ? `Type ID ${d.breakdowns.byEquipment[0].type_id}` : undefined}
            />
            <Kpi
              label={meta.revenueBasis === 'contracted' ? 'Contracts' : 'Invoices'}
              value={d.kpis.contractCount ?? d.kpis.invoiceCount}
              sub={`${kwd(d.kpis.avgPerContract ?? d.kpis.avgInvoiceValue)} average`}
            />
          </div>

          <TrendCompare
            data={d.series?.compare}
            title={`Billed revenue vs the previous ${d.meta?.windowDays ?? 90} days`}
            format={(v) => kwd(v)}
            resetKey={cardRange}
          />

          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">Revenue by category</p>
            <ChartAnim animKey={q.dataUpdatedAt} bars="horizontal" style={{ height: Math.max(150, Math.min(10, d.breakdowns.byCategory.length) * 26 + 24) }}>
              <ResponsiveContainer>
                <BarChart data={d.breakdowns.byCategory.slice(0, 10)} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} cursor={false} formatter={(v) => kwd(v)} />
                  <Bar dataKey="revenue" shape={Bar3D} isAnimationActive={false}>
                    {d.breakdowns.byCategory.slice(0, 10).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartAnim>
          </div>

          {/* The named-equipment view of the same revenue. A category is a
              bucket; an equipment line is something the business can act on,
              so it gets its own ranking rather than only a tooltip. */}
          <MiniBars
            title="Top earning equipment"
            rows={d.breakdowns?.byEquipment?.map(r => ({
              ...r,
              hoverTitle: [r.type_id && `Type ID ${r.type_id}`, r.category, `${r.sharePct}% of revenue`]
                .filter(Boolean).join(' · '),
            }))}
            pickValue={(r) => r.revenue}
            format={(v) => kwd(v)}
            hint="rental and lease combined"
          />

          {!d.meta.hasLineItems && (
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              Line-item detail is unavailable — revenue is attributed by best-effort quotation lookup.
            </p>
          )}
          {d.meta.hasLineItems && d.kpis.unallocatedPct >= 20 && (
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              {d.kpis.unallocatedPct}% of revenue could not be traced to an equipment category —
              every share above is understated by an unknown part of that.
            </p>
          )}

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="revenue_by_category" result={d} template={tmpl_revenueByCategory} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.9 Procurement vs lease ─────────────────────────────────────────────

export function ProcurementVsLeaseSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('procurement_vs_lease', params);
  const q = useAnalytics('procurement_vs_lease', effectiveParams);
  const d = q.data;
  // Purely local zoom on the already-fetched monthly series — see useLocalZoom.
  const monthlyZoom = useLocalZoom(d?.series?.monthly, 'month', cardRange);

  const volumeHover = useSeriesHover();
  const mixHover = useSeriesHover();
  // Funnel-style chips replacing this section's two chart legends.
  const volumeChips = useMemo(() => {
    const rows = d?.breakdowns?.rows ?? [];
    const count = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const spend = rows.reduce((s, r) => s + (Number(r.spend) || 0), 0);
    return [
      { key: 'count', label: 'Count', value: count, raw: count, color: '#3b82f6' },
      // `raw` is the KWD figure the formatted `value` came from — the two
      // series are not comparable on the same scale (a count of 12 against a
      // spend of 40,000), so spend always reads as the leader here, which is
      // the honest emphasis for a chart about committed value.
      { key: 'spend', label: 'Spend', value: kwd(spend), raw: spend, color: '#EE1C25' },
    ];
  }, [d?.breakdowns?.rows]);
  const monthMixChips = useMemo(() => {
    const rows = monthlyZoom.data ?? [];
    const buy = rows.reduce((s, r) => s + (Number(r.Buy) || 0), 0);
    const lease = rows.reduce((s, r) => s + (Number(r.Lease) || 0), 0);
    return [
      { key: 'Buy', label: 'Buy', value: buy, raw: buy, color: '#EE1C25' },
      { key: 'Lease', label: 'Lease', value: lease, raw: lease, color: '#3b82f6' },
    ];
  }, [monthlyZoom.data]);

  return (
    <SectionCard
      title="Procurement vs leasing"
      subtitle={
        d?.meta?.source === 'equipment_units' || d?.meta?.source === 'equipment_units_all_time'
          ? `Synthesised from fleet records${d?.meta?.rangeApplied === false ? ' — all-time (no records in window)' : ''}`
          : d?.meta?.source === 'procurements_all_time'
            ? `${sectionPeriod(d?.meta, 365)} — widened to all-time (window was empty)`
            : sectionPeriod(d?.meta, 365)
      }
      icon={Repeat}
      {...q}
      hasData={(r) => (
        // Any of these signals means we have something to render — the primary
        // procurements path, either fallback, or a comparable line.
        ((Number(r?.kpis?.buyCount) || 0) + (Number(r?.kpis?.leaseCount) || 0)) > 0
        || (r?.breakdowns?.byEquipment?.length ?? 0) > 0
        || (r?.breakdowns?.comparable?.length ?? 0) > 0
      )}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={(
        <CardResetButton
          onClick={() => { setCardRange(DEFAULT_RANGE); monthlyZoom.hardReset(); }}
          disabled={q.isLoading}
        />
      )}
      emptyMessage="No procurement records and no fleet units in the database — buy vs lease cannot be compared until either exists."
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Buy"
              value={d.kpis.buyCount}
              sub={`${kwd(d.kpis.buySpend)} · ${kwd(d.kpis.avgBuyPrice)} avg`}
            />
            <Kpi
              label="Lease"
              value={d.kpis.leaseCount}
              sub={`${kwd(d.kpis.leaseMonthlyCommit)}/mo · ${kwd(d.kpis.avgLeaseMonthly)} avg`}
            />
            <Kpi
              label="12-mo lease ext."
              value={kwd(d.kpis.annualLeaseExtrapolated)}
              sub={`${d.kpis.buySharePct}% of volume is CapEx`}
            />
            <Kpi
              label="Break-even"
              value={d.kpis.breakEvenMonths != null ? `${d.kpis.breakEvenMonths.toFixed(1)} mo` : '—'}
              sub={d.kpis.comparableLines > 0
                ? `${d.kpis.comparableLines} line${d.kpis.comparableLines === 1 ? '' : 's'} directly comparable`
                : 'Fleet-wide average'}
            />
          </div>

          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">
              Committed volume and value
              <span className="text-slate-400 font-normal"> — count and spend, on their own scales</span>
            </p>
            <BarLegendChips items={volumeChips} offsetLeft={44} activeKey={volumeHover.activeKey} onHover={volumeHover.onHover} />
            {/* Count and spend are different UNITS (orders vs KWD) — plotting
                them on one shared axis is what made a count of 26 render as
                an invisible sliver next to a 112,820 spend bar, which read as
                a single stacked/additive column instead of two independent
                figures. Each keeps its OWN axis (`yAxisId`) so both are
                genuinely visible and neither implies it adds to the other. */}
            <ChartAnim animKey={q.dataUpdatedAt} bars="vertical" className="h-44">
              <ResponsiveContainer>
                <BarChart data={d.breakdowns.rows} margin={{ left: 4, right: 4 }} barGap={6}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="type" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="count" width={32} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="spend" orientation="right" width={48} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toLocaleString()} />
                  {/* `shared={false}` is what makes this an ITEM-level tooltip
                      — hovering one bar reports ONLY that bar's own value,
                      never the other series' figure for the same category
                      (Recharts' default `axis` tooltip type would show both
                      count and spend together the instant the pointer
                      entered the "Buy" column, regardless of which bar it
                      was actually over). Verified against real Recharts
                      output: with `shared={false}`, `payload` is length 1,
                      already scoped to the exact bar hovered. */}
                  <Tooltip
                    cursor={false}
                    shared={false}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0];
                      const row = p?.payload;
                      const isSpend = p?.dataKey === 'spend';
                      return (
                        <div style={NEO_TOOLTIP_STYLE} className="min-w-[140px]">
                          <p className="text-xs font-semibold text-slate-800">{row?.type ?? '—'}</p>
                          <p className="text-[10px] text-slate-500 mt-1">{isSpend ? 'Spend' : 'Count'}</p>
                          <p className="text-sm font-bold text-slate-800">
                            {isSpend ? kwd(Number(row?.spend) || 0) : (Number(row?.count) || 0)}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar yAxisId="count" dataKey="count" fill="#3b82f6" shape={Bar3D} isAnimationActive={false} {...volumeHover.barProps('count')} />
                  <Bar yAxisId="spend" dataKey="spend" fill="#EE1C25" shape={Bar3D} isAnimationActive={false} {...volumeHover.barProps('spend')} />
                </BarChart>
              </ResponsiveContainer>
            </ChartAnim>
          </div>

          {/* The mix over time. A single blended break-even over a year hides
              a deliberate shift in strategy; this is where that shows up. */}
          {d.series?.monthly?.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Monthly buy vs lease mix
                {d.kpis.mixShiftPct != null && (
                  <span className="text-slate-400 font-normal">
                    {' '}— CapEx {d.kpis.earlyBuyShare}% → {d.kpis.lateBuyShare}% across the window
                  </span>
                )}
                <span className="text-slate-400 font-normal"> · drag to zoom</span>
              </p>
              <ZoomBanner
                active={!!monthlyZoom.zoomDomain}
                fromDate={monthLabel(monthlyZoom.zoomDomain?.from)}
                toDate={monthLabel(monthlyZoom.zoomDomain?.to)}
                onReset={monthlyZoom.resetZoom}
              />
              <BarLegendChips items={monthMixChips} offsetLeft={72} activeKey={mixHover.activeKey} onHover={mixHover.onHover} />
              <ChartAnim
                animKey={monthlyZoom.animKey}
                bars="vertical"
                className="h-40 select-none"
                style={{ touchAction: 'none' }}
              >
                <ResponsiveContainer>
                  <BarChart data={monthlyZoom.data} margin={{ left: 12, right: 8 }} {...monthlyZoom.zoomDrag.handlers}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={8} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} cursor={false} />
                    <Bar dataKey="Buy"   stackId="m" fill="#EE1C25" shape={Bar3D} isAnimationActive={false} {...mixHover.barProps('Buy')} />
                    <Bar dataKey="Lease" stackId="m" fill="#3b82f6" shape={Bar3D} isAnimationActive={false} {...mixHover.barProps('Lease')} />
                    {(monthlyZoom.zoomDrag.drag || monthlyZoom.highlightRange) && (
                      <ReferenceArea
                        x1={monthlyZoom.zoomDrag.drag?.startLabel ?? monthlyZoom.highlightRange[0]}
                        x2={monthlyZoom.zoomDrag.drag?.endLabel ?? monthlyZoom.highlightRange[1]}
                        strokeOpacity={0.3}
                        fill="#EE1C25"
                        fillOpacity={0.12}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          {/* Per-line break-even, by NAME. The fleet-wide figure above blends
              a small attachment with a crane and answers neither question. */}
          {d.breakdowns?.comparable?.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Lines bought and leased — like-for-like comparison
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b neo-divider">
                    <th className="py-2 font-medium">Equipment</th>
                    <th className="py-2 font-medium text-right">Buy price</th>
                    <th className="py-2 font-medium text-right">Lease /mo</th>
                    <th className="py-2 font-medium text-right">Break-even</th>
                    <th className="py-2 font-medium text-right">Cheaper</th>
                  </tr>
                </thead>
                <tbody className="divide-y neo-divider">
                  {d.breakdowns.comparable.map(r => (
                    <tr key={r.name} title={r.type_id ? `Type ID ${r.type_id}` : undefined}>
                      <td className="py-2 truncate max-w-[180px]">{r.name}</td>
                      <td className="py-2 text-right">{kwd(r.avgBuyPrice)}</td>
                      <td className="py-2 text-right">{kwd(r.avgLeaseMonthly)}</td>
                      <td className="py-2 text-right">{Math.round(r.breakEvenMonths)} mo</td>
                      <td className={clsx(
                        'py-2 text-right font-semibold',
                        r.breakEvenMonths < 18 ? 'text-emerald-600'
                          : r.breakEvenMonths > 36 ? 'text-blue-600' : 'text-slate-500',
                      )}>
                        {r.breakEvenMonths < 18 ? 'Buy' : r.breakEvenMonths > 36 ? 'Lease' : 'Depends'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-400 mt-1">
                Break-even is the average purchase price divided by the average monthly lease rate
                for the same line. Under 18 months favours buying, over 36 favours leasing; between
                the two it turns on how long the asset is actually held.
              </p>
            </div>
          )}

          <MiniBars
            title="Largest committed lines"
            rows={d.breakdowns?.byEquipment?.map(r => ({
              ...r,
              hoverTitle: [r.type_id && `Type ID ${r.type_id}`, r.category, `${r.mode} only`]
                .filter(Boolean).join(' · '),
            }))}
            pickValue={(r) => r.buySpend + r.leaseMonthly * 12}
            format={(v) => kwd(v)}
            hint="purchase spend plus annualised lease"
          />

          <ConfidenceNote confidence={d.meta?.confidence} />
          <Analysis sectionKey="procurement_vs_lease" result={d} template={tmpl_procurementVsLease} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.10 Idle vs active ─────────────────────────────────────────────────

export function IdleVsActiveSection({ params }) {
  const q = useAnalytics('idle_vs_active', params);
  const d = q.data;
  // Same reasoning as UtilizationSection: every field is read through a
  // guarded local. `byStatus` and `longestIdle` are the two that mattered —
  // both were dereferenced directly (`d.breakdowns.byStatus.map`), so a
  // payload missing either took the whole card down with a render-phase
  // throw rather than showing this section's own empty state.
  const k = d?.kpis ?? {};
  const b = d?.breakdowns ?? {};
  const byStatus = Array.isArray(b.byStatus) ? b.byStatus : [];
  const longestIdle = Array.isArray(b.longestIdle) ? b.longestIdle : [];
  const idleAgeing = Array.isArray(d?.series?.idleAgeing) ? d.series.idleAgeing : [];
  const byTypeIdle = (Array.isArray(b.byType) ? b.byType : []).filter(t => Number(t?.idle) > 0);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // `status` on `equipment_units` is current-state only, so a date range
  // cannot reconstruct what was idle back then. What it DOES do is move the
  // reference date the idle durations are measured to — stated here rather
  // than left to look like a live reading.
  const m = d?.meta ?? {};
  const subtitle = m.rangeApplied
    ? `Idle duration as of ${m.asOfDate} · status is current-state only`
    : 'Live snapshot · current warehouse status';

  return (
    <SectionCard
      title="Idle vs active (live)"
      subtitle={subtitle}
      icon={Activity}
      {...q}
      hasData={(r) => Number(r?.kpis?.total) > 0}
      emptyMessage={m.emptyReason
        ?? 'No equipment units to report on for this period.'}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Active" value={num(k.active)} sub={`${Math.max(0, 100 - num(k.idleSharePct) - num(k.maintSharePct))}% of fleet`} />
            <Kpi label="Idle" value={num(k.idle)} sub={`${num(k.idleSharePct)}% · ${num(k.avgIdleDays)}d average`} />
            <Kpi label="Maintenance" value={num(k.maint)} sub={`${num(k.maintSharePct)}% of fleet`} />
            <Kpi
              label="Longest idle"
              /* The NAME leads; the raw equipment_id used to sit here and is
                 now hover-only, matching every other section. */
              value={k.longestIdleLabel ?? '—'}
              sub={`${num(k.longestIdleDays)} days without a dispatch`}
              title={k.longestIdleId ? `Unit ${k.longestIdleId}` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:h-52">
            <div className="h-52">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name"
                     cx="50%" cy="50%" innerRadius={44} outerRadius={70}
                     paddingAngle={4} stroke="white" strokeWidth={2}
                     activeShape={ActivePieShape}
                     animationDuration={CHART_ANIM_MS} animationEasing="ease-in-out">
                  {byStatus.map((_, i) => (
                    <Cell key={i} fill={['#10b981', '#f59e0b', '#EE1C25'][i % 3]} />
                  ))}
                  <Label content={<DonutCentre total={num(k.total)} label="units" />} position="center" />
                </Pie>
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            <div className="overflow-y-auto max-h-52">
              <h4 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Longest idle</h4>
              <ul className="divide-y neo-divider text-xs">
                {longestIdle.slice(0, 6).map(u => (
                  <li
                    key={u.equipment_id}
                    className="py-1.5 flex items-start justify-between gap-2"
                    /* Identifier and yard location on hover only. */
                    title={[`Unit ${u.equipment_id}`, u.serial_number && `S/N ${u.serial_number}`, u.location]
                      .filter(Boolean).join(' · ')}
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-slate-700">{u.label}</span>
                      {u.never_dispatched ? (
                        <span className="block text-[9px] text-amber-600 font-medium">Never dispatched</span>
                      ) : u.last_customer ? (
                        <span className="block text-[9px] text-slate-400 truncate">Last: {u.last_customer}</span>
                      ) : null}
                    </div>
                    <span className={clsx(
                      'shrink-0 tabular-nums',
                      u.idle_days > 90 ? 'text-primary-600 font-semibold'
                        : u.idle_days > 60 ? 'text-amber-600' : 'text-slate-400',
                    )}>
                      {u.idle_days}d
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Ageing is the sharper signal: 20 units idle three days is a
              working buffer, 20 idle three months is stranded capital. */}
          {idleAgeing.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                How long idle stock has been standing
              </p>
              <ChartAnim animKey={q.dataUpdatedAt} bars="vertical" className="h-36">
                <ResponsiveContainer>
                  <BarChart data={idleAgeing} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={NEO_TOOLTIP_STYLE} cursor={false} formatter={(v) => [v, 'Units']} />
                    <Bar dataKey="units" shape={Bar3D} isAnimationActive={false} radius={[4, 4, 0, 0]}>
                      {idleAgeing.map((r, i) => (
                        <Cell
                          key={i}
                          fill={r.bucket === '90d+' ? '#EE1C25'
                            : r.bucket === '61–90d' ? '#f59e0b'
                              : r.bucket === '31–60d' ? '#fbbf24' : '#94a3b8'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MiniBars
              title="Idle units by equipment line"
              rows={byTypeIdle.map(t => ({
                ...t,
                hoverTitle: `${num(t.idle)} of ${num(t.total)} idle · ${num(t.active)} on hire · ${num(t.maint)} in workshop`,
              }))}
              pickValue={(r) => r.idle}
              hint="a whole line idle is a demand question"
            />
            <MiniBars
              title="Idle units by location"
              rows={b.byLocation}
              hint="relocation may beat remarketing"
            />
          </div>

          <ConfidenceNote confidence={d.meta?.confidence} />
          <Analysis sectionKey="idle_vs_active" result={d} template={tmpl_idleVsActive} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.11 Top customers ──────────────────────────────────────────────────

export function TopCustomersSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('top_customers', params);
  const q = useAnalytics('top_customers', effectiveParams);
  const d = q.data;
  const concentrationAnimKey = useEntranceKey();
  const [drillCustomer, setDrillCustomer] = useState(null); // {customer_id, company_name} or null

  return (
    <SectionCard
      title="Top customers"
      subtitle={sectionPeriod(d?.meta, 365)}
      icon={Users}
      {...q}
      hasData={(r) => (r?.breakdowns?.top20?.length ?? 0) > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={<CardResetButton onClick={() => setCardRange(DEFAULT_RANGE)} disabled={q.isLoading} />}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Top account"
              value={d.kpis.topCustomer ?? '—'}
              sub={
                <span>
                  {kwd(d.kpis.topBilled)} ·{' '}
                  <Delta
                    value={d.kpis.topTrendPct}
                    current={d.kpis.topBilled}
                    compareTitle={compareLabel(d.meta)}
                  />
                </span>
              }
              title={compareLabel(d.meta) ?? undefined}
            />
            <Kpi
              label="Total billed"
              value={kwd(d.kpis.totalBilled)}
              sub={
                <Delta
                  value={d.kpis.billedDeltaPct}
                  current={d.kpis.totalBilled}
                  compareTitle={compareLabel(d.meta)}
                />
              }
            />
            <Kpi
              label="Collected"
              value={`${d.kpis.collectionRatePct}%`}
              sub={`${kwd(d.kpis.totalOutstanding)} outstanding`}
            />
            <Kpi
              label="Top-5 share"
              value={`${d.kpis.top5SharePct}%`}
              sub={[
                `${d.kpis.activeCustomers} active`,
                `${d.kpis.oneTimeCount} one-time`,
                d.kpis.churnedCount > 0 ? `${d.kpis.churnedCount} dormant` : null,
              ].filter(Boolean).join(' · ')}
            />
          </div>

          {/* Concentration curve — the shape of the risk the top-5 percentage
              only states. A steep head is a single-account-loss exposure.
              The line is CUMULATIVE (everything from #1 through this rank,
              combined) — not this account's own share. The tooltip must
              show both numbers or "95% cumulative" reads as this one
              account's share of revenue instead of the whole book's. */}
          {d.series?.concentration?.length > 2 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Revenue concentration
                <span className="text-slate-400 font-normal"> — cumulative share by account rank</span>
              </p>
              <ChartAnim animKey={concentrationAnimKey} variant="draw" className="h-36">
                <ResponsiveContainer>
                  <AreaChart data={d.series.concentration} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="rank" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 9 }} width={36} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      cursor={{ stroke: 'rgba(148,163,184,0.35)' }}
                      content={
                        <NamedTooltip
                          subtitleOf={(r) => `Rank ${r.rank} of top ${d.series.concentration.length}`}
                          rows={(r) => [
                            { label: 'Billed', value: kwd(r.billed) },
                            { label: 'Contribution to total revenue', value: `${r.sharePct}%` },
                            { label: `Cumulative through ${r.rank}`, value: `${r.cumulativePct}%` },
                          ]}
                        />
                      }
                    />
                    <Area type="monotone" dataKey="cumulativePct" stroke="#EE1C25" fill="#EE1C25" fillOpacity={0.13} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          <PipelineFunnel funnel={d.breakdowns?.salesFunnel} />

          <div className="overflow-x-auto">
            <p className="text-[10px] text-slate-400 mb-1">Click a row for that customer's billing and rental history.</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b neo-divider">
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium text-right">Approved</th>
                  <th className="py-2 font-medium text-right">Billed</th>
                  <th className="py-2 font-medium text-right">vs prev</th>
                  <th className="py-2 font-medium text-right">Collected</th>
                  <th className="py-2 font-medium text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y neo-divider">
                {d.breakdowns.top20.slice(0, 8).map(c => (
                  <tr
                    key={c.customer_id}
                    title={`Customer ID ${c.customer_id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDrillCustomer(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setDrillCustomer(c); }}
                    className="cursor-pointer hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-2 truncate max-w-[200px]">
                      <span>{c.company_name ?? '—'}</span>
                      {c.is_churned && (
                        <span className="ml-1.5 inline-block text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full align-middle">
                          dormant
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">{c.approved_quotes}</td>
                    <td className="py-2 text-right">{kwd(c.billed_kwd)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Delta
                        value={c.trendPct}
                        current={c.billed_kwd}
                        compareTitle={compareLabel(d.meta)}
                      />
                    </td>
                    <td className="py-2 text-right">
                      {c.collectedPct == null ? '—' : `${c.collectedPct}%`}
                    </td>
                    <td
                      className={`py-2 text-right ${c.outstanding > 0 ? 'text-primary-600 font-semibold' : ''}`}
                      title={c.max_days_late > 0 ? `Oldest unpaid invoice ${c.max_days_late}d past due` : undefined}
                    >
                      {kwd(c.outstanding)}
                      {c.max_days_late > 0 && (
                        <span className="block text-[9px] text-rose-500 font-normal leading-tight">
                          {c.max_days_late}d late
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Expands directly beneath the ranking table it was opened from. */}
          {drillCustomer && (
            <CustomerBillingPanel
              params={effectiveParams}
              customerId={drillCustomer.customer_id}
              customerName={drillCustomer.company_name}
              onClose={() => setDrillCustomer(null)}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MiniBars
              title="Growing accounts"
              rows={d.breakdowns?.growing?.map(r => ({
                name: r.company_name ?? '—',
                value: r.trendPct,
                hoverTitle: `${kwd(r.prevBilled)} → ${kwd(r.billed_kwd)}`,
              }))}
              format={(v) => `+${v}%`}
              hint="vs the previous period"
            />
            <MiniBars
              title="Contracting accounts"
              rows={d.breakdowns?.shrinking?.map(r => ({
                name: r.company_name ?? '—',
                value: Math.abs(r.trendPct),
                hoverTitle: `${kwd(r.prevBilled)} → ${kwd(r.billed_kwd)}`,
              }))}
              format={(v) => `−${v}%`}
              hint="vs the previous period"
            />
          </div>

          <ConfidenceNote confidence={d.meta?.confidence} comparedTo={d.meta?.comparedTo} />
          <Analysis sectionKey="top_customers" result={d} template={tmpl_topCustomers} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.12 Maintenance cost trends ─────────────────────────────────────────

export function MaintenanceCostSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('maintenance_cost', params);
  const q = useAnalytics('maintenance_cost', effectiveParams);
  const d = q.data;
  const [openKey, setOpenKey] = useState(null);
  const [drillUnit, setDrillUnit] = useState(null); // {equipment_id, label} or null
  const { yAxisWidth, labelMax } = useHorizontalBarAxis();
  // Purely local zoom on the already-fetched series — see useLocalZoom.
  const monthlyZoom = useLocalZoom(d?.series?.byMonth, 'month', cardRange);

  const byUnit = d?.breakdowns?.byUnit;
  const chartRows = useMemo(
    () => [...(byUnit ?? [])].slice(0, 8)
      .map(u => ({ ...u, axis: axisLabel(u.label, labelMax) }))
      .reverse(),
    [byUnit, labelMax],
  );

  const toggle = useCallback((key) => {
    setOpenKey(prev => (prev === key ? null : key));
  }, []);

  return (
    <SectionCard
      title="Maintenance cost trends"
      subtitle={sectionPeriod(d?.meta, 365, ' · completed jobs only')}
      icon={LineChartIcon}
      {...q}
      hasData={(r) => r?.kpis?.totalJobs > 0}
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={(
        <CardResetButton
          onClick={() => { setCardRange(DEFAULT_RANGE); monthlyZoom.hardReset(); }}
          disabled={q.isLoading}
        />
      )}
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="MTD"
              value={kwd(d.kpis.mtdCost)}
              /* Rising maintenance cost is a bad outcome, so the tone flips. */
              sub={<Delta value={d.kpis.momDeltaPct} goodWhen="down" />}
            />
            <Kpi label="YTD" value={kwd(d.kpis.ytdCost)} sub={`${kwd(d.kpis.monthlyRunRate)}/mo run rate`} />
            <Kpi label="Avg/job" value={kwd(d.kpis.avgCostPerJob)} sub={`${d.kpis.totalJobs} completed`} />
            <Kpi
              label="Costliest unit"
              value={d.kpis.topUnitLabel ?? '—'}
              sub={d.kpis.topUnitLabel
                ? `${kwd(d.kpis.topUnitCost)} · ${d.kpis.topUnitSharePct}% of spend`
                : 'No unit-level costs recorded'}
              /* Unit id stays on hover. */
              title={d.kpis.topUnitId ? `Unit ${d.kpis.topUnitId}` : undefined}
            />
          </div>

          <div>
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">
              Monthly spend
              <span className="text-slate-400 font-normal"> — with a 3-month trailing average · drag to zoom</span>
            </p>
            <ZoomBanner
              active={!!monthlyZoom.zoomDomain}
              fromDate={monthLabel(monthlyZoom.zoomDomain?.from)}
              toDate={monthLabel(monthlyZoom.zoomDomain?.to)}
              onReset={monthlyZoom.resetZoom}
            />
            <ChartAnim
              animKey={monthlyZoom.animKey}
              variant="draw"
              className="h-48 select-none"
              style={{ touchAction: 'none' }}
            >
              <ResponsiveContainer>
                <AreaChart data={monthlyZoom.data} margin={{ left: 8, right: 8 }} {...monthlyZoom.zoomDrag.handlers}>
                  <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} minTickGap={8} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip contentStyle={NEO_TOOLTIP_STYLE} formatter={(v) => kwd(v)} />
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                  {/* Recharts' own animation is off — `ChartAnim` draws these
                      paths on with stroke-dashoffset (and wipes the fill),
                      on mount AND on every zoom/reset. */}
                  <Area type="monotone" dataKey="total" name="Monthly spend"
                        stroke="#EE1C25" fill="#EE1C25" fillOpacity={0.15}
                        isAnimationActive={false} />
                  {/* The run rate a single large repair cannot swing. */}
                  <Area type="monotone" dataKey="trailing3" name="3-month average"
                        stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3"
                        fill="none" dot={false}
                        isAnimationActive={false} />
                  {/* Live drag preview while dragging, THEN the settled
                      target while the chart draws into it — the highlight
                      stays visible the whole time, not just for the raw drag
                      (which ends the instant the mouse/finger releases). */}
                  {(monthlyZoom.zoomDrag.drag || monthlyZoom.highlightRange) && (
                    <ReferenceArea
                      x1={monthlyZoom.zoomDrag.drag?.startLabel ?? monthlyZoom.highlightRange[0]}
                      x2={monthlyZoom.zoomDrag.drag?.endLabel ?? monthlyZoom.highlightRange[1]}
                      strokeOpacity={0.3}
                      fill="#EE1C25"
                      fillOpacity={0.12}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </ChartAnim>
          </div>

          <PipelineFunnel funnel={d.breakdowns?.workOrderFunnel} />

          {/* Which UNITS the money went on, by name. This section could
              previously only name an issue type, which is not something an
              operations manager can schedule a decision against. */}
          {chartRows.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Where the money went
                <span className="text-slate-400 font-normal">
                  {' '}— top {chartRows.length} of {d.kpis.unitsWithCost} unit{d.kpis.unitsWithCost === 1 ? '' : 's'}
                  {d.kpis.top5UnitSharePct > 0 ? `, five carrying ${d.kpis.top5UnitSharePct}% of spend` : ''}
                </span>
              </p>
              <ChartAnim animKey={q.dataUpdatedAt} bars="horizontal" style={{ height: Math.max(140, chartRows.length * 30 + 24) }}>
                <ResponsiveContainer>
                  <BarChart data={chartRows} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="axis" tick={{ fontSize: 10 }} width={yAxisWidth} interval={0} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      content={
                        <NamedTooltip
                          idOf={(r) => [r.equipment_id && `Unit: ${r.equipment_id}`, r.serial_number && `S/N: ${r.serial_number}`]
                            .filter(Boolean).join('  ·  ') || null}
                          subtitleOf={(r) => [r.type_name, r.location].filter(Boolean).join(' · ')}
                          rows={(r) => [
                            { label: 'Total cost', value: kwd(r.cost) },
                            { label: 'Share of spend', value: `${r.sharePct}%` },
                            { label: 'Completed jobs', value: r.jobs },
                            { label: 'Average per job', value: kwd(r.avgCost) },
                            { label: 'Most common issue', value: r.topIssue ?? '—' },
                          ]}
                        />
                      }
                    />
                    <Bar
                      dataKey="cost" shape={Bar3D} isAnimationActive={false} fill="#EE1C25" radius={[0, 4, 4, 0]}
                      onClick={(r) => r?.equipment_id && setDrillUnit({ equipment_id: r.equipment_id, label: r.label })}
                      style={{ cursor: 'pointer' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          {byUnit?.length > 0 && (
            <ul className="space-y-1.5">
              {byUnit.slice(0, 6).map((u, i) => (
                <RankRow
                  key={u.equipment_id}
                  rank={i + 1}
                  label={u.label}
                  metrics={`${kwd(u.cost)} · ${u.sharePct}% of spend · ${u.jobs} job${u.jobs === 1 ? '' : 's'} · ${kwd(u.avgCost)} avg`}
                  expanded={openKey === u.equipment_id}
                  onToggle={() => toggle(u.equipment_id)}
                  detail={
                    <div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                        <Detail label="Total cost" value={kwd(u.cost)} />
                        <Detail label="Share of spend" value={`${u.sharePct}%`} />
                        <Detail label="Completed jobs" value={u.jobs} />
                        <Detail label="Average per job" value={kwd(u.avgCost)} />
                        <Detail label="Most common issue" value={u.topIssue ?? '—'} />
                        <Detail label="Equipment type" value={u.type_name} />
                        <Detail label="Location" value={u.location ?? '—'} />
                        {/* Identifiers, drill-down only. */}
                        <Detail label="Unit ID" value={u.equipment_id} />
                        <Detail label="Serial number" value={u.serial_number ?? '—'} />
                      </div>
                      <button
                        type="button"
                        onClick={() => setDrillUnit({ equipment_id: u.equipment_id, label: u.label })}
                        className="mt-2 text-[10px] font-medium text-primary-600 hover:text-primary-800 underline underline-offset-2"
                      >
                        View maintenance records →
                      </button>
                    </div>
                  }
                />
              ))}
            </ul>
          )}

          {drillUnit && (
            <MaintRecordsPanel
              params={effectiveParams}
              equipmentId={drillUnit.equipment_id}
              unitLabelText={drillUnit.label}
              onClose={() => setDrillUnit(null)}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MiniBars
              title="Cost by failure mode"
              rows={d.breakdowns?.byIssueType?.slice(0, 6).map(r => ({
                ...r,
                hoverTitle: `${r.jobs} job${r.jobs === 1 ? '' : 's'}`,
              }))}
              pickValue={(r) => r.cost}
              format={(v) => kwd(v)}
            />
            <MiniBars
              title="Cost by equipment line"
              rows={d.breakdowns?.byType?.map(r => ({
                ...r,
                hoverTitle: `${r.jobs} job${r.jobs === 1 ? '' : 's'} · ${kwd(r.avgCost)} average`,
              }))}
              pickValue={(r) => r.cost}
              format={(v) => kwd(v)}
            />
          </div>

          {d.kpis.openJobCount > 0 && (
            <p className="text-[10px] text-slate-400">
              {d.kpis.openJobCount} job{d.kpis.openJobCount === 1 ? ' is' : 's are'} still open and
              excluded — an open job has no settled cost, so the totals above are a floor.
            </p>
          )}

          <ConfidenceNote confidence={d.meta?.confidence} />
          <Analysis sectionKey="maintenance_cost" result={d} template={tmpl_maintenanceCostTrends} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.12b Maintenance drill-down ─────────────────────────────────────────
// Three helpers used by MonthlyKPIsSection when the user clicks the Maint
// spend tile: a query hook, a per-unit record view, and the panel shell.

function useEquipmentRecords(drillParams, equipmentId) {
  const paramKey = JSON.stringify(drillParams ?? {});
  return useQuery({
    queryKey: ['analytics', 'maintDrill', paramKey, equipmentId],
    queryFn: () => getEquipmentMaintenanceRecords(JSON.parse(paramKey), equipmentId),
    staleTime: 15 * 60_000,
    enabled: !!equipmentId,
  });
}

function MaintUnitRecords({ drillParams, unit, fleetAvgCost, onBack }) {
  const q = useEquipmentRecords(drillParams, unit.equipment_id);
  const records = q.data ?? [];
  const vsFleet = fleetAvgCost > 0
    ? Math.round((unit.avgCost - fleetAvgCost) / fleetAvgCost * 100)
    : null;

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
        <ArrowLeft size={13} />Back to fleet
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-800 text-sm">{unit.label}</p>
          <p className="text-[11px] text-slate-400" title={unit.equipment_id}>
            {unit.type_name}{unit.serial_number ? ` · ${unit.serial_number}` : ''}
            {unit.location ? ` · ${unit.location}` : ''}
          </p>
        </div>
        <div className="flex gap-4 shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Jobs</p>
            <p className="font-bold text-slate-800 text-sm">{unit.jobs}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Total cost</p>
            <p className="font-bold text-slate-800 text-sm">{kwd(unit.cost)}</p>
          </div>
          {vsFleet !== null && (
            <div className="text-right">
              <p className="text-[10px] text-slate-400">vs fleet avg</p>
              <p className={clsx('font-bold text-sm', vsFleet > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                {vsFleet > 0 ? '+' : ''}{vsFleet}%
              </p>
            </div>
          )}
        </div>
      </div>

      {q.isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-sm">
          <Loader2 size={15} className="animate-spin" />Loading records…
        </div>
      )}
      {!q.isLoading && records.length === 0 && (
        <p className="text-center text-slate-400 text-sm py-6">
          No completed maintenance records in this period.
        </p>
      )}
      {records.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Maintenance events — highest cost first
          </p>
          <ul className="space-y-1.5">
            {records.map(r => (
              <li key={r.maintenance_id}
                className="neo-inset px-3 py-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-700">{r.issue_type}</p>
                  <p className="text-[10px] text-slate-400">{dateShort(r.service_date)}</p>
                  {r.notes && (
                    <p className="text-[10px] text-slate-500 mt-0.5 italic">{r.notes}</p>
                  )}
                </div>
                <div className="flex items-start gap-4 shrink-0">
                  {r.downtime_days > 0 && (
                    <div className="text-right">
                      <p className="text-[9px] text-slate-400 uppercase">Downtime</p>
                      <p className="text-xs font-semibold text-slate-700">{r.downtime_days}d</p>
                    </div>
                  )}
                  <div className="text-right">
                    <p className="text-[9px] text-slate-400 uppercase">Cost</p>
                    <p className="text-xs font-semibold text-slate-800">{kwd(r.cost_kwd)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MaintDrillPanel({ drillParams, onClose }) {
  const q = useAnalytics('maintenance_cost', drillParams ?? {});
  const [selectedUnit, setSelectedUnit] = useState(null);
  const d = q.data;
  const byUnit = d?.breakdowns?.byUnit ?? [];
  const fleetAvgCost = d?.kpis?.avgCostPerJob ?? 0;
  const activeUnit = selectedUnit ? byUnit.find(u => u.equipment_id === selectedUnit) ?? null : null;

  // Uses the shared `DrillPanel` shell rather than its own copy of the
  // overlay markup — it had the same fixed-inside-a-backdrop-filter bug that
  // pinned the panel to the top of the card instead of the viewport, and one
  // shell means it can never drift from the other drill-downs again.
  return (
    <DrillPanel
      title="Maintenance cost breakdown"
      subtitle={drillParams?.from ? `${drillParams.from} → ${drillParams.to}` : 'Last 365 days'}
      onClose={onClose}
    >
      <>
        {q.isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
            <Loader2 size={16} className="animate-spin" />Loading…
          </div>
        )}

        {!q.isLoading && !activeUnit && byUnit.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">
            No completed maintenance data in this period.
          </p>
        )}

        {!q.isLoading && !activeUnit && byUnit.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi label="Total spend" value={kwd(d.kpis.totalCost)} />
              <Kpi label="Jobs" value={d.kpis.totalJobs} />
              <Kpi label="Avg / job" value={kwd(d.kpis.avgCostPerJob)} />
              <Kpi label="Top issue" value={d.kpis.topIssueType ?? '—'} />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Equipment contribution — click to drill in
              </p>
              <ul className="space-y-1.5">
                {byUnit.map((u, i) => (
                  <li key={u.equipment_id}>
                    <button type="button" onClick={() => setSelectedUnit(u.equipment_id)}
                      className="w-full text-left neo-inset px-3 py-2 hover:bg-white/60 transition-colors rounded-xl group">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-bold text-slate-400 w-4 shrink-0">
                            #{i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-slate-800 truncate"
                              title={u.equipment_id}>{u.label}</p>
                            <p className="text-[10px] text-slate-400 truncate">
                              {u.jobs} job{u.jobs !== 1 ? 's' : ''}
                              {u.last_service_date
                                ? ` · last ${dateShort(u.last_service_date)}`
                                : ''}
                              {u.downtime_days > 0 ? ` · ${u.downtime_days}d downtime` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-slate-800">{kwd(u.cost)}</p>
                            <p className="text-[10px] text-slate-400">{u.sharePct}% of fleet</p>
                          </div>
                          <ChevronRight size={14}
                            className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                        </div>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-slate-200">
                        <div className="h-1 rounded-full bg-rose-500 transition-all"
                          style={{ width: `${Math.min(100, u.sharePct)}%` }} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {activeUnit && (
          <MaintUnitRecords
            drillParams={drillParams}
            unit={activeUnit}
            fleetAvgCost={fleetAvgCost}
            onBack={() => setSelectedUnit(null)}
          />
        )}
      </>
    </DrillPanel>
  );
}

// ── Category drill-downs ─────────────────────────────────────────────────
// Click-into-detail for the charts whose ranking is a TYPE/CATEGORY/SUPPLIER
// aggregate rather than an individual record — "Fleet/rental charts →
// equipment/unit", "Procurement chart → equipment/supplier", "Customer
// chart → customer" from the brief. Every fetch here is ON-DEMAND (only the
// clicked row's own `useQuery` runs — the section's own data and its
// SectionCard loading state are completely untouched) and every panel shares
// one modal shell so opening one never looks like a new chart or the AI
// mascot loader reappearing.
//
// Deliberately NOT built for: Recent leases (no lease-history TABLE exists —
// `lease_start_date`/`lease_end_date` are columns on `equipment_units`
// itself, so the existing RankRow expand already shows everything the
// database has) and Idle vs active's per-unit ageing (only the top-10
// `longestIdle` list carries idle-day figures; there is no fuller table to
// query beyond what the section already renders). Drilling further there
// would mean inventing numbers, which is exactly what this feature must not
// do.

// Shared shell for every drill-down.
//
// INLINE, deliberately — not a modal and not portalled. A drill-down belongs
// to the response that produced it: it expands in place, directly beneath
// the ranking row or chart that was clicked, so the surrounding chat context
// stays on screen and the reader never loses their place. An overlay had the
// opposite effect — it blurred the whole page for what is really just "show
// me the rows behind this number".
//
// (An earlier revision DID portal this to document.body, to escape the
// containing block `.neo-card`'s `backdrop-filter` creates for
// `position: fixed` descendants. That trap is real, and is why this must
// never be re-implemented as a fixed-position element nested in a card —
// but the right answer was to stop being a fixed overlay at all.)
//
// Scroll behaviour is deliberately minimal: `block: 'nearest'` is a NO-OP
// when the panel is already visible, so it cannot fight the chat's own
// auto-scroll or yank the transcript around. It only nudges when the panel
// genuinely opened off-screen. The record list scrolls inside its own
// bounded area with `overscroll-contain`, so reaching its end does not chain
// the scroll into the page behind it.
function DrillPanel({ title, subtitle, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    try { window.addEventListener('keydown', onKey); } catch { /* no DOM */ }
    return () => { try { window.removeEventListener('keydown', onKey); } catch { /* nothing to undo */ } };
  }, [onClose]);

  useEffect(() => {
    // Guarded: scrollIntoView options are ignored by very old engines and the
    // node can be gone by the time this runs.
    try { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    catch { /* position is a nicety, never a failure */ }
  }, []);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={title || 'Drill-down'}
      className="rounded-xl border border-primary-100 bg-primary-50/40 p-3 space-y-3 min-w-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800 break-words">{title}</p>
          {subtitle && <p className="text-[10px] text-slate-500 break-words">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-primary-600 hover:text-primary-800 transition-colors"
          aria-label="Close drill-down"
        >
          <ArrowLeft size={12} />Back
        </button>
      </div>
      {/* Bounded so a long list never stretches the card past the response. */}
      <div className="max-h-72 overflow-y-auto overscroll-contain pr-0.5">
        {children}
      </div>
    </div>
  );
}

function DrillLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
      <Loader2 size={16} className="animate-spin" />Loading…
    </div>
  );
}

function DrillEmpty({ message }) {
  return <p className="text-center text-slate-400 text-sm py-8">{message}</p>;
}

// A single "date · headline — amount" record row, shared by every panel
// below so the drill-downs read as one feature rather than five bespoke ones.
function RecordRow({ headline, date, amount, sub, tone }) {
  return (
    <li className="neo-inset px-3 py-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-700">{headline}</p>
        {date && <p className="text-[10px] text-slate-400">{date}</p>}
        {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {amount != null && (
        <p className={clsx(
          'text-xs font-semibold shrink-0',
          tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-rose-600' : 'text-slate-800',
        )}>
          {amount}
        </p>
      )}
    </li>
  );
}

// One equipment unit's individual rental/dispatch history — triggered from
// "Most rented equipment"'s per-unit ranking.
function RentalRecordsPanel({ params, equipmentId, unitLabelText, onClose }) {
  const paramKey = JSON.stringify(params ?? {});
  const q = useQuery({
    queryKey: ['analytics', 'rentalDrill', paramKey, equipmentId],
    queryFn: () => getEquipmentRentalRecords(JSON.parse(paramKey), equipmentId),
    staleTime: 15 * 60_000,
    enabled: !!equipmentId,
  });
  const records = q.data ?? [];
  // The fetcher falls back to quotation lines exactly where the ranking does,
  // so say which basis the reader is looking at rather than presenting a
  // contract line as though it were a completed dispatch.
  const fromQuotes = records.length > 0 && records.every(r => r.source === 'quotation');
  return (
    <DrillPanel
      title={unitLabelText ?? 'Rental history'}
      subtitle={fromQuotes
        ? 'Rental activity for this unit — from quotation lines (no dispatches in this period)'
        : 'Dispatch and rental activity for this unit'}
      onClose={onClose}
    >
      {q.isLoading && <DrillLoading />}
      {q.isError && !q.isLoading && (
        <DrillEmpty message="Could not load rental activity for this unit. Close and try again." />
      )}
      {!q.isLoading && !q.isError && records.length === 0 && (
        <DrillEmpty message="No rental activity recorded for this unit in this period." />
      )}
      {records.length > 0 && (
        <ul className="space-y-1.5">
          {records.map(r => (
            <RecordRow
              key={r.key ?? r.dispatch_id}
              headline={r.customer_name ?? r.destination ?? (r.source === 'quotation' ? 'Quoted rental' : 'Rental')}
              date={dateShort(r.dispatch_date) ?? '—'}
              amount={r.status ?? undefined}
              sub={[
                r.destination && r.customer_name ? r.destination : null,
                r.quantity != null ? `${r.quantity} unit${r.quantity === 1 ? '' : 's'}` : null,
                r.days_out != null ? `${r.days_out}d out` : null,
                r.return_date ? `${r.source === 'quotation' ? 'until' : 'returned'} ${dateShort(r.return_date)}` : null,
              ].filter(Boolean).join(' · ') || undefined}
            />
          ))}
        </ul>
      )}
    </DrillPanel>
  );
}

// One equipment line's individual procurement orders — triggered from "Most
// procured equipment"'s per-equipment ranking.
function ProcurementRecordsPanel({ params, typeId, description, name, onClose }) {
  const paramKey = JSON.stringify(params ?? {});
  const q = useQuery({
    queryKey: ['analytics', 'procDrill', paramKey, typeId ?? `desc:${description}`],
    queryFn: () => getEquipmentProcurementRecords(JSON.parse(paramKey), typeId ?? null, description ?? null),
    staleTime: 15 * 60_000,
    enabled: !!(typeId || description),
  });
  const records = q.data ?? [];
  return (
    <DrillPanel title={name ?? 'Procurement orders'} subtitle="Individual procurement line items" onClose={onClose}>
      {q.isLoading && <DrillLoading />}
      {!q.isLoading && records.length === 0 && (
        <DrillEmpty message="No procurement orders for this equipment line in this period." />
      )}
      {records.length > 0 && (
        <ul className="space-y-1.5">
          {records.map(r => (
            <RecordRow
              key={r.procurement_id}
              headline={r.vendor ?? 'Unrecorded vendor'}
              date={dateShort(r.date) ?? '—'}
              amount={kwd(r.lineTotalKwd)}
              sub={[
                `${r.quantity} unit${r.quantity === 1 ? '' : 's'} · ${kwd(r.unitPriceKwd)} each`,
                r.type, r.status,
              ].filter(Boolean).join(' · ')}
            />
          ))}
        </ul>
      )}
    </DrillPanel>
  );
}

// One supplier's individual procurements — triggered from the supplier
// contribution list.
function SupplierTransactionsPanel({ params, vendorId, vendorName, onClose }) {
  const paramKey = JSON.stringify(params ?? {});
  const q = useQuery({
    queryKey: ['analytics', 'supplierDrill', paramKey, vendorId ?? vendorName],
    queryFn: () => getSupplierTransactions(JSON.parse(paramKey), vendorId ?? null, vendorName ?? null),
    staleTime: 15 * 60_000,
    enabled: !!(vendorId || vendorName),
  });
  const records = q.data ?? [];
  return (
    <DrillPanel title={vendorName ?? 'Supplier transactions'} subtitle="Procurements from this supplier" onClose={onClose}>
      {q.isLoading && <DrillLoading />}
      {!q.isLoading && records.length === 0 && (
        <DrillEmpty message="No procurements from this supplier in this period." />
      )}
      {records.length > 0 && (
        <ul className="space-y-1.5">
          {records.map(r => (
            <RecordRow
              key={r.procurement_id}
              headline={r.equipment.length ? r.equipment.join(', ') : (r.type ?? 'Procurement')}
              date={dateShort(r.date) ?? '—'}
              amount={kwd(r.totalKwd)}
              sub={[r.type, r.status].filter(Boolean).join(' · ')}
            />
          ))}
        </ul>
      )}
    </DrillPanel>
  );
}

// One customer's billing (invoices) and rental-contract (quotations) history
// — triggered from "Top customers"'s ranking table.
function CustomerBillingPanel({ params, customerId, customerName, onClose }) {
  const paramKey = JSON.stringify(params ?? {});
  const q = useQuery({
    queryKey: ['analytics', 'customerDrill', paramKey, customerId],
    queryFn: () => getCustomerBillingDetails(JSON.parse(paramKey), customerId),
    staleTime: 15 * 60_000,
    enabled: !!customerId,
  });
  const invoices = q.data?.invoices ?? [];
  const quotations = q.data?.quotations ?? [];
  const isEmpty = invoices.length === 0 && quotations.length === 0;
  return (
    <DrillPanel title={customerName ?? 'Customer billing'} subtitle="Billing and rental-contract history" onClose={onClose}>
      {q.isLoading && <DrillLoading />}
      {!q.isLoading && isEmpty && (
        <DrillEmpty message="No invoices or quotations for this customer in this period." />
      )}
      {!q.isLoading && invoices.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-slate-500 mb-1.5">Invoices</p>
          <ul className="space-y-1.5">
            {invoices.map(r => (
              <RecordRow
                key={r.invoice_id}
                headline={`Invoice ${r.invoice_id}`}
                date={dateShort(r.date) ?? '—'}
                amount={kwd(r.totalKwd)}
                tone={r.outstandingKwd > 0 ? 'negative' : 'positive'}
                sub={[
                  r.status,
                  r.outstandingKwd > 0 ? `${kwd(r.outstandingKwd)} outstanding` : 'fully paid',
                  r.dueDate ? `due ${dateShort(r.dueDate)}` : null,
                ].filter(Boolean).join(' · ')}
              />
            ))}
          </ul>
        </div>
      )}
      {!q.isLoading && quotations.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-slate-500 mb-1.5 mt-3">Quotations / rental contracts</p>
          <ul className="space-y-1.5">
            {quotations.map(r => (
              <RecordRow
                key={r.quotation_id}
                headline={`Quotation ${r.quotation_id}`}
                date={dateShort(r.date) ?? '—'}
                amount={kwd(r.totalKwd)}
                sub={r.status}
              />
            ))}
          </ul>
        </div>
      )}
    </DrillPanel>
  );
}

// Every unit of one equipment TYPE with its live status — triggered from
// Fleet Utilisation's per-line ranking. Live snapshot, no date window, same
// as the section it drills from.
function EquipmentUnitsPanel({ typeId, typeName, onClose }) {
  const q = useQuery({
    queryKey: ['analytics', 'unitsByTypeDrill', typeId],
    queryFn: () => getEquipmentUnitsByType(typeId),
    staleTime: 5 * 60_000,
    enabled: !!typeId,
  });
  const units = q.data ?? [];
  // Same status enum getUtilization groups on: Dispatched/Reserved read as
  // in-use (positive), Maintenance as a workshop hold (negative), Available
  // (idle) stays neutral.
  const statusTone = (s) => (s === 'Dispatched' || s === 'Reserved'
    ? 'positive' : s === 'Maintenance' ? 'negative' : undefined);
  return (
    <DrillPanel title={typeName ?? 'Equipment units'} subtitle="Live status per unit" onClose={onClose}>
      {q.isLoading && <DrillLoading />}
      {!q.isLoading && units.length === 0 && (
        <DrillEmpty message="No units recorded for this equipment line." />
      )}
      {units.length > 0 && (
        <ul className="space-y-1.5">
          {units.map(u => (
            <RecordRow
              key={u.equipment_id}
              headline={u.label}
              date={u.location ?? undefined}
              amount={u.status}
              tone={statusTone(u.status)}
              sub={u.updated_at ? `updated ${dateShort(u.updated_at)}` : undefined}
            />
          ))}
        </ul>
      )}
    </DrillPanel>
  );
}

// One equipment unit's individual COMPLETED maintenance jobs — triggered
// directly from Maintenance load / Maintenance cost trends / Unit P&L's own
// charts. Deliberately separate from `MaintDrillPanel`/`MaintUnitRecords`
// above (which serve the Monthly-KPIs "Maint spend" tile's fleet-then-unit
// two-tier flow) rather than reusing them, so that existing, working path is
// never touched.
function MaintRecordsPanel({ params, equipmentId, unitLabelText, onClose }) {
  const paramKey = JSON.stringify(params ?? {});
  const q = useQuery({
    queryKey: ['analytics', 'maintRecordsDrill', paramKey, equipmentId],
    queryFn: () => getEquipmentMaintenanceRecords(JSON.parse(paramKey), equipmentId),
    staleTime: 15 * 60_000,
    enabled: !!equipmentId,
  });
  const records = q.data ?? [];
  return (
    <DrillPanel title={unitLabelText ?? 'Maintenance records'} subtitle="Completed maintenance jobs for this unit" onClose={onClose}>
      {q.isLoading && <DrillLoading />}
      {!q.isLoading && records.length === 0 && (
        <DrillEmpty message="No completed maintenance records for this unit in this period." />
      )}
      {records.length > 0 && (
        <ul className="space-y-1.5">
          {records.map(r => (
            <RecordRow
              key={r.maintenance_id}
              headline={r.issue_type}
              date={dateShort(r.service_date) ?? '—'}
              amount={kwd(r.cost_kwd)}
              sub={[r.downtime_days > 0 ? `${r.downtime_days}d downtime` : null, r.notes].filter(Boolean).join(' · ') || undefined}
            />
          ))}
        </ul>
      )}
    </DrillPanel>
  );
}

// ── 4.13 Monthly KPIs ────────────────────────────────────────────────────

function KpiTile({ label, value, delta, tone = 'neutral', onClick }) {
  const arrow = delta == null ? null : delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
  const color = delta == null ? 'text-slate-400' : delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400';
  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-bold text-slate-800 leading-tight">{value}</p>
      {delta != null && (
        <p className={`text-xs mt-0.5 ${color}`}>{arrow} {Math.abs(delta)}%</p>
      )}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick}
        className="neo-kpi p-3 text-left w-full hover:ring-2 hover:ring-rose-300 transition-all cursor-pointer">
        {inner}
      </button>
    );
  }
  return <div className="neo-kpi p-3">{inner}</div>;
}

// Conversion funnel — flat 2D bars. Stage name + value above each bar.
// Active bar highlights in brand red; others in a lighter tint.
// Tooltip on hover shows value, conversion %, and drop-off %.
function PipelineFunnel({ funnel }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!funnel?.length) return null;

  const L    = 28;
  const HEAD = 48;
  const CH   = 110;
  const VW   = 560;
  const VH   = HEAD + CH;
  const n    = funnel.length;
  const colW = (VW - L) / n;
  const padX = Math.max(4, colW * 0.08);
  const bw   = colW - padX * 2;

  const maxVal = Math.max(...funnel.map(s => s.value), 1);
  const mag    = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const topVal = Math.ceil(maxVal * 1.15 / mag) * mag;
  const sy     = (v) => CH * (1 - Math.min(v, topVal) / topVal);

  const yFmt = (v) => {
    if (v === 0) return '0';
    if (v >= 1000) {
      const k = Math.round(v / 100) / 10;
      return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
    }
    return String(Math.round(v));
  };
  const yTicks = Array.from({ length: 5 }, (_, i) => topVal * i / 4);

  const activeSt = hoverIdx !== null ? funnel[hoverIdx] : null;
  const tip = activeSt ? (() => {
    const barH = CH - sy(activeSt.value);
    if (barH <= 0) return null;
    const midX = L + hoverIdx * colW + padX + bw / 2;
    const text = [
      activeSt.value.toLocaleString(),
      `Conversion: ${activeSt.convPct}%`,
      activeSt.dropPct > 0 ? `Drop-off: -${activeSt.dropPct}%` : null,
    ].filter(Boolean).join('  |  ');
    const tw = Math.max(110, text.length * 4.5 + 24);
    const tx = Math.max(L + tw / 2 + 2, Math.min(VW - tw / 2 - 2, midX));
    return { text, tw, tx, ty: HEAD + sy(activeSt.value) - 10 };
  })() : null;

  return (
    <div>
      <p className="text-[11px] font-medium text-slate-500 mb-1">
        Pipeline funnel
        <span className="text-slate-400 font-normal">
          {' '}— conversion through each stage this period
        </span>
      </p>
      <div className="relative" onMouseLeave={() => setHoverIdx(null)}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Pipeline conversion funnel"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          {/* Y gridlines + labels */}
          {yTicks.map((tick, ti) => {
            const cy = HEAD + sy(tick);
            return (
              <g key={ti}>
                <line x1={L} y1={cy} x2={VW} y2={cy}
                  stroke="rgba(148,163,184,0.2)" strokeWidth={0.8} />
                <text x={L - 4} y={cy + 3} textAnchor="end"
                  fontSize={7.5} fill="#94a3b8">
                  {yFmt(tick)}
                </text>
              </g>
            );
          })}

          {/* Bars + hit areas */}
          {funnel.map((stage, i) => {
            const bx     = L + i * colW + padX;
            const barTop = HEAD + sy(stage.value);
            const barH   = CH - sy(stage.value);
            const hot    = hoverIdx === i;
            return (
              <g key={stage.key}>
                {/* Transparent hit area covering full column */}
                <rect
                  x={L + i * colW} y={HEAD} width={colW} height={CH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                  style={{ cursor: 'default' }}
                />
                {/* Bar */}
                {barH > 0 && (
                  <rect
                    x={bx} y={barTop} width={bw} height={barH}
                    fill={hot ? '#EE1C25' : '#fca5a5'}
                    rx={2}
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {/* Stage label */}
                <text x={bx + bw / 2} y={12} textAnchor="middle"
                  fontSize={7.5} fill={hot ? '#475569' : '#94a3b8'}
                  style={{ pointerEvents: 'none' }}>
                  {stage.label}
                </text>
                {/* Value */}
                <text x={bx + bw / 2} y={27} textAnchor="middle"
                  fontSize={11} fill={hot ? '#0f172a' : '#64748b'}
                  style={{ fontWeight: hot ? '700' : '400', pointerEvents: 'none' }}>
                  {stage.value.toLocaleString()}
                </text>
                {/* Accent underline */}
                <rect x={bx + bw / 2 - 8} y={33} width={16} height={2.5}
                  rx={1.25} fill="#EE1C25"
                  opacity={hot ? 0.9 : 0.2}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          })}

          {/* Tooltip */}
          {tip && (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={tip.tx - tip.tw / 2} y={tip.ty - 17}
                width={tip.tw} height={19}
                rx={4} fill="white"
                stroke="rgba(148,163,184,0.3)" strokeWidth={0.7}
              />
              <text x={tip.tx} y={tip.ty - 4}
                textAnchor="middle" fontSize={8} fill="#1e293b">
                {tip.text}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

export function MonthlyKPIsSection({ params }) {
  const q = useAnalytics('monthly_kpis', params);
  const d = q.data;
  const [drillOpen, setDrillOpen] = useState(false);
  const trendAnimKey = useEntranceKey();

  // Pass the actual queried period into the drill panel so the equipment
  // breakdown matches what the scorecard tiles are showing — not the raw
  // `params` which may be empty ({}) for the default calendar-month view.
  const drillParams = useMemo(() => {
    const m = d?.meta;
    if (!m) return null;
    if (m.allTime) return {};
    return { from: m.fromDate, to: m.toDate };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.meta]);

  // Subtitle honours whatever the user actually picked. The old wording
  // always said "current month vs previous month" — which was factually
  // wrong when a custom range or All Time was selected, because the
  // queries themselves were then spanning something completely different.
  const subtitle = (() => {
    const m = d?.meta;
    if (!m) return 'Executive scorecard';
    if (m.allTime) return 'All recorded activity — no equal-length prior period';
    if (m.explicitRange && m.fromDate && m.toDate) {
      return `${m.fromDate} → ${m.toDate} vs the equivalent prior period`;
    }
    if (m.monthKey && m.prevMonthKey) return `${m.monthKey} vs ${m.prevMonthKey}`;
    return 'Current month vs previous month';
  })();

  return (
    <SectionCard
      title="Executive scorecard"
      subtitle={subtitle}
      icon={LayoutDashboard}
      {...q}
      hasData={() => !!d}
      className="col-span-full"
    >
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiTile label="Revenue"     value={kwd(d.kpis.revenue)}        delta={d.kpis.revenueDeltaPct} />
            <KpiTile label="Dispatches"  value={d.kpis.dispatches}          delta={d.kpis.dispatchesDeltaPct} />
            <KpiTile label="Utilisation" value={`${d.kpis.utilizationPct}%`} />
            <KpiTile label="Maint spend" value={kwd(d.kpis.maintSpend)} delta={d.kpis.maintSpendDeltaPct}
              onClick={drillParams !== null ? () => setDrillOpen(true) : undefined} />
            <KpiTile label="Procurement" value={kwd(d.kpis.procurementSpend)} delta={d.kpis.procurementDeltaPct} />
            <KpiTile label="New customers" value={d.kpis.newCustomers}      delta={d.kpis.newCustomersDeltaPct} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Avg turnaround" value={`${d.kpis.avgTurnaroundDays.toFixed(1)}d`} />
            <Kpi label="Maint jobs" value={d.kpis.maintJobs} />
            <Kpi label="Procurement count" value={d.kpis.procurementCount} />
            <Kpi label="Overdue returns" value={d.kpis.overdueCount} />
          </div>

          {/* Expands under the tile that opened it, rather than covering
              the whole scorecard. */}
          {drillOpen && drillParams !== null && (
            <MaintDrillPanel drillParams={drillParams} onClose={() => setDrillOpen(false)} />
          )}

          {/* Six-month context. Each tile above carries one month-on-month
              arrow, and at this volume a single month is noisy — the trend
              is what tells you whether an arrow is a direction or a blip. */}
          {d.series?.trend?.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Six-month trend
                <span className="text-slate-400 font-normal"> — revenue against maintenance spend</span>
              </p>
              <ChartAnim animKey={trendAnimKey} variant="draw" className="h-44">
                <ResponsiveContainer>
                  <AreaChart data={d.series.trend} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 9 }} width={48} tickFormatter={(v) => v.toLocaleString()} />
                    <Tooltip
                      contentStyle={NEO_TOOLTIP_STYLE}
                      formatter={(v, k) => (k === 'dispatches' ? [v, 'Dispatches'] : [kwd(v), k === 'revenue' ? 'Revenue' : 'Maintenance'])}
                    />
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 10 }} />
                    <Area type="monotone" dataKey="revenue" name="Revenue"
                          stroke="#10b981" fill="#10b981" fillOpacity={0.13} isAnimationActive={false} />
                    <Area type="monotone" dataKey="maintSpend" name="Maintenance"
                          stroke="#EE1C25" fill="#EE1C25" fillOpacity={0.13} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          <PipelineFunnel funnel={d.breakdowns?.funnel} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi
              label="Collected"
              value={`${d.kpis.collectionRatePct}%`}
              sub={`${kwd(d.kpis.collected)} of ${kwd(d.kpis.revenue)}`}
            />
            <Kpi
              label="Cost ratio"
              value={d.kpis.costRatioPct != null ? `${d.kpis.costRatioPct}%` : '—'}
              sub={`${kwd(d.kpis.totalOutflow)} maintenance + procurement`}
            />
            <Kpi
              label="Revenue / dispatch"
              value={kwd(d.kpis.revenuePerDispatch)}
              sub={`${d.kpis.dispatches} dispatch${d.kpis.dispatches === 1 ? '' : 'es'}`}
            />
            <Kpi
              label="Fleet in workshop"
              value={`${d.kpis.fleetInMaint}/${d.kpis.fleetTotal}`}
              sub="excluded from utilisation"
            />
          </div>

          <ConfidenceNote confidence={d.meta?.confidence} />
          <Analysis sectionKey="monthly_kpis" result={d} template={tmpl_monthlyKPIs} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.14 Unit P&L (ESTIMATE) ────────────────────────────────────────────
//
// The decision card the whole 13-section stack was missing: which
// individual units are earning their keep and which are quietly losing us
// money. All figures are ESTIMATES — a full P&L would need COGS,
// depreciation, and labour rates that this ERP does not yet carry. The
// subtitle re-states the basis so a reader cannot mistake this for the
// finance ledger.
//
// Failure modes are already contained by SectionCard (loading / error /
// empty) and by ChatSectionBoundary (render-time throws). Rows are read
// through guarded locals so a partial payload never crashes render.

function unitPnLInsights(d) {
  // A tiny inline template — the same shape as insightTemplates.js entries
  // but kept local because this is a single section and the guidance is
  // cheap to derive from the KPIs already computed.
  const out = [];
  const k = d?.kpis;
  if (!k) return out;

  if (k.unitsMeasured === 0) {
    out.push({
      severity: 'info',
      headline: 'No unit activity in this window.',
      body: 'Widen the range or check that quotations, leases, and maintenance carry equipment links.',
    });
    return out;
  }

  if (k.loserCount > 0 && k.worstLoserLabel) {
    out.push({
      severity: 'warning',
      headline: `${k.worstLoserLabel} is losing ${kwd(Math.abs(k.worstLoserNet))} over this window.`,
      body: 'Repair frequency exceeds what rental / lease revenue is bringing in. Consider repricing, redeploying, or retiring.',
    });
  }
  if (k.idleWithCostCount > 0 && k.idleWithCostLabel) {
    out.push({
      severity: 'warning',
      headline: `${k.idleWithCostCount} unit${k.idleWithCostCount === 1 ? '' : 's'} cost money without earning any — starting with ${k.idleWithCostLabel}.`,
      body: 'Maintenance was spent on units that had no rental or lease activity in the window — the quietest form of loss.',
    });
  }
  if (k.totalNet > 0 && k.topEarnerLabel) {
    out.push({
      severity: 'positive',
      headline: `${k.topEarnerLabel} contributed ${kwd(k.topEarnerNet)}, the highest in the fleet.`,
      body: 'Worth understanding what makes this unit convert — capacity, location, customer mix — and applying it elsewhere.',
    });
  }
  if (k.totalNet !== 0) {
    out.push({
      severity: 'info',
      headline: `Fleet net contribution: ${kwd(k.totalNet)} across ${k.unitsMeasured} unit${k.unitsMeasured === 1 ? '' : 's'}.`,
      body: `Revenue ${kwd(k.totalRevenue)} against maintenance ${kwd(k.totalCost)}. Excludes overheads, depreciation, and labour rates.`,
    });
  }
  return out;
}

// A signed KWD tile for the headline net-contribution number. Colours the
// value emerald / rose / slate directly on the number so the tone reads
// even before the reader parses the sign. Neutral tone is used for a zero.
function SignedKwdTile({ label, value, sub }) {
  const tone = value > 0 ? 'text-emerald-600'
             : value < 0 ? 'text-rose-600'
             : 'text-slate-700';
  return (
    <div className="neo-kpi p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold leading-tight ${tone}`}>
        {value > 0 ? '+' : ''}{kwd(value)}
      </p>
      {sub && <p className="text-[10px] text-slate-400 truncate mt-0.5">{sub}</p>}
    </div>
  );
}

// A compact ranking row for the earners / losers lists. Sits inside a
// `<ul class="space-y-2">` — this shares spacing with InsightList but is
// distinguished structurally by the coloured left rail on the left edge.
function PnLRankRow({ row, tone, onClick }) {
  const rail = tone === 'earner' ? 'bg-emerald-400' : 'bg-rose-400';
  const netTone = tone === 'earner' ? 'text-emerald-700' : 'text-rose-700';
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <li
      className="flex items-stretch gap-2 rounded-lg border border-slate-100 bg-white/70 overflow-hidden"
      title={row.equipment_id}
    >
      <span aria-hidden="true" className={`w-1 shrink-0 ${rail}`} />
      <Wrapper
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={clsx('flex-1 min-w-0 py-2 pr-3 text-left', onClick && 'hover:bg-slate-50 transition-colors')}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-800 truncate">
            {row.label}
          </span>
          <span className={`text-xs font-semibold whitespace-nowrap ${netTone}`}>
            {row.net > 0 ? '+' : ''}{kwd(row.net)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
          <span>Rev {kwd(row.revenue)}</span>
          <span>·</span>
          <span>Maint {kwd(row.maintenanceCost)}</span>
          {row.marginPct != null && (
            <>
              <span>·</span>
              <span>{row.marginPct}% margin</span>
            </>
          )}
        </div>
      </Wrapper>
    </li>
  );
}

export function UnitPnLSection({ params }) {
  const [effectiveParams, cardRange, setCardRange] = useCardRange('unit_pnl', params);
  const q = useAnalytics('unit_pnl', effectiveParams);
  const d = q.data;
  const isMobile = useIsMobile();
  const [drillUnit, setDrillUnit] = useState(null); // {equipment_id, label} or null

  const hasData = useCallback((res) => (res?.kpis?.unitsMeasured ?? 0) > 0, []);

  const chartRows = d?.series?.pnl ?? [];
  const kpi = d?.kpis;
  const earners = d?.breakdowns?.earners ?? [];
  const losers  = d?.breakdowns?.losers ?? [];

  return (
    <SectionCard
      title="Unit P&L (estimate)"
      subtitle={sectionPeriod(d?.meta, 90, ' · estimate, excludes overheads & depreciation')}
      icon={DollarSign}
      {...q}
      hasData={hasData}
      emptyMessage="No units carry both revenue and cost in this window yet. Widen the range or ensure quotations / leases link to equipment_id."
      filter={<DateRangeFilter range={cardRange} onChange={setCardRange} disabled={q.isLoading} />}
      resetAction={<CardResetButton onClick={() => setCardRange(DEFAULT_RANGE)} disabled={q.isLoading} />}
    >
      {d && (
        <div className="space-y-4">
          {/* Headline row: signed net + supporting counts */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <SignedKwdTile
              label="Fleet net"
              value={kpi.totalNet}
              sub={`across ${kpi.unitsMeasured} unit${kpi.unitsMeasured === 1 ? '' : 's'}`}
            />
            <Kpi label="Revenue"   value={kwd(kpi.totalRevenue)} sub="rental + lease" />
            <Kpi label="Maint cost" value={kwd(kpi.totalCost)}   sub="completed jobs" />
            <Kpi label="Earners"   value={kpi.earnerCount}       sub="net positive" />
            <Kpi label="Losers"    value={kpi.loserCount}        sub="net negative" />
            <Kpi
              label="Cost without revenue"
              value={kpi.idleWithCostCount}
              sub="silent losses"
              title={kpi.idleWithCostLabel || undefined}
            />
          </div>

          {/* Signed P&L bar chart. Recharts renders negative bars below the
              zero axis; each bar is coloured per-cell so earners read green
              and losers read red on the same visual. */}
          {chartRows.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-slate-500 mb-1.5">
                Net contribution per unit
                <span className="text-slate-400 font-normal"> — top earners and worst losers · click a bar for its maintenance records</span>
              </p>
              {/* `signed` — this is the one diverging chart on the surface:
                  losses render left of the zero axis and must grow OUT of
                  it, not away from it. */}
              <ChartAnim animKey={q.dataUpdatedAt} bars="horizontal" signed className={isMobile ? 'h-64' : 'h-72'}>
                <ResponsiveContainer>
                  <BarChart
                    data={chartRows}
                    layout="vertical"
                    margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.18)" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => v.toLocaleString()}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={isMobile ? 90 : 140}
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => axisLabel(v, isMobile ? 12 : 22)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={NEO_TOOLTIP_STYLE}
                      cursor={false}
                      content={(props) => (
                        <NamedTooltip
                          {...props}
                          idOf={(r) => r.equipment_id}
                          rows={(r) => [
                            { label: 'Net',     value: `${r.net > 0 ? '+' : ''}${kwd(r.net)}` },
                            { label: 'Revenue', value: kwd(r.revenue) },
                            { label: 'Maint',   value: kwd(r.cost) },
                          ]}
                        />
                      )}
                    />
                    <Bar
                      dataKey="net" radius={[4, 4, 4, 4]} isAnimationActive={false}
                      onClick={(r) => r?.equipment_id && setDrillUnit({ equipment_id: r.equipment_id, label: r.label })}
                      style={{ cursor: 'pointer' }}
                    >
                      {chartRows.map((row) => (
                        <Cell
                          key={row.equipment_id}
                          fill={row.net >= 0 ? '#10b981' : '#EE1C25'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartAnim>
            </div>
          )}

          {/* Twin ranking lists. On mobile they stack; on md+ they sit
              side-by-side so a reader can compare edges of the distribution
              in one glance. */}
          {(earners.length > 0 || losers.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <TrendingUp size={12} className="text-emerald-500" />
                  Top earners
                </p>
                {earners.length > 0 ? (
                  <ul className="space-y-2">
                    {earners.slice(0, 5).map((r) => (
                      <PnLRankRow
                        key={r.equipment_id} row={r} tone="earner"
                        onClick={() => setDrillUnit({ equipment_id: r.equipment_id, label: r.label })}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-400 italic">
                    Nothing currently net-positive in this window.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <TrendingDown size={12} className="text-rose-500" />
                  Worst losers
                </p>
                {losers.length > 0 ? (
                  <ul className="space-y-2">
                    {losers.slice(0, 5).map((r) => (
                      <PnLRankRow
                        key={r.equipment_id} row={r} tone="loser"
                        onClick={() => setDrillUnit({ equipment_id: r.equipment_id, label: r.label })}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-400 italic">
                    Nothing currently net-negative — every measured unit is earning.
                  </p>
                )}
              </div>
            </div>
          )}

          {drillUnit && (
            <MaintRecordsPanel
              params={effectiveParams}
              equipmentId={drillUnit.equipment_id}
              unitLabelText={drillUnit.label}
              onClose={() => setDrillUnit(null)}
            />
          )}

          {/* Basis disclosure. This section's whole credibility rides on
              stating what is and is not in the number, so it is called out
              directly rather than being buried in a tooltip. */}
          <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
            <span className="font-medium text-slate-600">Estimate basis:</span>{' '}
            {d.meta?.basisNote}
          </div>

          <ConfidenceNote confidence={d.meta?.confidence} />
          <InsightList insights={safeInsights(unitPnLInsights, d)} />
        </div>
      )}
    </SectionCard>
  );
}

// ── 4.15 Fleet Action Queue ─────────────────────────────────────────────
//
// Three colour-coded groups: amber = idle units, rose = grounded units,
// violet = outstanding collections. Each row carries the unit / customer
// name in the UI, with the equipment_id / customer_id on hover per the
// analytics naming invariant.

// A colour-coded row for a single action item. Works for all three signal
// types (idle / grounded / collection) so every group uses the same DOM shape.
function ActionRow({ item }) {
  const isIdle      = item.action === 'idle';
  const isGrounded  = item.action === 'grounded';
  const isOverdue   = item.action === 'overdue';
  const highP       = item.priority === 'high';

  const rail = isIdle
    ? (highP ? 'bg-amber-500'    : 'bg-amber-300')
    : isGrounded
    ? (highP ? 'bg-rose-500'     : 'bg-rose-300')
    : isOverdue
    ? (highP ? 'bg-orange-600'   : 'bg-orange-400')
    : (highP ? 'bg-violet-500'   : 'bg-violet-300');

  const border = isIdle     ? 'border-amber-100'
    : isGrounded  ? 'border-rose-100'
    : isOverdue   ? 'border-orange-100'
    : 'border-violet-100';
  const accent = isIdle     ? 'text-amber-700'
    : isGrounded  ? 'text-rose-700'
    : isOverdue   ? 'text-orange-700'
    : 'text-violet-700';
  const subAcc = isIdle ? 'text-amber-500' : 'text-rose-500';

  const isCollection = item.action === 'collection';
  const name   = isCollection ? item.company_name  : item.unit_label;
  const idAttr = isCollection ? (item.customer_id ?? '') : (item.equipment_id ?? '');

  const rightLabel = isIdle
    ? (item.idle_days !== null ? `${item.idle_days}d idle` : 'never hired')
    : isGrounded
    ? (item.days_grounded !== null ? `${item.days_grounded}d in workshop` : 'in workshop')
    : isOverdue
    ? (item.days_overdue > 0 ? `${item.days_overdue}d overdue` : 'overdue')
    : kwd(item.outstanding_kwd);

  return (
    <li className={`flex items-stretch gap-2 rounded-lg border ${border} bg-white/70 overflow-hidden`} title={idAttr}>
      <span aria-hidden="true" className={`w-1 shrink-0 ${rail}`} />
      <div className="flex-1 min-w-0 py-2 pr-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-800 truncate">{name}</span>
          <span className={`text-xs font-semibold whitespace-nowrap ${accent}`}>{rightLabel}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5 flex-wrap">
          {!isCollection ? (
            <>
              {item.location && <span>{item.location}</span>}
              {item.rate_kwd > 0 && <><span>·</span><span>KWD {item.rate_kwd}/d</span></>}
              {item.forgone_kwd > 0 && (
                <><span>·</span><span className={subAcc}>{kwd(item.forgone_kwd)} forgone</span></>
              )}
              {isGrounded && item.issue_type && <><span>·</span><span>{item.issue_type}</span></>}
              {isOverdue && item.return_date && (
                <><span>·</span><span>due back {item.return_date}</span></>
              )}
            </>
          ) : (
            <>
              <span>{item.invoice_count} invoice{item.invoice_count === 1 ? '' : 's'}</span>
              {item.oldest_invoice_date && (
                <><span>·</span><span>oldest {item.oldest_invoice_date}</span></>
              )}
              {item.max_days_late > 0 && (
                <><span>·</span><span className="text-rose-600">up to {item.max_days_late}d overdue</span></>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function FleetActionQueueSection({ params }) {
  const q = useAnalytics('fleet_action_queue', params ?? {});
  const d = q.data;
  const k = d?.kpis ?? {};
  const idle       = d?.breakdowns?.idle       ?? [];
  const grounded   = d?.breakdowns?.grounded   ?? [];
  const collection = d?.breakdowns?.collection ?? [];
  const overdue    = d?.breakdowns?.overdue    ?? [];
  const noActions  = d && !k.totalActions;

  return (
    <SectionCard
      title="Fleet Action Queue"
      subtitle={
        d?.meta
          ? `Live as of ${d.meta.asOf} · ${k.highPriorityCount ?? 0} high-priority action${k.highPriorityCount === 1 ? '' : 's'}`
          : 'What to act on today'
      }
      icon={AlertOctagon}
      {...q}
      hasData={() => !!d}
    >
      {d && (
        <div className="space-y-5">
          {/* Summary KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Total actions"   value={k.totalActions ?? 0}
               sub={k.overdueCount > 0 ? `${k.overdueCount} overdue return${k.overdueCount === 1 ? '' : 's'}` : undefined}
               title="Actions surfaced across all four signals" />
            <Kpi label="High priority"   value={k.highPriorityCount ?? 0}     title="Items past the high-priority threshold" />
            <Kpi label="Forgone revenue" value={kwd(k.totalForgoneKwd ?? 0)} sub="idle + grounded" />
            <Kpi label="Collections"     value={kwd(k.totalOutstandingKwd ?? 0)} sub="unpaid invoices" />
          </div>

          {noActions && (
            <p className="text-sm text-slate-500 text-center py-6">
              All signals clear — no idle units past {d.meta.idleThresholdDays} days, no grounded units,
              no overdue returns, and no outstanding invoices above KWD {d.meta.collectionThresholdKwd}.
            </p>
          )}

          {/* Idle units */}
          {idle.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                <Clock size={12} />
                Idle units ({idle.length}) — Available but not dispatched
              </p>
              <ul className="space-y-1.5">
                {idle.map(a => <ActionRow key={a.equipment_id} item={a} />)}
              </ul>
            </div>
          )}

          {/* Grounded units */}
          {grounded.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-rose-700 mb-2 flex items-center gap-1.5">
                <Wrench size={12} />
                In workshop ({grounded.length}) — Maintenance status
              </p>
              <ul className="space-y-1.5">
                {grounded.map(a => <ActionRow key={a.equipment_id} item={a} />)}
              </ul>
            </div>
          )}

          {/* Collection items */}
          {collection.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-violet-700 mb-2 flex items-center gap-1.5">
                <DollarSign size={12} />
                Collections due ({collection.length}) — outstanding invoices
              </p>
              <ul className="space-y-1.5">
                {collection.map((a, i) => <ActionRow key={a.customer_id ?? i} item={a} />)}
              </ul>
            </div>
          )}

          {/* Signal 4: Overdue returns — dispatched units past their scheduled
              return date. Different from grounded (workshop): these are on a
              job site and simply haven't come back when they were supposed to. */}
          {overdue.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
                <RefreshCcw size={12} />
                Overdue returns ({overdue.length}) — past scheduled return date
              </p>
              <ul className="space-y-1.5">
                {overdue.map(a => <ActionRow key={a.equipment_id} item={a} />)}
              </ul>
            </div>
          )}

          <ConfidenceNote confidence={d.meta?.confidence} />
          <InsightList insights={safeInsights(tmpl_fleetActionQueue, d)} />
        </div>
      )}
    </SectionCard>
  );
}
