// ═════════════════════════════════════════════════════════════════════════
// Operational overview — the data behind the Operational Dashboard.
//
// One fetch, one pass, one shape. The dashboard renders whatever this
// returns and never queries Supabase itself, so there is exactly one place
// where a schema change or an outage has to be handled.
//
// The chain it models is the one the business actually runs on:
//
//   Requirement → Quote → Order (approved quote) → Dispatch → Delivery → Return
//
// Every stage is counted on a single, stated date so the ratios between
// them are honest:
//   quotes     — quotations.quotation_date
//   orders     — quotations.quotation_date, status Approved/Invoiced
//   dispatches — dispatches.dispatch_date (created_at when null, matching
//                getDispatchTrends in api/analytics.js)
//   deliveries — dispatches that reached a terminal delivered state
//                (Completed / Returned), counted on their dispatch date
//   returns    — dispatches.actual_return_date (return_date when null),
//                which is the same "a return happened" definition
//                getReturnTrends uses
//
// Failure policy: a query that errors resolves to [] with a console warning
// and the section renders an empty state. A totally empty result is a valid
// answer, not an error — `meta.empty` says so and the UI shows the "no
// activity in this window" panel rather than a spinner that never ends.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabaseClient';
import {
  screenQuotations, screenDispatches, rankFlags,
} from '../lib/operationalAnomalies';
import {
  buildDailySeries, forecastSeries, isoDay, addDays, daysApart,
} from '../lib/forecast';

// Statuses that mean "the customer committed" — the order/booking stage.
// 'Invoiced' is included because a quote that has already been billed was
// unambiguously won; excluding it would under-count older bookings.
const ORDER_STATUSES = ['Approved', 'Invoiced'];

// A dispatch that reached the site. 'Returned' is a delivery too — the kit
// went out and came back; it is not a failed delivery.
const DELIVERED_STATUSES = ['Completed', 'Returned'];

// PostgREST caps a request at 1,000 rows by default. Six months of POC data
// is comfortably under this, but an explicit ceiling documents the limit
// instead of silently truncating a longer window.
const ROW_LIMIT = 5000;

