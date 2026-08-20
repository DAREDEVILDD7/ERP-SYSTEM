// ═════════════════════════════════════════════════════════════════════════
// Analytics window resolution — the ONE place that maps the page's date
// filter (ctx) to the fetch params each section actually asks for.
//
// Why this module exists
// ----------------------
// Every analytics fetcher takes an optional `{ days, from, to, allTime }`
// params object. Different consumers of the same fetcher (Section render,
// AnomalyRibbon, OverviewPanel MoneyMap, ForecastCard) used to compute
// those params inline — and drifted apart. The Section would honour the
// page's date filter while the Ribbon defaulted to the fetcher's own
// window, so the same "top_customers" query ran with TWO different date
// windows on the same page and produced TWO different results. React
// Query then cached them under different keys, so brief and chart could
// contradict each other.
//
// This module fixes it: every consumer calls `paramsFor(sectionKey, ctx)`
// and gets the exact params the corresponding Section would use, so all
// consumers of a given sectionKey share ONE React Query cache entry and
// therefore ONE dataset. When the user changes the date filter, every
// surface refetches together and stays consistent.
//
// Per-section bounds are declared once here rather than at each render
// site. Adding a new section that has natural min/max window semantics
// is a one-line edit to SECTION_BOUNDS below.
// ═════════════════════════════════════════════════════════════════════════

// Resolve the window a section should actually query.
//
// The page-level selector is a single value shared by many sections
// whose natural periods differ. Most sections clamp it — a 30-day
// maintenance window would show almost nothing, a 365-day "most rented"
// is not a current-demand question. But an EXPLICIT range (a user pick
// or a follow-up chip) is what the transcript / subtitle already claims,
// so clamping it silently renders an answer that contradicts its own
// label. Explicit ranges therefore win outright; clamps only apply to
// the page selector.
export function win(ctx, { min, max } = {}) {
  const raw = Number(ctx?.windowDays);
  let d = Number.isFinite(raw) ? raw : 90;
  if (ctx?.explicit) return d;
  if (Number.isFinite(min)) d = Math.max(d, min);
  if (Number.isFinite(max)) d = Math.min(d, max);
  return d;
}

// The full params a windowed section passes to its fetcher.
//
// Two shapes, deliberately: a chosen date range travels as explicit
// `from`/`to` edges, while the default travels as a day count exactly as
// it always has. That is what keeps the filter additive — with nothing
// selected, every section still resolves its own rolling window and its
// own clamp, so the page behaves precisely as it did before the filter
// existed.
//
// An explicit range is never clamped, for the same reason a follow-up
// override is not: the header states the period and the transcript
// quotes it, so silently narrowing it renders an answer that contradicts
// its own label.
export function winParams(ctx, bounds) {
  const days = win(ctx, bounds);
  if (ctx?.explicit && ctx?.from && ctx?.to) {
    // `allTime` rides along so a section can label the period "All time"
    // rather than printing the synthetic 2000-01-01 floor.
    return {
      days,
      from: ctx.from,
      to: ctx.to,
      allTime: ctx.allTime || undefined,
    };
  }
  return { days };
}

// Per-section window bounds. Every entry:
//   * min:  minimum days for the rolling default (never clamps explicit)
//   * max:  maximum days for the rolling default
//   * null: no window at all (snapshot section; params stays empty)
//   * {}:   windowed but no clamp
//
// If a section is not listed here, callers get {} — a bare windowed
// query. Adding a new analytics section is a one-line edit.
//
// Kept in sync with the render calls in pages/analytics/AnalyticsPage.jsx
// so ribbon / overview / chat-section all resolve identical params for
// the same section key, and therefore share React Query cache entries.
export const SECTION_BOUNDS = {
  most_rented:           { max: 30 },
  dispatch_trends:       {},
  return_trends:         {},
  recent_leases:         { max: 30 },
  revenue_by_category:   {},
  top_customers:         { min: 365 },
  most_procured:         {},
  procurement_vs_lease:  { min: 365 },
  maintenance_cost:      { min: 365 },
  maintenance_frequency: { min: 180 },
  unit_pnl:              { min: 60 },
  // Snapshot / live-state sections: no window.
  utilization:           null,
  idle_vs_active:        null,
  // Scorecard: no bounds, moves with the filter.
  monthly_kpis:          {},
  // Forecast: forward-looking, uses its own horizonDays param, ignores
  // the page date filter entirely.
  forward_forecast:      null,
};

// Resolve the params object for a given section key + page ctx.
//
// Returns:
//   * undefined  → the fetcher should be called with no params (snapshot)
//   * {} / {days} / {days, from, to, allTime} → windowed fetcher params
//
// Consumers pass the return value straight into useAnalytics(key, params).
// A section not in SECTION_BOUNDS resolves as bounds={} — same as before.
export function paramsFor(sectionKey, ctx) {
  const bounds = SECTION_BOUNDS[sectionKey];
  if (bounds === null) return undefined;   // snapshot — no window at all
  return winParams(ctx, bounds ?? {});
}