async function safeQuery(builder, tag) {
  try {
    const { data, error } = await builder;
    if (error) {
      console.warn(`[operations:${tag}]`, error.message ?? error);
      return { rows: [], failed: true };
    }
    if (!Array.isArray(data)) return { rows: [], failed: false };
    return { rows: data.filter(r => r != null), failed: false };
  } catch (err) {
    console.warn(`[operations:${tag}] threw`, err?.message ?? err);
    return { rows: [], failed: true };
  }
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const delta = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

function bump(map, key, by = 1) {
  if (!key) return;
  const n = Number(by);
  map.set(key, (map.get(key) ?? 0) + (Number.isFinite(n) ? n : 0));
}

// ── Pure model builder ─────────────────────────────────────────────────
//
// Everything below the fetch boundary is a pure function of its rows. That
// is deliberate: this is the part with all the arithmetic in it, so it has
// to be runnable — and assertable — without a database. See
// scripts/verify_operational_model.mjs, which feeds it the generated POC
// dataset and checks that each seeded scenario actually shows up.
export function buildOperationalModel({
  quotations = [],
  dispatches: dispatchRows = [],
  returns: returnRows = [],
  requirements = [],
  fromDate,
  toDate,
  days = null,
  horizons = [30, 60, 90],
  failed = false,
} = {}) {
  const quotes = screenQuotations(quotations);
  const dispatches = screenDispatches(dispatchRows);
  const returns = screenDispatches(returnRows);

  const flags = rankFlags([...quotes.flags, ...dispatches.flags]);

  // ── Daily buckets ────────────────────────────────────────────────────
  const cQuotes = new Map(), cValue = new Map(), cOrders = new Map(), cOrderValue = new Map();
  for (const q of quotes.clean) {
    bump(cQuotes, q.date);
    bump(cValue, q.date, q.value_kwd);
    if (ORDER_STATUSES.includes(q.status)) {
      bump(cOrders, q.date);
      bump(cOrderValue, q.date, q.value_kwd);
    }
  }

  const cDispatch = new Map(), cDelivered = new Map(), cReturns = new Map();
  for (const d of dispatches.clean) {
    bump(cDispatch, d.date);
    if (DELIVERED_STATUSES.includes(d.status)) bump(cDelivered, d.date);
  }

  // De-duplicated by dispatch id: the returns query and the dispatch query
  // overlap for anything dispatched AND returned inside the window, and
  // counting those twice would inflate the return rate.
  const countedReturns = new Set();
  for (const d of returns.clean) {
    if (!d.returnedOn || countedReturns.has(d.dispatch_id)) continue;
    if (d.returnedOn >= fromDate && d.returnedOn <= toDate) {
      countedReturns.add(d.dispatch_id);
      bump(cReturns, d.returnedOn);
    }
  }

  const cRequirements = new Map();
  for (const r of Array.isArray(requirements) ? requirements : []) {
    if (r) bump(cRequirements, isoDay(r.created_at));
  }

  const series = {
    quotes:       buildDailySeries(cQuotes, fromDate, toDate),
    quoteValue:   buildDailySeries(cValue, fromDate, toDate),
    orders:       buildDailySeries(cOrders, fromDate, toDate),
    orderValue:   buildDailySeries(cOrderValue, fromDate, toDate),
    dispatches:   buildDailySeries(cDispatch, fromDate, toDate),
    deliveries:   buildDailySeries(cDelivered, fromDate, toDate),
    returns:      buildDailySeries(cReturns, fromDate, toDate),
    requirements: buildDailySeries(cRequirements, fromDate, toDate),
  };

  // Backlog is the running gap between what was ordered and what has left
  // the yard. It is the clearest picture of "dispatch is falling behind
  // orders" — a ratio can hide a growing absolute queue.
  let running = 0;
  series.backlog = series.orders.map((p, i) => {
    running = Math.max(0, running + p.value - (series.dispatches[i]?.value ?? 0));
    return { date: p.date, value: running };
  });

  // Rolling 14-day return rate. A daily ratio on counts this small is pure
  // noise; two weeks is long enough to be stable and short enough to still
  // show a genuine return-rate surge.
  const WIN = 14;
  series.returnRate = series.returns.map((p, i) => {
    const from = Math.max(0, i - WIN + 1);
    let ret = 0, disp = 0;
    for (let k = from; k <= i; k++) {
      ret += series.returns[k].value;
      disp += series.dispatches[k].value;
    }
    return { date: p.date, value: disp > 0 ? Math.round((ret / disp) * 1000) / 10 : 0 };
  });

  // ── Forecasts ────────────────────────────────────────────────────────
  //
  // Each series is forecast independently, so one failing (too little
  // history, all zeros) never affects the others.
  const forecasts = {
    quotes:     forecastSeries(series.quotes,     { horizons, integer: true }),
    quoteValue: forecastSeries(series.quoteValue, { horizons, integer: true }),
    orders:     forecastSeries(series.orders,     { horizons, integer: true }),
    dispatches: forecastSeries(series.dispatches, { horizons, integer: true }),
    deliveries: forecastSeries(series.deliveries, { horizons, integer: true }),
    returns:    forecastSeries(series.returns,    { horizons, integer: true }),
  };

  // ── Period KPIs: last 30 days against the 30 before it ───────────────
  const sumLast = (arr, n, offset = 0) => {
    const end = arr.length - offset;
    return arr.slice(Math.max(0, end - n), Math.max(0, end)).reduce((s, p) => s + p.value, 0);
  };
  const kpiFor = (key) => {
    const cur = sumLast(series[key], 30);
    const prev = sumLast(series[key], 30, 30);
    return {
      value: Math.round(cur * 1000) / 1000,
      prev: Math.round(prev * 1000) / 1000,
      deltaPct: delta(cur, prev),
    };
  };

  const k = {
    quotes: kpiFor('quotes'),
    quoteValue: kpiFor('quoteValue'),
    orders: kpiFor('orders'),
    dispatches: kpiFor('dispatches'),
    deliveries: kpiFor('deliveries'),
    returns: kpiFor('returns'),
  };

  const kpis = {
    ...k,
    // Stage-to-stage conversion over the same 30 days — the numbers that
    // make the chain readable as a chain.
    quoteToOrderPct: pct(k.orders.value, k.quotes.value),
    orderToDispatchPct: pct(k.dispatches.value, k.orders.value),
    dispatchToDeliveryPct: pct(k.deliveries.value, k.dispatches.value),
    returnRatePct: pct(k.returns.value, k.dispatches.value),
    avgQuoteValue: k.quotes.value > 0 ? Math.round(k.quoteValue.value / k.quotes.value) : 0,
    backlog: series.backlog.length ? series.backlog[series.backlog.length - 1].value : 0,
  };

  const reqCount = Array.isArray(requirements) ? requirements.length : 0;
  const totalActivity = quotes.stats.usable + dispatches.stats.usable + reqCount;

  return {
    series,
    forecasts,
    kpis,
    anomalies: flags,
    quality: {
      quotations: quotes.stats,
      dispatches: dispatches.stats,
      // The one number that answers "can I trust the chart above?"
      excluded: quotes.stats.total - quotes.stats.usable,
    },
    meta: {
      fromDate,
      toDate,
      days: days ?? ((daysApart(fromDate, toDate) ?? 0) + 1),
      horizons,
      empty: totalActivity === 0,
      failed,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ── Main entry ─────────────────────────────────────────────────────────
//
// `days` is the history window ending today. 180 gives the forecast a full
// six months to learn from while still fitting on one screen.
export async function getOperationalOverview({ days = 180, horizons = [30, 60, 90] } = {}) {
  const today = isoDay(new Date());
  const fromDate = addDays(today, -Math.max(1, days) + 1);

  // The window is applied on the DATE column for quotations, and on both
  // dispatch_date and created_at for dispatches, because dispatch_date is
  // nullable — see getDispatchTrends in api/analytics.js for the same split.
  const [quotationsQ, dispatchesDated, dispatchesUndated, requirementsQ, returnsQ] = await Promise.all([
    safeQuery(
      supabase.from('quotations')
        .select('quotation_id, quotation_date, created_at, status, total_amount_kwd, customer_id, customers(company_name)')
        .gte('quotation_date', fromDate)
        .lte('quotation_date', today)
        .limit(ROW_LIMIT),
      'quotations'
    ),
    safeQuery(
      supabase.from('dispatches')
        .select('dispatch_id, quotation_id, dispatch_date, created_at, return_date, actual_return_date, status, destination')
        .gte('dispatch_date', fromDate)
        .lte('dispatch_date', today)
        .limit(ROW_LIMIT),
      'dispatches'
    ),
    safeQuery(
      supabase.from('dispatches')
        .select('dispatch_id, quotation_id, dispatch_date, created_at, return_date, actual_return_date, status, destination')
        .is('dispatch_date', null)
        .gte('created_at', `${fromDate}T00:00:00Z`)
        .limit(ROW_LIMIT),
      'dispatches.undated'
    ),
    safeQuery(
      supabase.from('requirements')
        .select('requirement_id, created_at, status')
        .gte('created_at', `${fromDate}T00:00:00Z`)
        .limit(ROW_LIMIT),
      'requirements'
    ),
    // Returns are dated by when the kit CAME BACK, which may be inside the
    // window even when the dispatch that produced it is not. Querying them
    // separately is what stops the return-rate line being truncated at the
    // left edge of a long rental.
    safeQuery(
      supabase.from('dispatches')
        .select('dispatch_id, dispatch_date, created_at, return_date, actual_return_date, status')
        .gte('actual_return_date', fromDate)
        .lte('actual_return_date', today)
        .limit(ROW_LIMIT),
      'returns'
    ),
  ]);

  return buildOperationalModel({
    quotations: quotationsQ.rows,
    dispatches: [...dispatchesDated.rows, ...dispatchesUndated.rows],
    // Both sources: the dedicated return query catches long rentals that
    // started before the window, and the dispatch rows catch returns whose
    // actual_return_date is null but whose return_date is set. The model
    // de-duplicates by dispatch id.
    returns: [...returnsQ.rows, ...dispatchesDated.rows],
    requirements: requirementsQ.rows,
    fromDate,
    toDate: today,
    days,
    horizons,
    failed: quotationsQ.failed && dispatchesDated.failed,
  });
}

export default getOperationalOverview;
