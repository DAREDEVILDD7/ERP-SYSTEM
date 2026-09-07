// ═════════════════════════════════════════════════════════════════════════
// Analytics — read-only aggregations for the Analytics page.
//
// Design principle: every function is defensive.
//   * a table that isn't migrated on this environment returns [] / null,
//     never throws;
//   * a query that returns no rows resolves to an empty-result shape the
//     UI's "insufficient data" branch handles;
//   * date-range params default per-section, but callers may widen them.
//
// The returned shape is always `{ kpis, series, breakdowns, meta }` so the
// insight templates in lib/insightTemplates.js can read the same keys.
// ═════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabaseClient';
import {
  typeName, unitLabel, coverage, confidenceFrom, deltaPct,
} from '../lib/analyticsLabels';
// Record-level quotation screening, shared with the Operational Dashboard so
// there is exactly one definition of "this quote is wrong" in the codebase.
import { screenQuotations, rankFlags } from '../lib/operationalAnomalies';

// ── helpers ─────────────────────────────────────────────────────────────

// Returns { fromIso, toIso } for a rolling window ending "now"
// (inclusive of today, exclusive of tomorrow midnight).
function windowDays(days) {
  const to   = new Date();
  const from = new Date(); from.setDate(from.getDate() - days);
  return {
    fromIso: from.toISOString(),
    toIso:   to.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate:   to.toISOString().slice(0, 10),
  };
}

// The window of the SAME length immediately before `days` — the baseline any
// "compared with the previous period" claim is measured against. Returning
// both edges matters: the previous period is a half-open interval, so a row
// on the boundary must not be counted in both periods.
function previousWindow(days) {
  const to   = new Date(); to.setDate(to.getDate() - days);
  const from = new Date(); from.setDate(from.getDate() - 2 * days);
  return { prevFromIso: from.toISOString(), prevToIso: to.toISOString() };
}

const DAY_MS = 86_400_000;

// ── Explicit date ranges ────────────────────────────────────────────────
//
// Every windowed fetcher used to compute a rolling window ending NOW, which is
// the only thing a `days` count can express. The page's date filter also
// offers "This month", "Last month" and a custom from/to, and those have a
// real END — a rolling window cannot represent "the whole of last month", and
// on a system whose newest record is months old a rolling window returns
// nothing at all no matter how far back it reaches.
//
// So a fetcher's params may now carry `from`/`to` (ISO date strings). When
// both are present they win outright and `days` becomes derived rather than
// authoritative; when either is missing the fetcher behaves exactly as it did
// before. That is what keeps this additive: no call site that omits the range
// changes behaviour.
//
// Invalid or reversed input is repaired rather than thrown on — a filter that
// crashes every section is far worse than one that quietly falls back to the
// rolling window it replaced.
function parseRangeEdge(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

// `YYYY-MM-DD` in LOCAL time. Slicing an ISO string instead converts to UTC
// first, so east of Greenwich a range starting on the 1st is sent to a DATE
// column as the previous month's last day — a silent off-by-one that widens
// every `lease_start_date` / `service_date` / `issue_date` filter by a day and
// puts rows in the wrong period at both edges. Timestamp columns still get the
// full ISO instant, which is correct for them.
function localDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resolveWindow(params, fallbackDays) {
  const p = params ?? {};
  const days = Number.isFinite(Number(p.days)) && Number(p.days) > 0
    ? Number(p.days)
    : fallbackDays;

  let from = parseRangeEdge(p.from);
  let to   = parseRangeEdge(p.to);
  if (!from || !to) {
    const w = windowDays(days);
    return {
      ...w,
      fromDate: localDate(new Date(w.fromIso)),
      toDate: localDate(new Date(w.toIso)),
      days,
      explicitRange: false,
      allTime: false,
    };
  }
  // A reversed range is a user slip, not a reason to show nothing.
  if (from > to) { const t = from; from = to; to = t; }
  // The end date is inclusive: "1–31 Jan" must contain everything stamped on
  // the 31st, including a timestamp column's time-of-day component.
  const toEnd = new Date(to.getTime());
  toEnd.setHours(23, 59, 59, 999);
  const span = Math.max(1, Math.round((toEnd.getTime() - from.getTime()) / DAY_MS));
  return {
    fromIso: from.toISOString(),
    toIso:   toEnd.toISOString(),
    fromDate: localDate(from),
    toDate:   localDate(toEnd),
    days: span,
    explicitRange: true,
    // "All time" is still an explicit range — it just should not be printed
    // as a literal span, because its lower edge is a floor rather than a date
    // anyone selected.
    allTime: !!p.allTime,
  };
}

// The prior period a "% vs previous" comparison is measured against.
//
// Three shapes, chosen by the range in play:
//
//   * NON-EXPLICIT (default rolling window): equal-length span
//     immediately before, exactly as before. `previousWindow(days)`.
//
//   * EXPLICIT and ALIGNED TO A CALENDAR MONTH START (from is the 1st):
//     the SAME day range of the PREVIOUS calendar month. So This-Month
//     (Aug 1 – Aug 14) pairs with Jul 1 – Jul 14, not Jul 18 – Aug 1;
//     Last-Month (Jul 1 – Jul 31) pairs with Jun 1 – Jun 30. That is
//     what a human reads "previous period" to mean when they see a
//     current period that starts on a month boundary, and it stops the
//     comparison silently missing the first two thirds of a partial
//     month's history — which was surfacing everywhere as "no baseline".
//     The end day is clamped to the last day of the previous month so
//     "Mar 1 – Mar 31" pairs with "Feb 1 – Feb 28/29" rather than a
//     nonexistent Feb 31.
//
//   * EXPLICIT but NOT month-aligned (custom range not starting on the
//     1st): equal-length span immediately before, same as the historic
//     behaviour. A range like "Jul 15 → Aug 3" is not asking a
//     calendar-month question; its natural baseline is the preceding
//     19 days, and calendar-shifting a mid-month start produces a
//     surprising answer.
//
// Half-open at the top edge (prevTo is the current-from, not
// current-from minus one) so a row on the boundary is never counted in
// both periods.
//
// `allTime` short-circuits: the "prior period" for all-time is not
// meaningful (there is no data before the floor), so we still return
// an equal-length span before the floor — the fetcher's calling code
// treats an empty prev-set as "no baseline" and `describeRange` prints
// the honest "No prior period is comparable" line, both of which are
// already correct.
function resolvePrevWindow(params, fallbackDays) {
  const w = resolveWindow(params, fallbackDays);
  if (!w.explicitRange) return previousWindow(w.days);

  const curFrom = new Date(w.fromIso);
  const curTo = new Date(w.toIso);

  // Calendar-month-aware branch. Requires:
  //   * not all-time (shifting the 2000-01-01 floor back a month says
  //     nothing useful);
  //   * the current range starts on the 1st of a month (a month-aligned
  //     ask, whether it came from "This Month"/"Last Month" or a
  //     custom range picked on a month boundary);
  //   * the current range does NOT span into the next calendar month
  //     — a multi-month range's intuitive baseline is not a partial
  //     single-month window, so those fall through to the rolling
  //     equal-length branch below.
  const sameCalendarMonth =
    curFrom.getFullYear() === curTo.getFullYear() &&
    curFrom.getMonth() === curTo.getMonth();
  if (!w.allTime && curFrom.getDate() === 1 && sameCalendarMonth) {
    const prevFrom = new Date(
      curFrom.getFullYear(), curFrom.getMonth() - 1, 1, 0, 0, 0, 0,
    );
    // Last day of the previous month, for clamping when the current
    // range ends on a day that doesn't exist in the previous month
    // (e.g. current Mar 31 → prev Feb 28/29).
    const lastDayPrevMonth = new Date(
      prevFrom.getFullYear(), prevFrom.getMonth() + 1, 0,
    ).getDate();
    const targetEndDay = Math.min(curTo.getDate(), lastDayPrevMonth);
    const prevTo = new Date(
      prevFrom.getFullYear(), prevFrom.getMonth(), targetEndDay,
      23, 59, 59, 999,
    );
    return {
      prevFromIso: prevFrom.toISOString(),
      prevToIso:   prevTo.toISOString(),
    };
  }

  // Rolling equal-length prior for every other explicit range.
  const curFromMs = curFrom.getTime();
  const prevTo = new Date(curFromMs);
  const prevFrom = new Date(curFromMs - w.days * DAY_MS);
  return {
    prevFromIso: prevFrom.toISOString(),
    prevToIso:   prevTo.toISOString(),
  };
}

// Line-item quantity. The schema carries `received_qty` once goods are
// booked in and nothing before that, so an un-received line still counts as
// the one unit it represents rather than as zero.
function itemQty(item) {
  const received = Number(item?.received_qty);
  if (Number.isFinite(received) && received > 0) return received;
  const qty = Number(item?.quantity);
  if (Number.isFinite(qty) && qty > 0) return qty;
  return 1;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Trimmed display string, or '' for anything that should not reach a label.
// The literal strings "null"/"undefined" are screened out because they do
// occur in free-text columns and render as a real-looking category name.
function clean(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined' ? s : '';
}

// A defensive wrapper: any Supabase error just logs & returns [] so the
// downstream aggregator can carry on with partial data.
async function safeQuery(builder, tag) {
  try {
    const { data, error } = await builder;
    if (error) {
      // "relation does not exist" or PGRST205 (schema cache miss) mean the
      // table isn't in this environment — fall through to empty data.
      console.warn(`[analytics:${tag}]`, error.message ?? error);
      return [];
    }
    // Always an ARRAY, and never one containing holes.
    //
    // `data ?? []` alone still lets a non-list response (a `.single()` object,
    // or a driver returning a bare value) reach an aggregator that immediately
    // does `for...of` over it. Null ELEMENTS are the same problem one level
    // down: every fetcher dereferences row fields directly, so a single null
    // in the array throws inside the section render rather than here where it
    // can be contained. Screening both at this one boundary is what keeps the
    // thirteen aggregators free of defensive noise.
    if (!Array.isArray(data)) return [];
    return data.filter(row => row != null);
  } catch (err) {
    console.warn(`[analytics:${tag}] threw`, err?.message ?? err);
    return [];
  }
}

// This project's PostgREST instance caps an unbounded select at 1000 rows —
// measured directly against the live database, not assumed — and truncates
// SILENTLY: no error, no warning, just a short result. Worse, a query with
// no ORDER BY has no defined row order, and in practice PostgREST/Postgres
// tend to return rows close to physical/insertion order, so the rows most
// likely to fall off the truncated tail are the NEWEST ones — exactly where
// a just-created anomalous quote or invoice lives. `getTopCustomers`'s
// 365-day quotations window was already within 20 rows of this cliff, and
// `quotation_items` (fed to revenue-by-category, unit P&L and most-rented)
// had already silently crossed it.
//
// `PK_COLUMN` names, for every table `safeQueryAll` is asked to page, a
// column that is unique per row — this codebase's `<domain>_id` primary-key
// convention (see docs/database-schema.md). Pagination orders by it so page
// N+1 starts exactly where page N ended: ordering by a non-unique column
// (a date, a status) risks a row landing on both sides of a page boundary,
// or neither, whenever two rows tie on it — which seeded data does often.
export const PK_COLUMN = {
  invoices: 'invoice_id',
  quotations: 'quotation_id',
  lease_invoices: 'lease_invoice_id',
  quotation_items: 'item_id',
};

// Pages a query past the 1000-row cap. `buildPage` MUST be a FACTORY — a
// function returning a FRESH query builder — never an already-built one:
// a Supabase builder is a one-shot thenable that fires its network call the
// moment it is awaited, so the same instance cannot be reused for a second
// page. `pkColumn` must resolve through `PK_COLUMN`; passing anything else
// is a programming error, not a runtime condition, so it throws immediately
// rather than silently reintroducing the exact truncation this exists to
// close.
export async function safeQueryAll(buildPage, pkColumn, tag) {
  if (!pkColumn) {
    throw new Error(
      `[analytics:${tag}] safeQueryAll called with no pkColumn — add this ` +
      'table to PK_COLUMN in api/analytics.js so pagination can order ' +
      'deterministically. Refusing to run unordered, since that would ' +
      'silently reintroduce the 1000-row truncation this function exists ' +
      'to close.'
    );
  }
  const PAGE = 1000;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await safeQuery(
      buildPage().order(pkColumn, { ascending: true }).range(offset, offset + PAGE - 1),
      `${tag}[${offset}]`
    );
    rows.push(...page);
    if (page.length < PAGE) break;
    // Safety net against spinning forever if a misbehaving backend always
    // returns exactly PAGE rows. 200 pages is 200,000 rows — far beyond
    // anything this app seeds or expects to hold live; hitting this means
    // something is wrong with the query, not that more paging would help.
    if (offset / PAGE >= 199) {
      console.warn(`[analytics:${tag}] stopped after 200 pages (200,000 rows) — results may be incomplete`);
      break;
    }
  }
  return rows;
}

// Rows inside a window on a NULLABLE date column, without losing the rows
// whose date is null.
//
// This is the third place the same trap has bitten (dispatches, then leases
// and invoices): in SQL a NULL fails BOTH `>=` and `<=`, so a business date
// that is only populated later — `issue_date` on a draft invoice,
// `dispatch_date` on an unscheduled dispatch — silently removes the row from
// every window. The fix is two DISJOINT queries: one requiring the primary
// date, one requiring it to be null and falling back to the row's creation
// timestamp. Disjoint by construction, so nothing is counted twice, and
// neither over-fetches the way a client-side filter would.
//
// `effective_date` is stamped on every row so callers bucket and sort on one
// field without caring which query produced it.
export async function windowedRows(table, columns, opts) {
  const {
    primary, primaryFrom, primaryTo,
    fallback, fallbackFrom, fallbackTo,
    tag, tune,
  } = opts;
  const build = () => {
    const q = supabase.from(table).select(columns);
    return typeof tune === 'function' ? tune(q) : q;
  };
  // A table this helper is called with but that PK_COLUMN does not know is a
  // caller bug, not something to fail on for every user of the page — it
  // degrades to the OLD single-page behaviour (capped at 1000, same as
  // before this fix) with a loud console.warn, so it is caught in
  // development rather than silently under-counting in production.
  const pk = PK_COLUMN[table];
  if (!pk) {
    console.warn(
      `[analytics:windowedRows] "${table}" has no entry in PK_COLUMN (api/analytics.js) — ` +
      'pagination disabled for this call; results are capped at the PostgREST row limit. ' +
      `Add "${table}: '<its _id column>'" to PK_COLUMN.`
    );
  }
  const runWindow = (buildFiltered, subtag) => (
    pk ? safeQueryAll(buildFiltered, pk, `${tag}.${subtag}`) : safeQuery(buildFiltered(), `${tag}.${subtag}`)
  );
  const [dated, undated] = await Promise.all([
    runWindow(() => build().gte(primary, primaryFrom).lte(primary, primaryTo), 'dated'),
    fallback
      ? runWindow(
        () => build().is(primary, null).gte(fallback, fallbackFrom).lte(fallback, fallbackTo),
        'undated'
      )
      : Promise.resolve([]),
  ]);
  return [...dated, ...undated]
    .filter(Boolean)
    .map(r => ({ ...r, effective_date: r[primary] ?? (fallback ? r[fallback] : null) ?? null }));
}

// Statuses that mean "this document was voided", i.e. it never represents
// money. Everything else counts — an allow-list of statuses is what made the
// revenue section blind to any deployment whose workflow uses different
// wording, and reporting zero revenue is a far worse failure than including
// a status nobody had thought of.
const VOID_STATUSES = new Set([
  'cancelled', 'canceled', 'void', 'voided', 'rejected', 'declined',
]);
const isVoid = (status) => VOID_STATUSES.has(String(status ?? '').trim().toLowerCase());

function daysBetween(a, b) {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return (t2 - t1) / 86_400_000;
}

// ── Period-over-period series ───────────────────────────────────────────
//
// Slices the current window into `buckets` equal spans and counts (or sums)
// rows into each, then does the same for the same-length window immediately
// before it, aligning the two on bucket INDEX rather than on calendar date.
// Index alignment is the whole point: "the first eighth of this period"
// against "the first eighth of the last one" is comparable even when the
// window length is not a whole number of weeks or months, which a
// month-keyed series is not. The label is the current window's bucket edge,
// so the x-axis still reads as real dates.
//
// Returns `[{ bucket, current, previous }]`, always exactly `buckets` long —
// a chart with holes in it is worse than one with honest zeroes.
//
// The summing accessor is `sumOf`, NOT `valueOf`: destructuring a defaulted
// `valueOf` from an options object picks up `Object.prototype.valueOf` off
// the prototype chain, so the `= null` default never applies and every caller
// that omitted it would call `Object.prototype.valueOf` as a bare function —
// a TypeError, in the middle of the aggregation, taking the whole section's
// query down with it. Never name an optional option after an
// `Object.prototype` member.
// `buckets` used to default to a flat 8 regardless of window length, which
// is the reason a drag-to-zoom on any "vs previous period" chart looked
// broken: 30 days sliced into 8 buckets is ~3.75 days each, so dragging a
// selection across a single week could only ever land inside 1-2 of those
// already-blended buckets — there was no finer data left to reveal, because
// the individual events were summed away on the SERVER, before this array
// ever reached the browser. Zoom cannot invent detail that was discarded
// upstream; it can only crop what it was given.
//
// The fix is here, not in the zoom code: default to ONE BUCKET PER DAY — the
// finest granularity `dateOf` ever actually carries (a calendar date, never
// a sub-day timestamp that matters for this comparison) — capped so a very
// wide window (all-time) still renders as a readable chart rather than
// hundreds of hairline points. A caller that genuinely needs a specific
// bucket count can still pass one; none currently do, so every "vs previous
// period" chart gets real daily resolution for free.
function comparativeSeries(current, previous, {
  days, buckets, dateOf, sumOf = null,
} = {}) {
  const win = Math.max(1, Number(days) || 1);
  const requested = buckets != null ? Math.round(buckets) : Math.round(win);
  const n = Math.max(2, Math.min(90, requested || 8));
  const span = (win * 86_400_000) / n;
  const now = Date.now();
  const startCur = now - win * 86_400_000;
  const startPrev = startCur - win * 86_400_000;

  const out = [];
  for (let i = 0; i < n; i++) {
    const edge = new Date(startCur + (i + 1) * span);
    out.push({
      bucket: Number.isNaN(edge.getTime())
        ? `${i + 1}`
        : edge.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      current: 0,
      previous: 0,
    });
  }

  const fill = (rows, key, start) => {
    for (const r of rows ?? []) {
      let t;
      try { t = new Date(dateOf?.(r) ?? '').getTime(); } catch (_) { continue; }
      if (!Number.isFinite(t)) continue;
      const idx = Math.floor((t - start) / span);
      // The final bucket absorbs "now" exactly, which would otherwise land
      // one index past the end and be dropped.
      const slot = idx === n ? n - 1 : idx;
      if (slot < 0 || slot >= n) continue;
      out[slot][key] += sumOf ? num(sumOf(r)) : 1;
    }
  };
  fill(current, 'current', startCur);
  fill(previous, 'previous', startPrev);
  // Money series read badly at 6 decimal places; counts are already integers.
  if (sumOf) {
    for (const row of out) {
      row.current = Math.round(row.current * 100) / 100;
      row.previous = Math.round(row.previous * 100) / 100;
    }
  }
  return out;
}

// ── 4.1 Most rented equipment ───────────────────────────────────────────

export async function getMostRentedEquipment(params = {}) {
  const { days, fromIso, toIso, fromDate, toDate, allTime } = resolveWindow(params, 30);
  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 30);

  // Pull dispatches in window with their equipment → type join. Aggregation
  // is done client-side because Supabase can't GROUP BY across a nested
  // relation in the JS client without an RPC.
  //
  // The unit-level fields (serial, capacity, location) are what let the
  // per-unit ranking below carry a human label instead of a bare id.
  const dispatches = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, status, destination, equipment_id, equipment_units(equipment_id, serial_number, capacity, location, type_id, equipment_types(type_id, name, category))')
      .gte('dispatch_date', fromIso)
      .lte('dispatch_date', toIso),
    'mostRented.dispatches'
  );

  // Same-length baseline window, for the "is this line growing?" question.
  // Only the type link is needed here, so it is the cheaper of the two.
  const prevDispatches = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, equipment_id, equipment_units(type_id, equipment_types(type_id, name))')
      .gte('dispatch_date', prevFromIso)
      .lt('dispatch_date', prevToIso),
    'mostRented.prevDispatches'
  );

  // A dispatch header carries at most ONE equipment_id, but a multi-item
  // dispatch records its equipment in `dispatch_items` and leaves the header
  // link null. Reading only the header therefore reported "Insufficient data"
  // on a system that plainly had rentals — the rentals were simply all in the
  // line-item table. Both are read and merged, keyed on dispatch+equipment so
  // a dispatch represented in both is never counted twice.
  const dispatchIds = dispatches.map(d => d?.dispatch_id).filter(Boolean);
  const items = dispatchIds.length
    ? await safeQuery(
      supabase
        .from('dispatch_items')
        .select('item_id, dispatch_id, equipment_id, equipment_units(equipment_id, serial_number, capacity, location, type_id, equipment_types(type_id, name, category))')
        .in('dispatch_id', dispatchIds),
      'mostRented.items'
    )
    : [];

  // Rental "events", normalised across the two dispatch shapes and the
  // quotation fallback below, so the aggregation runs once over one list.
  const eventKey = (dispatchId, equipmentId) => `${dispatchId ?? '-'}::${equipmentId ?? '-'}`;
  const seenEvents = new Set();
  const events = [];
  const addEvent = (ev) => {
    const k = eventKey(ev.dispatch_id, ev.equipment_id);
    if (seenEvents.has(k)) return;
    seenEvents.add(k);
    events.push(ev);
  };
  const dispatchById = new Map(dispatches.filter(Boolean).map(d => [d.dispatch_id, d]));
  for (const it of items) {
    if (!it) continue;
    const parent = dispatchById.get(it.dispatch_id);
    addEvent({
      dispatch_id: it.dispatch_id,
      equipment_id: it.equipment_id,
      equipment_units: it.equipment_units,
      dispatch_date: parent?.dispatch_date ?? null,
      destination: parent?.destination ?? null,
    });
  }
  // Only dispatches with NO line items contribute their header. A dispatch
  // that has items is already fully represented by them, and its header
  // carries either the same equipment (a duplicate) or none at all (an
  // equipment-less phantom rental that inflates every count).
  const itemised = new Set(items.map(it => it?.dispatch_id).filter(v => v != null));
  for (const d of dispatches) {
    if (itemised.has(d?.dispatch_id)) continue;
    if (!d?.equipment_id) continue;
    addEvent({
      dispatch_id: d.dispatch_id,
      equipment_id: d.equipment_id,
      equipment_units: d.equipment_units,
      dispatch_date: d.dispatch_date,
      destination: d.destination,
    });
  }

  // Fallback: no dispatch activity in this window at all. Rentals are also
  // recorded as quotation lines (the contract side of the same transaction),
  // so read those rather than declaring "insufficient data" over a table that
  // simply is not where this deployment keeps its rental history yet.
  let source = 'dispatches';
  if (events.length === 0) {
    const quotes = await safeQuery(
      supabase
        .from('quotations')
        .select('quotation_id, created_at, status')
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      'mostRented.quotations'
    );
    const quoteIds = quotes.map(q => q?.quotation_id).filter(Boolean);
    if (quoteIds.length) {
      const qItems = await safeQueryAll(
        () => supabase
          .from('quotation_items')
          .select('quotation_id, equipment_id, quantity, equipment_units(equipment_id, serial_number, capacity, location, type_id, equipment_types(type_id, name, category))')
          .in('quotation_id', quoteIds),
        PK_COLUMN.quotation_items,
        'mostRented.quotationItems'
      );
      const quoteById = new Map(quotes.filter(Boolean).map(q => [q.quotation_id, q]));
      for (const qi of qItems) {
        if (!qi) continue;
        addEvent({
          dispatch_id: `Q${qi.quotation_id}`,
          equipment_id: qi.equipment_id,
          equipment_units: qi.equipment_units,
          dispatch_date: quoteById.get(qi.quotation_id)?.created_at ?? null,
          destination: null,
        });
      }
      if (events.length) source = 'quotations';
    }
  }

  // Keyed EXACTLY as the current window is (id when present, else name), or a
  // name-keyed line would never find its own baseline and would always read as
  // "new this period".
  const typeKeyOf = (t) => {
    const n = typeName(t);
    return t?.type_id ?? (n && n !== 'Unknown' ? `name:${n}` : null);
  };
  const countByType = (rows) => {
    const m = new Map();
    for (const d of rows) {
      const key = typeKeyOf(d?.equipment_units?.equipment_types);
      if (key === null) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };
  const prevByType = countByType(prevDispatches);

  const byTypeMap = new Map();
  const perUnit = new Map();
  const perDestination = new Map();
  for (const d of events) {
    const u = d?.equipment_units;
    const t = u?.equipment_types;
    // Group by TYPE, keyed on the id when there is one and on the NAME when
    // there is not. Gating the whole grouping on `type_id` meant a rental
    // whose type resolved to a name but no id was dropped from the ranking
    // entirely — the section then reported a positive rental count beside an
    // empty chart, which reads as a broken panel rather than as missing data.
    const tname = typeName(t);
    const key = t?.type_id ?? (tname && tname !== 'Unknown' ? `name:${tname}` : null);
    if (key !== null) {
      if (!byTypeMap.has(key)) {
        byTypeMap.set(key, {
          // Null rather than a synthesised id: the drill-down prints this and
          // "name:Forklift" is not an identifier anyone can look up.
          type_id: t?.type_id ?? null,
          name: tname,
          category: t?.category ?? null,
          rentals: 0,
          units: new Set(),
          lastDispatchAt: null,
          total_days: 0,
        });
      }
      const row = byTypeMap.get(key);
      row.rentals += 1;
      if (d.equipment_id) row.units.add(d.equipment_id);
      if (d.dispatch_date && (!row.lastDispatchAt || d.dispatch_date > row.lastDispatchAt)) {
        row.lastDispatchAt = d.dispatch_date;
      }
      // Accumulate rental days from dispatch date/return_date when available
      const rentalDays = (d.dispatch_date && d.return_date)
        ? Math.max(1, Math.round(daysBetween(d.dispatch_date, d.return_date) ?? 1))
        : 1;
      row.total_days += rentalDays;
    }
    if (d.equipment_id) {
      if (!perUnit.has(d.equipment_id)) {
        perUnit.set(d.equipment_id, {
          equipment_id: d.equipment_id,
          // Name first; the id rides along for the tooltip only.
          label: unitLabel({
            equipment_id: d.equipment_id,
            type_name: t?.name,
            capacity: u?.capacity,
            serial_number: u?.serial_number ?? null,
          }),
          type_name: t?.name ?? 'Unknown',
          category: t?.category ?? null,
          serial_number: u?.serial_number ?? null,
          location: u?.location ?? null,
          rentals: 0,
          lastDispatchAt: null,
        });
      }
      const row = perUnit.get(d.equipment_id);
      row.rentals += 1;
      if (d.dispatch_date && (!row.lastDispatchAt || d.dispatch_date > row.lastDispatchAt)) {
        row.lastDispatchAt = d.dispatch_date;
      }
    }
    const dest = clean(d.destination);
    if (dest) perDestination.set(dest, (perDestination.get(dest) ?? 0) + 1);
  }

  // Counted from the merged events, not from `dispatches.length`. A
  // multi-item dispatch is several rentals, and under the quotation fallback
  // there are no dispatch rows to count at all — the old expression reported
  // zero in both cases and drove the section's empty state.
  const totalRentals = events.length;
  const byType = [...byTypeMap.entries()]
    .map(([key, r]) => ({
      type_id: r.type_id,
      name: r.name,
      category: r.category,
      rentals: r.rentals,
      unitsUsed: r.units.size,
      lastDispatchAt: r.lastDispatchAt,
      total_days: r.total_days,
      sharePct: totalRentals ? Math.round(r.rentals * 100 / totalRentals) : 0,
      prevRentals: prevByType.get(key) ?? 0,
      // null, not 0, when the line had no prior activity — "new this period"
      // is a different statement from "unchanged".
      trendPct: deltaPct(r.rentals, prevByType.get(key) ?? 0),
    }))
    .sort((a, b) => b.total_days - a.total_days);

  const byUnit = [...perUnit.values()].sort((a, b) => b.rentals - a.rentals);
  const top = byType[0];
  // Concentration: how much of the period's volume the three biggest lines
  // carry. A single leading line already earns a warning from the template;
  // this is the portfolio-level version of the same question, and it is the
  // number that answers "how exposed are we if one line goes quiet".
  const top3 = byType.slice(0, 3);
  const top3Rentals = top3.reduce((sum, r) => sum + (Number(r.rentals) || 0), 0);

  return {
    kpis: {
      totalRentals,
      topName: top?.name ?? null,
      topRentals: top?.rentals ?? 0,
      topSharePct: totalRentals ? Math.round((top?.rentals ?? 0) * 100 / totalRentals) : 0,
      topTrendPct: top?.trendPct ?? null,
      distinctTypes: byType.length,
      distinctUnits: byUnit.length,
      top3SharePct: totalRentals ? Math.round(top3Rentals * 100 / totalRentals) : 0,
      top3Names: top3.map(r => r.name),
      top3Count: top3.length,
      avgPerUnit: byUnit.length ? Math.round((totalRentals / byUnit.length) * 10) / 10 : 0,
      busiestUnitLabel: byUnit[0]?.label ?? null,
      busiestUnitId: byUnit[0]?.equipment_id ?? null,
      busiestUnitRentals: byUnit[0]?.rentals ?? 0,
      prevTotalRentals: prevDispatches.length,
      rentalsDeltaPct: deltaPct(totalRentals, prevDispatches.length),
      dailyAvg: days > 0 ? Math.round((totalRentals / days) * 100) / 100 : 0,
    },
    series: {
      compare: comparativeSeries(events, prevDispatches, {
        days, dateOf: r => r.dispatch_date,
      }),
    },
    breakdowns: {
      byType: byType.slice(0, 10),
      byUnit: byUnit.slice(0, 10),
      byDestination: [...perDestination.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    },
    meta: {
      windowDays: days,
      // The concrete edges, so the card can state the period it actually
      // queried instead of describing every window as "rolling".
      fromDate,
      toDate,
      allTime,
      source,
      // Where the newest rental on record actually sits, so an empty window
      // can say "your data stops in March" instead of "insufficient data" —
      // the difference between a dead end and a next step. Only probed when
      // there is nothing to show, so the normal path costs no extra query.
      emptyReason: totalRentals === 0 ? await describeRentalGap(fromIso, toIso) : null,
      comparedTo: prevDispatches.length > 0 ? `previous ${days} days` : null,
      confidence: confidenceFrom({
        sampleSize: events.length,
        // A rental with no equipment→type link cannot be ranked, so it is
        // exactly the gap the confidence line should disclose.
        fieldCoverage: coverage(events, d => !!d.equipment_units?.equipment_types?.type_id),
        windowDays: days,
      }),
    },
  };
}

// Explains an empty rental window in terms of what the database DOES hold.
// Never throws and never blocks the section: any failure degrades to a plain
// "nothing in this period" rather than taking the card down.
async function describeRentalGap(fromIso, toIso) {
  const span = `${String(fromIso).slice(0, 10)} to ${String(toIso).slice(0, 10)}`;
  try {
    const latest = await safeQuery(
      supabase
        .from('dispatches')
        .select('dispatch_date')
        .not('dispatch_date', 'is', null)
        .order('dispatch_date', { ascending: false })
        .limit(1),
      'mostRented.latestProbe'
    );
    const newest = latest[0]?.dispatch_date;
    if (!newest) {
      return `No rentals have been recorded yet. Once dispatches or quotations exist they will appear here for whichever period you select.`;
    }
    return `No rentals between ${span}. The most recent rental on record is ${String(newest).slice(0, 10)} — widen the date range or pick a period that covers it.`;
  } catch {
    return `No rentals between ${span}.`;
  }
}

// Explains an empty dispatch window in terms of what the table DOES hold, so
// the card can point somewhere instead of just declining. Never throws.
async function describeDispatchGap(fromIso, toIso) {
  const span = `${String(fromIso).slice(0, 10)} to ${String(toIso).slice(0, 10)}`;
  try {
    const latest = await safeQuery(
      supabase
        .from('dispatches')
        .select('dispatch_date, created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      'dispatchTrends.latestProbe'
    );
    const row = latest[0];
    const newest = row?.dispatch_date ?? row?.created_at;
    if (!newest) {
      return 'No dispatches have been recorded yet. Once any exist they will appear here for whichever period you select.';
    }
    return `No dispatches between ${span}. The most recent one on record is ${String(newest).slice(0, 10)} — widen the date range or pick a period that covers it.`;
  } catch {
    return `No dispatches between ${span}.`;
  }
}

// ── 4.2 Most procured equipment ─────────────────────────────────────────

export async function getMostProcuredEquipment(params = {}) {
  const { days, fromIso, toIso } = resolveWindow(params, 90);

  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 90);

  // The vendor join is what supplies the supplier count per equipment line.
  // It is a left join, so a procurement with no vendor still returns.
  const procs = await safeQuery(
    supabase
      .from('procurements')
      .select('procurement_id, type, status, total_amount_kwd, created_at, vendor_id, vendors(vendor_id, name)')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    'mostProcured.procurements'
  );

  // Same-length window immediately before, for the period-over-period trend.
  // Only the fields the comparison needs — this is the cheaper of the two.
  const prevProcs = await safeQuery(
    supabase
      .from('procurements')
      .select('procurement_id, status, total_amount_kwd, created_at')
      .gte('created_at', prevFromIso)
      .lt('created_at', prevToIso),
    'mostProcured.prevProcurements'
  );

  // Line items — optional. Some environments may not have procurement_items
  // populated with equipment_type_id, so we degrade to Buy/Lease-only.
  //
  // `select('*')` rather than a column list on purpose: quantity lives in
  // `received_qty` here but other deployments of this schema have carried a
  // plain `quantity`, and naming a column Postgres does not have turns the
  // whole query into an error — which safeQuery would swallow as "no line
  // items", silently collapsing the equipment ranking to nothing. Reading
  // fields defensively off `*` degrades per-field instead of per-query.
  const procIds = procs.map(p => p.procurement_id);
  let items = [];
  if (procIds.length > 0) {
    items = await safeQuery(
      supabase
        .from('procurement_items')
        .select('*, equipment_types(type_id, name, category)')
        .in('procurement_id', procIds),
      'mostProcured.items'
    );
  }

  const prevItems = prevProcs.length > 0
    ? await safeQuery(
      supabase
        .from('procurement_items')
        .select('*, equipment_types(type_id, name)')
        .in('procurement_id', prevProcs.map(p => p.procurement_id)),
      'mostProcured.prevItems'
    )
    : [];

  const byType = {};
  for (const p of procs) {
    const t = p.type ?? 'Unspecified';
    if (!byType[t]) byType[t] = { type: t, count: 0, spend: 0 };
    byType[t].count += 1;
    if (!['Cancelled', 'Rejected'].includes(p.status)) {
      byType[t].spend += Number(p.total_amount_kwd ?? 0);
    }
  }

  const byCategory = new Map();
  for (const it of items) {
    const cat = it.equipment_types?.category ?? 'Uncategorised';
    const name = it.equipment_types?.name ?? cat;
    const key = `${cat}|${name}`;
    if (!byCategory.has(key)) {
      byCategory.set(key, { category: cat, name, count: 0, spend: 0 });
    }
    const b = byCategory.get(key);
    b.count += 1;
    b.spend += Number(it.unit_price_kwd ?? 0);
  }

  // ── Equipment-first ranking ───────────────────────────────────────────
  // "What are we procuring the most?" is a question about equipment, so the
  // primary result is a named equipment row — not a Buy/Lease count. Keyed
  // on equipment_type_id where present, falling back to the item's own
  // description so a line typed in free-text still ranks instead of
  // vanishing into "Uncategorised".
  const vendorOf = new Map(
    procs.map(p => [p.procurement_id, p.vendors?.name || null])
  );
  const cancelled = new Set(
    procs.filter(p => ['Cancelled', 'Rejected'].includes(p.status))
      .map(p => p.procurement_id)
  );

  // A cancelled or rejected procurement was not procured, so its lines are
  // excluded from the ranking outright rather than counted for quantity and
  // skipped for spend — that split is what made avgUnitCost (spend / quantity)
  // report a price nobody ever paid.
  function foldItems(rows, vendorLookup, skip) {
    const map = new Map();
    for (const it of rows) {
      if (skip?.has(it.procurement_id)) continue;
      const t = it.equipment_types;
      const key = it.equipment_type_id
        || (t?.type_id ?? null)
        || `desc:${(it.description ?? '').trim().toLowerCase()}`
        || 'unknown';
      const name = t ? typeName(t) : (String(it.description ?? '').trim() || 'Unspecified equipment');
      if (!map.has(key)) {
        map.set(key, {
          key: String(key),
          name,
          // Kept separate from `name` and only ever shown on hover.
          type_id: it.equipment_type_id ?? t?.type_id ?? null,
          category: t?.category ?? null,
          quantity: 0,
          orders: 0,
          spend: 0,
          suppliers: new Set(),
          lastOrderedAt: null,
        });
      }
      const row = map.get(key);
      const qty = itemQty(it);
      row.quantity += qty;
      row.orders += 1;
      row.spend += num(it.unit_price_kwd) * qty;
      const vendor = vendorLookup?.get(it.procurement_id);
      if (vendor) row.suppliers.add(vendor);
      const when = it.received_date || it.created_at || null;
      if (when && (!row.lastOrderedAt || when > row.lastOrderedAt)) {
        row.lastOrderedAt = when;
      }
    }
    return map;
  }

  const prevCancelled = new Set(
    prevProcs.filter(p => ['Cancelled', 'Rejected'].includes(p.status))
      .map(p => p.procurement_id)
  );
  const currentMap = foldItems(items, vendorOf, cancelled);
  const prevMap = foldItems(prevItems, null, prevCancelled);

  const byEquipment = [...currentMap.values()]
    .map(r => {
      const prev = prevMap.get(r.key);
      return {
        key: r.key,
        name: r.name,
        type_id: r.type_id,
        category: r.category,
        quantity: r.quantity,
        orders: r.orders,
        spend: r.spend,
        avgUnitCost: r.quantity ? r.spend / r.quantity : 0,
        supplierCount: r.suppliers.size,
        suppliers: [...r.suppliers].sort(),
        lastOrderedAt: r.lastOrderedAt,
        prevQuantity: prev?.quantity ?? 0,
        // null (not 0) when there is no baseline — "no comparable activity
        // last period" is a different statement from "unchanged", and the
        // brief phrases them differently.
        trendPct: deltaPct(r.quantity, prev?.quantity ?? 0),
      };
    })
    // Ranked by spend, because spend is what a procurement conversation is
    // actually about; quantity is carried alongside and is one click away in
    // the UI's sort toggle.
    .sort((a, b) => b.spend - a.spend || b.quantity - a.quantity);

  const equipmentSpend = byEquipment.reduce((s, r) => s + r.spend, 0);
  const equipmentQty = byEquipment.reduce((s, r) => s + r.quantity, 0);
  const topEquipment = byEquipment[0] ?? null;

  // Supplier view of the same spend — answers "which supplier contributed the
  // most?" from data already fetched, rather than making that a question the
  // assistant has to decline.
  const supplierMap = new Map();
  for (const p of procs) {
    const name = p.vendors?.name || null;
    if (!name) continue;
    if (!supplierMap.has(name)) {
      supplierMap.set(name, {
        name, vendor_id: p.vendor_id ?? p.vendors?.vendor_id ?? null,
        orders: 0, spend: 0, equipment: new Set(),
      });
    }
    const s = supplierMap.get(name);
    s.orders += 1;
    if (!['Cancelled', 'Rejected'].includes(p.status)) {
      s.spend += num(p.total_amount_kwd);
    }
  }
  for (const it of items) {
    const name = vendorOf.get(it.procurement_id);
    if (!name || !supplierMap.has(name)) continue;
    const t = it.equipment_types;
    supplierMap.get(name).equipment.add(
      t ? typeName(t) : (String(it.description ?? '').trim() || 'Unspecified equipment')
    );
  }
  const bySupplier = [...supplierMap.values()]
    .map(s => ({
      name: s.name,
      vendor_id: s.vendor_id,
      orders: s.orders,
      spend: s.spend,
      equipmentCount: s.equipment.size,
      equipment: [...s.equipment].sort(),
    }))
    .sort((a, b) => b.spend - a.spend);
  const supplierSpend = bySupplier.reduce((s, r) => s + r.spend, 0);

  // Monthly buy vs lease
  const byMonth = {};
  for (const p of procs) {
    const m = (p.created_at ?? '').slice(0, 7); // YYYY-MM
    if (!m) continue;
    if (!byMonth[m]) byMonth[m] = { month: m, Buy: 0, Lease: 0, Other: 0, spend: 0 };
    const bucket = ['Buy', 'Lease'].includes(p.type) ? p.type : 'Other';
    byMonth[m][bucket] += 1;
    // `total_amount_kwd` was already selected for every row (the KPI totals
    // above read it) — accumulating it per month too is the same "surface
    // what's already fetched" fix the chart's zoom needed, not a new query.
    // Voided procurements are excluded, matching every other spend figure
    // this fetcher reports.
    if (!['Cancelled', 'Rejected'].includes(p.status)) {
      byMonth[m].spend += num(p.total_amount_kwd);
    }
  }

  const totalCount = procs.length;
  const totalSpend = Object.values(byType).reduce((s, x) => s + x.spend, 0);
  const avgDealSize = totalCount ? totalSpend / totalCount : 0;
  const buyCount = byType.Buy?.count ?? 0;
  const leaseCount = byType.Lease?.count ?? 0;

  // Period-over-period on the whole book, independent of the per-equipment
  // trends above, so the brief can open with "spending is up 18%" even when
  // line items are missing entirely.
  const prevSpend = prevProcs
    .filter(p => !['Cancelled', 'Rejected'].includes(p.status))
    .reduce((s, p) => s + num(p.total_amount_kwd), 0);

  return {
    kpis: {
      totalCount,
      totalSpend,
      avgDealSize,
      buyCount,
      leaseCount,
      buySharePct: totalCount ? Math.round(buyCount * 100 / totalCount) : 0,
      // Equipment-first headline figures.
      topEquipmentName: topEquipment?.name ?? null,
      topEquipmentQty: topEquipment?.quantity ?? 0,
      topEquipmentSpend: topEquipment?.spend ?? 0,
      topEquipmentSharePct: equipmentSpend
        ? Math.round((topEquipment?.spend ?? 0) * 100 / equipmentSpend)
        : 0,
      topEquipmentSuppliers: topEquipment?.supplierCount ?? 0,
      topSupplierName: bySupplier[0]?.name ?? null,
      topSupplierSpend: bySupplier[0]?.spend ?? 0,
      topSupplierSharePct: supplierSpend
        ? Math.round((bySupplier[0]?.spend ?? 0) * 100 / supplierSpend)
        : 0,
      distinctSuppliers: bySupplier.length,
      distinctEquipment: byEquipment.length,
      equipmentQty,
      equipmentSpend,
      prevSpend,
      spendDeltaPct: deltaPct(totalSpend, prevSpend),
      countDeltaPct: deltaPct(totalCount, prevProcs.length),
    },
    series: {
      byMonth: Object.values(byMonth)
        .map(r => ({ ...r, spend: Math.round(r.spend * 100) / 100 }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    },
    breakdowns: {
      byType: Object.values(byType).sort((a, b) => b.spend - a.spend),
      byCategory: [...byCategory.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      byEquipment: byEquipment.slice(0, 12),
      bySupplier: bySupplier.slice(0, 8),
    },
    meta: {
      windowDays: days,
      hasLineItems: items.length > 0,
      comparedTo: prevProcs.length > 0 ? `previous ${days} days` : null,
      // Confidence is derived, not asserted: how many line items the ranking
      // rests on, and how many of them actually carry the price and the type
      // link the ranking reads.
      confidence: confidenceFrom({
        sampleSize: items.length,
        fieldCoverage: coverage(items, it =>
          (it.equipment_type_id || it.equipment_types) && num(it.unit_price_kwd) > 0),
        windowDays: days,
      }),
    },
  };
}

// ── 4.3 Recent leased / contracted equipment ────────────────────────────

export async function getRecentLeases(params = {}) {
  const { days, fromDate, toDate } = resolveWindow(params, 30);
  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 30);

  // `capacity` is what `unitLabel` prefers as the discriminator between two
  // units of the same type, so it is selected here for the same reason the
  // maintenance query selects it: the label is built in this layer, once.
  const unitSelect = 'equipment_id, serial_number, capacity, location, lease_start_date, lease_end_date, lease_monthly_kwd, lease_returned_at, equipment_types(type_id, name, category)';

  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select(unitSelect)
      .gte('lease_start_date', fromDate)
      .lte('lease_start_date', toDate)
      .is('lease_returned_at', null)
      .order('lease_start_date', { ascending: false }),
    'recentLeases.new'
  );

  // Same-length baseline, so "the pipeline is drying up" is measured rather
  // than asserted.
  const prevUnits = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, lease_start_date, lease_monthly_kwd')
      .gte('lease_start_date', prevFromIso.slice(0, 10))
      .lt('lease_start_date', prevToIso.slice(0, 10)),
    'recentLeases.prev'
  );

  // Everything currently leased (not returned) — used for expiry bucketing.
  const active = await safeQuery(
    supabase
      .from('equipment_units')
      .select(unitSelect)
      .not('lease_start_date', 'is', null)
      .is('lease_returned_at', null),
    'recentLeases.active'
  );

  // One decoration pass so every consumer — chart, table, brief, tooltip —
  // reads the same label string and the same derived numbers.
  const decorate = (u) => {
    const toExpiry = u.lease_end_date ? daysBetween(new Date(), u.lease_end_date) : null;
    const term = daysBetween(u.lease_start_date, u.lease_end_date);
    return {
      ...u,
      label: unitLabel({
        equipment_id: u.equipment_id,
        type_name: u.equipment_types?.name,
        capacity: u.capacity,
        serial_number: u.serial_number ?? null,
      }),
      type_name: u.equipment_types?.name ?? 'Unknown',
      category: u.equipment_types?.category ?? null,
      monthly: num(u.lease_monthly_kwd),
      termDays: term == null ? null : Math.round(term),
      daysToExpiry: toExpiry == null ? null : Math.round(toExpiry),
    };
  };

  const newRows = units.map(decorate);
  const activeRows = active.map(decorate);

  const bucket = { d30: 0, d60: 0, d90: 0, later: 0, unknown: 0 };
  const monthlyByBucket = { d30: 0, d60: 0, d90: 0, later: 0, unknown: 0 };
  const expiring30 = [];
  const expired = [];
  for (const u of activeRows) {
    const diff = u.daysToExpiry;
    let key;
    if (diff == null) key = 'unknown';
    else if (diff < 0) { key = 'd30'; expired.push(u); }
    else if (diff <= 30) key = 'd30';
    else if (diff <= 60) key = 'd60';
    else if (diff <= 90) key = 'd90';
    else key = 'later';
    bucket[key] += 1;
    monthlyByBucket[key] += u.monthly;
    if (key === 'd30') expiring30.push(u);
  }
  expiring30.sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));

  // Monthly commitment by equipment type — "which lines is the lease book
  // actually made of" is the contextual question behind the headline number.
  const byTypeMap = new Map();
  for (const u of activeRows) {
    const name = u.type_name;
    if (!byTypeMap.has(name)) byTypeMap.set(name, { name, units: 0, monthly: 0 });
    const row = byTypeMap.get(name);
    row.units += 1;
    row.monthly += u.monthly;
  }

  const newLeases = newRows.length;
  const monthlyCommit = newRows.reduce((s, u) => s + u.monthly, 0);
  const terms = newRows.map(u => u.termDays).filter(t => Number.isFinite(t));
  const avgTerm = terms.length ? terms.reduce((s, t) => s + t, 0) / terms.length : 0;
  const activeMonthly = activeRows.reduce((s, u) => s + u.monthly, 0);
  const prevMonthly = prevUnits.reduce((s, u) => s + num(u.lease_monthly_kwd), 0);

  return {
    kpis: {
      newLeases,
      monthlyCommit,
      avgTermDays: Math.round(avgTerm),
      expiring30: bucket.d30,
      expiring60: bucket.d60,
      expiring90: bucket.d90,
      // Everything below is additive; nothing above changed shape.
      activeLeases: activeRows.length,
      activeMonthlyCommit: activeMonthly,
      monthlyAtRisk30: monthlyByBucket.d30,
      atRiskSharePct: activeMonthly ? Math.round(monthlyByBucket.d30 * 100 / activeMonthly) : 0,
      expiredCount: expired.length,
      prevNewLeases: prevUnits.length,
      newLeasesDeltaPct: deltaPct(newLeases, prevUnits.length),
      commitDeltaPct: deltaPct(monthlyCommit, prevMonthly),
      topLeaseTypeName: [...byTypeMap.values()].sort((a, b) => b.monthly - a.monthly)[0]?.name ?? null,
      soonestExpiryLabel: expiring30[0]?.label ?? null,
      soonestExpiryDays: expiring30[0]?.daysToExpiry ?? null,
    },
    series: {
      // A bar per expiry horizon: the renewal runway, at a glance.
      expiryBuckets: [
        { bucket: '≤30d',  units: bucket.d30,     monthly: Math.round(monthlyByBucket.d30) },
        { bucket: '31–60d', units: bucket.d60,    monthly: Math.round(monthlyByBucket.d60) },
        { bucket: '61–90d', units: bucket.d90,    monthly: Math.round(monthlyByBucket.d90) },
        { bucket: '90d+',   units: bucket.later,  monthly: Math.round(monthlyByBucket.later) },
        { bucket: 'No end date', units: bucket.unknown, monthly: Math.round(monthlyByBucket.unknown) },
      ].filter(r => r.units > 0),
    },
    breakdowns: {
      newUnits: newRows.slice(0, 20),
      expiringSoon: expiring30.slice(0, 10),
      byType: [...byTypeMap.values()].sort((a, b) => b.monthly - a.monthly).slice(0, 8),
    },
    meta: {
      windowDays: days,
      comparedTo: prevUnits.length > 0 ? `previous ${days} days` : null,
      confidence: confidenceFrom({
        sampleSize: activeRows.length,
        // A lease row with no end date or no rate cannot be bucketed or
        // valued, which is what makes the renewal picture partial.
        fieldCoverage: coverage(activeRows, u => !!u.lease_end_date && u.monthly > 0),
        windowDays: days,
      }),
    },
  };
}

// ── 4.4 Highest maintenance frequency ───────────────────────────────────

export async function getMaintenanceFrequency(params = {}) {
  const { days, fromDate, toDate } = resolveWindow(params, 180);

  // `start_date` / `completion_date` are what downtime is measured from, and
  // `serial_number` / `location` are hover detail — all additive to the
  // previous select, so an environment missing none of them behaves as before.
  const jobs = await safeQuery(
    supabase
      .from('maintenance')
      .select('maintenance_id, equipment_id, status, issue_type, cost_kwd, service_date, start_date, completion_date, equipment_units(equipment_id, serial_number, capacity, location, equipment_types(type_id, name, category))')
      .gte('service_date', fromDate)
      .lte('service_date', toDate),
    'maintFreq.jobs'
  );

  const revenueItems = await safeQueryAll(
    () => supabase
      .from('quotation_items')
      .select('equipment_id, quantity, unit_rate_kwd, rental_start_date, rental_end_date')
      .not('equipment_id', 'is', null)
      .gte('rental_start_date', fromDate)
      .lte('rental_start_date', toDate),
    PK_COLUMN.quotation_items,
    'maintFreq.revenue'
  );
  const revenueByUnit = new Map();
  for (const qi of revenueItems) {
    if (!qi?.equipment_id) continue;
    const rev = Number(qi.quantity ?? 0) * Number(qi.unit_rate_kwd ?? 0);
    revenueByUnit.set(qi.equipment_id, (revenueByUnit.get(qi.equipment_id) ?? 0) + rev);
  }

  const perUnit = new Map();
  const perType = new Map();
  const perIssueType = new Map();
  let openCount = 0;
  let completedLastMonthCount = 0;
  const oneMonthAgo = Date.now() - 30 * 86_400_000;

  for (const j of jobs) {
    const uid = j.equipment_id;
    if (uid) {
      if (!perUnit.has(uid)) {
        const u = j.equipment_units;
        perUnit.set(uid, {
          equipment_id: uid,
          // The label is the primary identifier everywhere downstream; the
          // raw id above is carried only so the tooltip can show it.
          label: unitLabel({
            equipment_id: uid,
            type_name: u?.equipment_types?.name,
            capacity: u?.capacity,
            serial_number: u?.serial_number ?? null,
          }),
          type_name: u?.equipment_types?.name ?? 'Unknown',
          category: u?.equipment_types?.category ?? null,
          capacity: u?.capacity ?? null,
          serial_number: u?.serial_number ?? null,
          location: u?.location ?? null,
          jobs: 0,
          total_cost: 0,
          downtime_days: 0,
          open_jobs: 0,
          service_dates: [],
          last_service: null,
        });
      }
      const u = perUnit.get(uid);
      u.jobs += 1;
      u.total_cost += Number(j.cost_kwd ?? 0);

      // Downtime: measured start → completion. An open job is still down, so
      // it accrues to today rather than counting as zero — otherwise the unit
      // currently stuck in the workshop looks like the healthiest in the fleet.
      const openEnded = ['Open', 'In Progress'].includes(j.status);
      const from = j.start_date || j.service_date;
      const to = j.completion_date || (openEnded ? new Date().toISOString() : null);
      const span = daysBetween(from, to);
      if (Number.isFinite(span) && span > 0) u.downtime_days += span;
      if (openEnded) u.open_jobs += 1;

      if (j.service_date) {
        u.service_dates.push(j.service_date);
        if (!u.last_service || j.service_date > u.last_service) {
          u.last_service = j.service_date;
        }
      }
    }
    const tname = j.equipment_units?.equipment_types?.name;
    if (tname) {
      if (!perType.has(tname)) perType.set(tname, { name: tname, jobs: 0, cost: 0 });
      const t = perType.get(tname);
      t.jobs += 1;
      t.cost += Number(j.cost_kwd ?? 0);
    }
    const it = j.issue_type ?? 'Other';
    perIssueType.set(it, (perIssueType.get(it) ?? 0) + 1);

    if (['Open', 'In Progress'].includes(j.status)) openCount += 1;
    if (j.status === 'Completed' && j.service_date && new Date(j.service_date).getTime() >= oneMonthAgo) {
      completedLastMonthCount += 1;
    }
  }

  // ── Effort ranking ────────────────────────────────────────────────────
  // "Most maintenance effort" is not the same question as "most maintenance
  // records": a unit with two week-long engine rebuilds is consuming far more
  // of the workshop than one with five filter changes. Effort is therefore a
  // blend of the three things that actually cost the business — visit count,
  // days out of service, and money spent.
  //
  // Each component is scaled against the worst unit in the window, so the
  // score is a 0-100 share of "the heaviest burden currently in the fleet"
  // and is directly comparable between rows on the same chart. It is NOT
  // comparable across different windows, which is why it is never quoted as
  // a bare number in a sentence — only used to order the ranking.
  const units = [...perUnit.values()].map(u => {
    const sorted = [...u.service_dates].sort();
    let intervalDays = null;
    if (sorted.length >= 2) {
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const g = daysBetween(sorted[i - 1], sorted[i]);
        if (Number.isFinite(g) && g >= 0) gaps.push(g);
      }
      if (gaps.length) intervalDays = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    }
    const daysSinceLast = u.last_service
      ? daysBetween(u.last_service, new Date().toISOString())
      : null;
    return {
      ...u,
      service_dates: undefined,   // internal only; not part of the payload
      downtime_days: Math.round(u.downtime_days * 10) / 10,
      avg_cost: u.jobs ? u.total_cost / u.jobs : 0,
      avg_interval_days: intervalDays === null ? null : Math.round(intervalDays),
      days_since_last: daysSinceLast === null ? null : Math.round(daysSinceLast),
    };
  });

  const maxJobs = Math.max(1, ...units.map(u => u.jobs));
  const maxDown = Math.max(1, ...units.map(u => u.downtime_days));
  const maxCost = Math.max(1, ...units.map(u => u.total_cost));
  const EFFORT_WEIGHTS = { jobs: 0.4, downtime: 0.35, cost: 0.25 };
  for (const u of units) {
    u.effort = Math.round(
      (EFFORT_WEIGHTS.jobs * (u.jobs / maxJobs)
        + EFFORT_WEIGHTS.downtime * (u.downtime_days / maxDown)
        + EFFORT_WEIGHTS.cost * (u.total_cost / maxCost)) * 100
    );
  }

  // Add revenue and maintenance cost % to each unit before slicing
  for (const u of units) {
    u.revenue_kwd = revenueByUnit.get(u.equipment_id) ?? 0;
    u.maint_cost_pct = (() => {
      const rev = revenueByUnit.get(u.equipment_id) ?? 0;
      if (rev <= 0) return null;
      return Math.round(u.total_cost * 100 / rev);
    })();
  }

  const topUnits = units
    .sort((a, b) => b.effort - a.effort || b.jobs - a.jobs)
    .slice(0, 15);
  const typeStats = [...perType.values()]
    .map(t => ({ ...t, avg_cost: t.jobs ? t.cost / t.jobs : 0 }))
    .sort((a, b) => b.jobs - a.jobs);
  const fleetMedianCost = typeStats.length ? median(typeStats.map(t => t.avg_cost).filter(Number.isFinite)) : 0;

  const top = topUnits[0] ?? null;
  const fleetAvgJobs = units.length
    ? units.reduce((s, u) => s + u.jobs, 0) / units.length
    : 0;
  const totalDowntime = units.reduce((s, u) => s + u.downtime_days, 0);

  return {
    kpis: {
      totalJobs: jobs.length,
      // Name first. topUnitId is retained because existing callers read it,
      // but nothing user-facing should render it outside a tooltip.
      topUnitLabel: top?.label ?? null,
      topUnitId: top?.equipment_id ?? null,
      topUnitJobs: top?.jobs ?? 0,
      topUnitDowntime: top?.downtime_days ?? 0,
      topUnitCost: top?.total_cost ?? 0,
      topUnitEffort: top?.effort ?? 0,
      topUnitIntervalDays: top?.avg_interval_days ?? null,
      topUnitLastService: top?.last_service ?? null,
      topUnitSharePct: jobs.length ? Math.round((top?.jobs ?? 0) * 100 / jobs.length) : 0,
      fleetAvgJobs: Math.round(fleetAvgJobs * 10) / 10,
      unitsInvolved: units.length,
      totalDowntimeDays: Math.round(totalDowntime),
      topTypeName: typeStats[0]?.name ?? null,
      openCount,
      completedLastMonthCount,
      avgCostPerJob: jobs.length
        ? jobs.reduce((s, j) => s + Number(j.cost_kwd ?? 0), 0) / jobs.length
        : 0,
      fleetMedianCost,
    },
    series: [],
    breakdowns: {
      topUnits,
      byType: typeStats.slice(0, 10),
      byIssueType: [...perIssueType.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    },
    meta: {
      windowDays: days,
      effortWeights: EFFORT_WEIGHTS,
      confidence: confidenceFrom({
        sampleSize: jobs.length,
        // The ranking reads cost and the start/completion pair; a job missing
        // both contributes a count and nothing else, which is exactly the
        // kind of gap the confidence line should disclose.
        fieldCoverage: coverage(jobs, j =>
          num(j.cost_kwd) > 0 && (j.completion_date || j.start_date)),
        windowDays: days,
      }),
    },
  };
}

function median(arr) {
  if (!arr?.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// ── 4.5 Dispatch trends ─────────────────────────────────────────────────

export async function getDispatchTrends(params = {}) {
  const { days, fromIso, toIso, fromDate, toDate, allTime } = resolveWindow(params, 90);
  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 90);

  // `dispatch_date` is NULLABLE and frequently null: `createDispatch` writes
  // `item.rental_start_date ?? null`, so any dispatch raised from a
  // requirement without rental dates has none. In SQL a NULL fails BOTH
  // `>= from` and `<= to`, so those rows were dropped by the window filter
  // entirely — the dispatch existed, the trend simply could not see it, and
  // the section reported "Insufficient data" over a populated table.
  //
  // So the window is applied to the EFFECTIVE date: `dispatch_date` when it
  // exists, `created_at` otherwise. The two queries are disjoint by
  // construction (one requires a non-null `dispatch_date`, the other requires
  // it to be null), so a row can never be counted twice, and neither
  // over-fetches the way a client-side filter would.
  const DISPATCH_COLS = 'dispatch_id, dispatch_date, created_at, return_date, status, destination, equipment_id, equipment_units(equipment_id, capacity, equipment_types(name))';
  const [dated, undated] = await Promise.all([
    safeQuery(
      supabase
        .from('dispatches')
        .select(DISPATCH_COLS)
        .gte('dispatch_date', fromIso)
        .lte('dispatch_date', toIso),
      'dispatchTrends'
    ),
    safeQuery(
      supabase
        .from('dispatches')
        .select(DISPATCH_COLS)
        .is('dispatch_date', null)
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      'dispatchTrends.undated'
    ),
  ]);
  // `effective_date` is what every bucket, delta and chart below reads, so the
  // two shapes are indistinguishable from here on.
  const rows = [...dated, ...undated]
    .filter(Boolean)
    .map(d => ({ ...d, effective_date: d.dispatch_date ?? d.created_at ?? null }));

  const [prevDated, prevUndated] = await Promise.all([
    safeQuery(
      supabase
        .from('dispatches')
        .select('dispatch_id, dispatch_date, created_at, return_date, status')
        .gte('dispatch_date', prevFromIso)
        .lt('dispatch_date', prevToIso),
      'dispatchTrends.prev'
    ),
    safeQuery(
      supabase
        .from('dispatches')
        .select('dispatch_id, dispatch_date, created_at, return_date, status')
        .is('dispatch_date', null)
        .gte('created_at', prevFromIso)
        .lt('created_at', prevToIso),
      'dispatchTrends.prevUndated'
    ),
  ]);
  const prevRows = [...prevDated, ...prevUndated]
    .filter(Boolean)
    .map(d => ({ ...d, effective_date: d.dispatch_date ?? d.created_at ?? null }));

  const byDay = new Map();
  const byStatus = new Map();
  const byDestination = new Map();
  const byEquipment = new Map();
  let turnaroundSum = 0;
  let turnaroundCount = 0;
  let pendingBacklog = 0;

  for (const d of rows) {
    if (!d) continue;
    const day = (d.effective_date ?? '').slice(0, 10);
    if (day) {
      if (!byDay.has(day)) byDay.set(day, { day, total: 0 });
      byDay.get(day).total += 1;
      const s = d.status ?? 'Unknown';
      byDay.get(day)[s] = (byDay.get(day)[s] ?? 0) + 1;
    }
    const s = d.status ?? 'Unknown';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    if (['Pending', 'Assigned'].includes(d.status)) pendingBacklog += 1;

    const t = daysBetween(d.dispatch_date, d.return_date);
    if (t != null && t >= 0) { turnaroundSum += t; turnaroundCount += 1; }

    const dest = clean(d.destination);
    if (dest) byDestination.set(dest, (byDestination.get(dest) ?? 0) + 1);

    // Equipment NAME, so "what is actually moving" is answerable without
    // reading an id off a chart.
    const tname = d.equipment_units?.equipment_types?.name;
    if (tname) {
      if (!byEquipment.has(tname)) byEquipment.set(tname, { name: tname, dispatches: 0 });
      byEquipment.get(tname).dispatches += 1;
    }
  }

  const prevTurnarounds = prevRows
    .map(d => daysBetween(d.dispatch_date, d.return_date))
    .filter(t => t != null && t >= 0);
  const prevAvgTurnaround = prevTurnarounds.length
    ? prevTurnarounds.reduce((s, t) => s + t, 0) / prevTurnarounds.length
    : 0;

  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const totalDispatches = rows.length;
  const dailyAvg = daily.length ? totalDispatches / daily.length : 0;
  const avgTurnaroundDays = turnaroundCount ? turnaroundSum / turnaroundCount : 0;
  const busiest = [...daily].sort((a, b) => b.total - a.total)[0] ?? null;
  const completed = rows.filter(d => d.return_date).length;

  return {
    kpis: {
      totalDispatches,
      dailyAvg,
      avgTurnaroundDays,
      pendingBacklog,
      // Additive.
      prevTotalDispatches: prevRows.length,
      dispatchesDeltaPct: deltaPct(totalDispatches, prevRows.length),
      prevAvgTurnaroundDays: prevAvgTurnaround,
      // Rounded to 1dp BEFORE the delta so the sentence and the tile agree —
      // comparing raw floats can report a 1% move the display never shows.
      turnaroundDeltaPct: deltaPct(
        Math.round(avgTurnaroundDays * 10) / 10,
        Math.round(prevAvgTurnaround * 10) / 10,
      ),
      completedCount: completed,
      completionPct: totalDispatches ? Math.round(completed * 100 / totalDispatches) : 0,
      busiestDay: busiest?.day ?? null,
      busiestDayCount: busiest?.total ?? 0,
      backlogVsDailyAvg: dailyAvg > 0 ? Math.round((pendingBacklog / dailyAvg) * 10) / 10 : null,
      topEquipmentName: [...byEquipment.values()].sort((a, b) => b.dispatches - a.dispatches)[0]?.name ?? null,
      topDestination: [...byDestination.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    },
    series: {
      daily,
      compare: comparativeSeries(rows, prevRows, {
        days, dateOf: r => r.effective_date,
      }),
    },
    breakdowns: {
      byStatus: [...byStatus.entries()].map(([name, value]) => ({ name, value })),
      byEquipment: [...byEquipment.values()].sort((a, b) => b.dispatches - a.dispatches).slice(0, 8),
      byDestination: [...byDestination.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    },
    meta: {
      windowDays: days,
      fromDate,
      toDate,
      allTime,
      // How many of the dispatches in this window had no `dispatch_date` and
      // were dated by `created_at` instead. Disclosed rather than hidden: it
      // is the difference between "we dispatched on that day" and "the record
      // was raised on that day".
      undatedCount: undated.length,
      emptyReason: totalDispatches === 0 ? await describeDispatchGap(fromIso, toIso) : null,
      comparedTo: prevRows.length > 0 ? `previous ${days} days` : null,
      confidence: confidenceFrom({
        sampleSize: rows.length,
        // Turnaround is the headline claim and it needs a return date.
        fieldCoverage: coverage(rows, d => !!d?.dispatch_date && !!d?.return_date),
        windowDays: days,
      }),
    },
  };
}

// ── 4.6 Return trends ───────────────────────────────────────────────────

export async function getReturnTrends(params = {}) {
  const { days, fromIso, toIso } = resolveWindow(params, 90);
  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 90);

  const returns = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, return_date, status, equipment_id, equipment_units(equipment_id, capacity, equipment_types(name))')
      .not('return_date', 'is', null)
      .gte('return_date', fromIso)
      .lte('return_date', toIso),
    'returnTrends.dispatches'
  );

  const prevReturns = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, return_date')
      .not('return_date', 'is', null)
      .gte('return_date', prevFromIso)
      .lt('return_date', prevToIso),
    'returnTrends.prev'
  );

  const leaseReturns = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, capacity, lease_returned_at, equipment_types(name)')
      .not('lease_returned_at', 'is', null)
      .gte('lease_returned_at', new Date(Date.now() - 365 * 86_400_000).toISOString()),
    'returnTrends.leases'
  );

  // The equipment join is what lets the overdue list read as "Forklift 3T is
  // 46 days out" instead of a bare dispatch id.
  const overdue = await safeQuery(
    supabase
      .from('dispatches')
      .select('dispatch_id, dispatch_date, status, destination, equipment_id, equipment_units(equipment_id, serial_number, capacity, location, equipment_types(name))')
      .in('status', ['Assigned', 'In Transit', 'Pending'])
      .is('return_date', null)
      .lt('dispatch_date', new Date(Date.now() - 30 * 86_400_000).toISOString()),
    'returnTrends.overdue'
  );

  // Per-week turnaround, alongside the plain count — additive to what the
  // week bucket already carried, computed from the same `returns` rows
  // already fetched (no new query), so the weekly chart's drill-down can
  // show something beyond a bare count without inventing data.
  const byWeek = new Map();
  const turnarounds = [];
  for (const r of returns) {
    const wk = weekKey(r.return_date);
    const t = daysBetween(r.dispatch_date, r.return_date);
    if (wk) {
      if (!byWeek.has(wk)) byWeek.set(wk, { count: 0, turnaroundSum: 0, turnaroundN: 0 });
      const w = byWeek.get(wk);
      w.count += 1;
      if (t != null && t >= 0) { w.turnaroundSum += t; w.turnaroundN += 1; }
    }
    if (t != null && t >= 0) turnarounds.push(t);
  }
  const avgReturnDays = turnarounds.length
    ? turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length
    : 0;

  const byMonthLease = new Map();
  for (const l of leaseReturns) {
    const m = (l.lease_returned_at ?? '').slice(0, 7);
    if (!m) continue;
    byMonthLease.set(m, (byMonthLease.get(m) ?? 0) + 1);
  }

  const now = Date.now();
  const overdueRows = overdue
    .map(r => {
      const out = daysBetween(r.dispatch_date, new Date(now));
      const u = r.equipment_units;
      return {
        ...r,
        label: unitLabel({
          equipment_id: r.equipment_id,
          type_name: u?.equipment_types?.name,
          capacity: u?.capacity,
          serial_number: u?.serial_number ?? null,
        }),
        type_name: u?.equipment_types?.name ?? 'Unknown',
        serial_number: u?.serial_number ?? null,
        location: u?.location ?? null,
        days_out: out == null ? null : Math.round(out),
        // Days past the 30-day return threshold, which is the number the
        // collections conversation is actually about.
        days_overdue: out == null ? null : Math.max(0, Math.round(out - 30)),
      };
    })
    .sort((a, b) => (b.days_out ?? 0) - (a.days_out ?? 0));

  const avgDaysOut = overdueRows.length
    ? overdueRows.reduce((s, r) => s + (r.days_out ?? 0), 0) / overdueRows.length
    : 0;

  // Where the overdue units are sitting — the practical next question after
  // "how many".
  const overdueByDestination = new Map();
  for (const r of overdueRows) {
    const dest = clean(r.destination) || 'Unrecorded';
    overdueByDestination.set(dest, (overdueByDestination.get(dest) ?? 0) + 1);
  }

  return {
    kpis: {
      rentalReturnsWindow: returns.length,
      leaseReturnsWindow: leaseReturns.length,
      overdueCount: overdueRows.length,
      avgDaysOutForOverdue: Math.round(avgDaysOut),
      // Additive.
      prevRentalReturns: prevReturns.length,
      returnsDeltaPct: deltaPct(returns.length, prevReturns.length),
      avgReturnDays: Math.round(avgReturnDays * 10) / 10,
      worstOverdueLabel: overdueRows[0]?.label ?? null,
      worstOverdueId: overdueRows[0]?.equipment_id ?? null,
      worstOverdueDays: overdueRows[0]?.days_out ?? 0,
      overdueOver60: overdueRows.filter(r => (r.days_out ?? 0) > 60).length,
      overdueOver90: overdueRows.filter(r => (r.days_out ?? 0) > 90).length,
    },
    series: {
      byWeek: [...byWeek.entries()]
        .map(([week, w]) => ({
          week,
          count: w.count,
          avgTurnaroundDays: w.turnaroundN ? Math.round((w.turnaroundSum / w.turnaroundN) * 10) / 10 : null,
        }))
        .sort((a, b) => a.week.localeCompare(b.week)),
      byMonthLease: [...byMonthLease.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
      compare: comparativeSeries(returns, prevReturns, {
        days, dateOf: r => r.return_date,
      }),
    },
    breakdowns: {
      overdue: overdueRows.slice(0, 10),
      overdueByDestination: [...overdueByDestination.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    },
    meta: {
      windowDays: days,
      comparedTo: prevReturns.length > 0 ? `previous ${days} days` : null,
      confidence: confidenceFrom({
        sampleSize: returns.length + overdueRows.length,
        fieldCoverage: coverage(overdueRows, r => !!r.equipment_units?.equipment_types?.name),
        windowDays: days,
      }),
    },
  };
}

function weekKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const daysOff = (d.getDay() + 6) % 7; // ISO-ish
  d.setDate(d.getDate() - daysOff);
  const wk = Math.ceil(((d - oneJan) / 86_400_000 + oneJan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// ── 4.7 Equipment utilization rate ──────────────────────────────────────

export async function getUtilization() {
  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, status, location, capacity, type_id, equipment_types(type_id, name, category)'),
    'utilization'
  );

  const perType = new Map();
  const perLocation = new Map();
  let totalInUse = 0, totalMaint = 0, totalAll = 0, totalIdle = 0;

  for (const u of units) {
    if (!u) continue;   // a null row must not take the whole section down
    const name = u.equipment_types?.name ?? 'Unknown';
    const cat = u.equipment_types?.category ?? 'Uncategorised';
    const key = `${cat}|${name}`;
    if (!perType.has(key)) {
      // `type_id` rides along for the per-unit drill-down only — never
      // rendered inline, per the names-in-the-UI rule.
      perType.set(key, {
        category: cat, name, type_id: u.type_id ?? u.equipment_types?.type_id ?? null,
        total: 0, in_use: 0, idle: 0, in_maint: 0,
      });
    }
    const t = perType.get(key);
    t.total += 1;
    totalAll += 1;

    const loc = clean(u.location) || 'Unassigned';
    if (!perLocation.has(loc)) {
      perLocation.set(loc, { name: loc, total: 0, in_use: 0, idle: 0, in_maint: 0 });
    }
    const l = perLocation.get(loc);
    l.total += 1;

    if (['Dispatched', 'Reserved'].includes(u.status)) {
      t.in_use += 1; l.in_use += 1; totalInUse += 1;
    } else if (u.status === 'Available') {
      t.idle += 1; l.idle += 1; totalIdle += 1;
    } else if (u.status === 'Maintenance') {
      t.in_maint += 1; l.in_maint += 1; totalMaint += 1;
    }
  }

  // Utilisation excludes units in the workshop from the denominator: a unit
  // that physically cannot be hired out is not idle capacity, and counting it
  // as such makes a maintenance problem look like a demand problem.
  const utilOf = (r) => ((r.total - r.in_maint) > 0
    ? Math.round(r.in_use * 100 / (r.total - r.in_maint))
    : 0);

  const rows = [...perType.values()].map(t => ({
    ...t,
    utilization_pct: utilOf(t),
    idle_pct: t.total > 0 ? Math.round(t.idle * 100 / t.total) : 0,
  }));
  rows.sort((a, b) => b.utilization_pct - a.utilization_pct);

  const byLocation = [...perLocation.values()]
    .map(l => ({ ...l, utilization_pct: utilOf(l) }))
    .sort((a, b) => b.total - a.total);

  const fleetUtil = (totalAll - totalMaint) > 0
    ? Math.round(totalInUse * 100 / (totalAll - totalMaint))
    : 0;

  const pcts = rows.map(r => r.utilization_pct);
  // Types with a single unit swing between 0% and 100% on one dispatch, so
  // the "cold lines" list only considers types with real depth — otherwise
  // the recommendation is drawn from noise.
  const material = rows.filter(r => r.total >= 2);
  const cold = material.filter(r => r.utilization_pct < 30);
  const hot = material.filter(r => r.utilization_pct > 85);

  return {
    kpis: {
      fleetUtilPct: fleetUtil,
      totalUnits: totalAll,
      inUse: totalInUse,
      inMaint: totalMaint,
      topName: rows[0]?.name ?? null,
      topPct: rows[0]?.utilization_pct ?? 0,
      lowName: rows[rows.length - 1]?.name ?? null,
      lowPct: rows[rows.length - 1]?.utilization_pct ?? 0,
      // Additive.
      idleCount: totalIdle,
      medianUtilPct: pcts.length ? Math.round(median(pcts)) : 0,
      spreadPct: pcts.length ? (Math.max(...pcts) - Math.min(...pcts)) : 0,
      hotTypeCount: hot.length,
      coldTypeCount: cold.length,
      coldNames: cold.slice(0, 3).map(r => r.name),
      hotNames: hot.slice(0, 3).map(r => r.name),
      maintDragPct: totalAll ? Math.round(totalMaint * 100 / totalAll) : 0,
      typesTracked: rows.length,
      topLocation: byLocation[0]?.name ?? null,
      topLocationUtilPct: byLocation[0]?.utilization_pct ?? 0,
    },
    series: {
      // Stacked composition per type: in-use / idle / workshop. Reads the
      // same data as the utilisation bar but answers "why" rather than
      // "how much", which is the contextual chart this section lacked.
      composition: rows.slice(0, 10).map(r => ({
        name: r.name,
        'In use': r.in_use,
        Idle: r.idle,
        Maintenance: r.in_maint,
      })),
    },
    breakdowns: {
      byType: rows,
      byLocation: byLocation.slice(0, 8),
      cold: cold.slice(0, 5),
      hot: hot.slice(0, 5),
    },
    meta: {
      confidence: confidenceFrom({
        sampleSize: units.length,
        // A unit with no type link cannot be attributed to a line, so the
        // per-type ranking is only as complete as this coverage.
        fieldCoverage: coverage(units, u => !!u.equipment_types?.name && !!u.status),
        // Live snapshot — no window to qualify.
        windowDays: 0,
      }),
    },
  };
}

// ── 4.8 Revenue by equipment category ───────────────────────────────────

export async function getRevenueByCategory(params = {}) {
  const { days, fromIso, toIso, fromDate, toDate, allTime } = resolveWindow(params, 90);
  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 90);

  // Rental revenue: invoices → quotations → quotation_items → equipment_units → equipment_types
  //
  // Two changes from the original query, both of which were causing this
  // section to report "Insufficient data" over a database that had revenue in
  // it. `issue_date` is nullable and unset until an invoice is issued, and a
  // NULL fails both window bounds — so draft-then-issued invoices vanished.
  // And the status filter was an ALLOW-list (`Sent`/`Paid`/`Partial`), which
  // returns nothing at all on a deployment whose invoice workflow uses any
  // other wording. Voided documents are excluded by name instead.
  const invoicesRaw = await windowedRows(
    'invoices',
    'invoice_id, quotation_id, status, total_amount_kwd, amount_paid_kwd, issue_date, created_at',
    {
      primary: 'issue_date', primaryFrom: fromDate, primaryTo: toDate,
      fallback: 'created_at', fallbackFrom: fromIso, fallbackTo: toIso,
      tag: 'revByCat.invoices',
    }
  );
  const invoices = invoicesRaw.filter(i => !isVoid(i.status));

  // Baseline period — headline revenue only. Re-running the full line-item
  // attribution for the previous window would double this section's query
  // cost to support one sentence, and the invoice total is the number that
  // sentence quotes anyway.
  const prevInvoices = (await windowedRows(
    'invoices',
    'invoice_id, status, total_amount_kwd, issue_date, created_at',
    {
      primary: 'issue_date',
      primaryFrom: prevFromIso.slice(0, 10), primaryTo: prevToIso.slice(0, 10),
      fallback: 'created_at', fallbackFrom: prevFromIso, fallbackTo: prevToIso,
      tag: 'revByCat.prevInvoices',
    }
  )).filter(i => !isVoid(i.status));

  const quotationIds = [...new Set(invoices.map(i => i.quotation_id).filter(Boolean))];
  let items = [];
  if (quotationIds.length) {
    items = await safeQueryAll(
      () => supabase
        .from('quotation_items')
        .select('quotation_id, equipment_id, total_kwd, unit_rate_kwd, quantity, equipment_units(equipment_id, capacity, equipment_types(type_id, name, category))')
        .in('quotation_id', quotationIds),
      PK_COLUMN.quotation_items,
      'revByCat.items'
    );
  }

  // Sum item-line KWD per quotation, then split each invoice's total_amount_kwd
  // across its items proportionally. When items are missing/zero, invoice
  // revenue is attributed to "Unallocated".
  const itemsByQuot = new Map();
  for (const it of items) {
    if (!itemsByQuot.has(it.quotation_id)) itemsByQuot.set(it.quotation_id, []);
    itemsByQuot.get(it.quotation_id).push(it);
  }

  const byCat = new Map();
  const bump = (cat, key, amount) => {
    if (!byCat.has(cat)) byCat.set(cat, { category: cat, revenue: 0, rental: 0, lease: 0 });
    byCat.get(cat).revenue += amount;
    byCat.get(cat)[key] += amount;
  };

  // The same attribution, keyed on the equipment NAME rather than its
  // category — "which category earns most" is a portfolio question, but the
  // follow-up is always "which machine", and that answer must be a name.
  const byEquip = new Map();
  const bumpEquip = (name, meta, key, amount) => {
    if (!byEquip.has(name)) {
      byEquip.set(name, {
        name, category: meta?.category ?? null, type_id: meta?.type_id ?? null,
        revenue: 0, rental: 0, lease: 0, lines: 0,
      });
    }
    const row = byEquip.get(name);
    row.revenue += amount;
    row[key] += amount;
    row.lines += 1;
  };

  for (const inv of invoices) {
    const its = itemsByQuot.get(inv.quotation_id) ?? [];
    const total = Number(inv.total_amount_kwd ?? 0);
    const itemsSum = its.reduce((s, it) => s + Number(it.total_kwd ?? (it.quantity ?? 1) * (it.unit_rate_kwd ?? 0)), 0);
    if (!its.length || itemsSum <= 0) {
      bump('Unallocated', 'rental', total);
      continue;
    }
    for (const it of its) {
      const t = it.equipment_units?.equipment_types;
      const cat = t?.category ?? 'Uncategorised';
      const line = Number(it.total_kwd ?? (it.quantity ?? 1) * (it.unit_rate_kwd ?? 0));
      const share = itemsSum > 0 ? (line / itemsSum) * total : 0;
      bump(cat, 'rental', share);
      bumpEquip(t ? typeName(t) : 'Unspecified equipment', t, 'rental', share);
    }
  }

  // Lease revenue (paid lease_invoices)
  // Lease revenue. `paid_at` is only set once a lease invoice is settled, so
  // windowing on it alone hides everything billed but unpaid; `period_start`
  // is the NULL companion. Paid invoices are still preferred — when any exist
  // the figure means exactly what it always did — and the billed-but-unpaid
  // set is used only when nothing has been settled in the window at all.
  const LEASE_COLS = 'amount_kwd, status, paid_at, period_start, equipment_id, equipment_units(equipment_types(type_id, name, category))';
  const leaseAll = (await windowedRows('lease_invoices', LEASE_COLS, {
    primary: 'paid_at', primaryFrom: fromIso, primaryTo: toIso,
    fallback: 'period_start', fallbackFrom: fromDate, fallbackTo: toDate,
    tag: 'revByCat.leaseInv',
  })).filter(li => !isVoid(li.status));
  const leasePaid = leaseAll.filter(li => String(li.status ?? '').trim().toLowerCase() === 'paid');
  const leaseInv = leasePaid.length ? leasePaid : leaseAll;
  const leaseBasisBilled = !leasePaid.length && leaseAll.length > 0;
  for (const li of leaseInv) {
    const t = li.equipment_units?.equipment_types;
    const cat = t?.category ?? 'Uncategorised';
    const amount = Number(li.amount_kwd ?? 0);
    bump(cat, 'lease', amount);
    bumpEquip(t ? typeName(t) : 'Unspecified equipment', t, 'lease', amount);
  }

  // ── Fallback: contracted value ─────────────────────────────────────────
  //
  // Nothing has been invoiced or billed in this window. That is the normal
  // state of a part-built ERP whose quoting is live but whose billing is not,
  // and "Insufficient data" is the wrong answer to "which categories drive
  // revenue" when the contracted value of the period is sitting in
  // `quotations`. So the closest valid business metric is used instead — the
  // value of the contracts raised — and the basis is disclosed rather than
  // passed off as billed revenue.
  let revenueBasis = 'invoiced';
  let contracts = [];
  if (byCat.size === 0) {
    contracts = (await windowedRows(
      'quotations',
      'quotation_id, status, total_amount_kwd, quotation_date, created_at',
      {
        primary: 'quotation_date', primaryFrom: fromDate, primaryTo: toDate,
        fallback: 'created_at', fallbackFrom: fromIso, fallbackTo: toIso,
        tag: 'revByCat.quotations',
      }
    )).filter(q => !isVoid(q.status));

    const qIds = [...new Set(contracts.map(q => q?.quotation_id).filter(Boolean))];
    const qItems = qIds.length
      ? await safeQueryAll(
        () => supabase
          .from('quotation_items')
          .select('quotation_id, equipment_id, total_kwd, unit_rate_kwd, quantity, equipment_units(equipment_id, capacity, equipment_types(type_id, name, category))')
          .in('quotation_id', qIds),
        PK_COLUMN.quotation_items,
        'revByCat.quotationItems'
      )
      : [];
    const qItemsBy = new Map();
    for (const it of qItems) {
      if (!it) continue;
      if (!qItemsBy.has(it.quotation_id)) qItemsBy.set(it.quotation_id, []);
      qItemsBy.get(it.quotation_id).push(it);
    }
    // Same proportional attribution as the invoice path, so the category
    // split means the same thing whichever basis produced it.
    for (const q of contracts) {
      const its = qItemsBy.get(q.quotation_id) ?? [];
      const lineOf = (it) => Number(it.total_kwd ?? (it.quantity ?? 1) * (it.unit_rate_kwd ?? 0)) || 0;
      const itemsSum = its.reduce((sum, it) => sum + lineOf(it), 0);
      const total = Number(q.total_amount_kwd ?? 0) || itemsSum;
      if (!its.length || itemsSum <= 0) {
        if (total > 0) bump('Unallocated', 'rental', total);
        continue;
      }
      for (const it of its) {
        const t = it.equipment_units?.equipment_types;
        const cat = t?.category ?? 'Uncategorised';
        const share = (lineOf(it) / itemsSum) * total;
        bump(cat, 'rental', share);
        bumpEquip(t ? typeName(t) : 'Unspecified equipment', t, 'rental', share);
      }
    }
    if (byCat.size > 0) revenueBasis = 'contracted';
  }

  const rows = [...byCat.values()].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalRental = rows.reduce((s, r) => s + r.rental, 0);
  const totalLease = rows.reduce((s, r) => s + r.lease, 0);
  const prevRevenue = prevInvoices.reduce((s, i) => s + num(i.total_amount_kwd), 0);

  const byEquipment = [...byEquip.values()]
    .map(r => ({
      ...r,
      revenue: Math.round(r.revenue * 100) / 100,
      sharePct: totalRevenue ? Math.round(r.revenue * 100 / totalRevenue) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Concentration: how much of the book the top 3 categories carry. A single
  // top-share figure hides the difference between "one big line" and "three
  // big lines and nothing else", which are different risks.
  const top3 = rows.slice(0, 3).reduce((s, r) => s + r.revenue, 0);

  return {
    kpis: {
      totalRevenue,
      totalRental,
      totalLease,
      topCategory: rows[0]?.category ?? null,
      topRevenue: rows[0]?.revenue ?? 0,
      topSharePct: totalRevenue ? Math.round((rows[0]?.revenue ?? 0) * 100 / totalRevenue) : 0,
      // Additive.
      prevRevenue,
      revenueDeltaPct: deltaPct(totalRevenue, prevRevenue),
      leaseSharePct: totalRevenue ? Math.round(totalLease * 100 / totalRevenue) : 0,
      top3SharePct: totalRevenue ? Math.round(top3 * 100 / totalRevenue) : 0,
      categoriesEarning: rows.filter(r => r.revenue > 0).length,
      topEquipmentName: byEquipment[0]?.name ?? null,
      topEquipmentRevenue: byEquipment[0]?.revenue ?? 0,
      topEquipmentSharePct: byEquipment[0]?.sharePct ?? 0,
      unallocatedPct: totalRevenue
        ? Math.round((rows.find(r => r.category === 'Unallocated')?.revenue ?? 0) * 100 / totalRevenue)
        : 0,
      invoiceCount: invoices.length,
      avgInvoiceValue: invoices.length ? totalRevenue / invoices.length : 0,
      // Generalised across whichever basis produced the figures, so the tile
      // reads correctly when revenue came from contracts rather than
      // invoices. The two fields above are retained verbatim — the template
      // reads them and is not being changed.
      contractCount: revenueBasis === 'contracted'
        ? contracts.length
        : invoices.length + leaseInv.length,
      avgPerContract: (() => {
        const n = revenueBasis === 'contracted'
          ? contracts.length
          : invoices.length + leaseInv.length;
        return n ? totalRevenue / n : 0;
      })(),
    },
    series: {
      compare: comparativeSeries(invoices, prevInvoices, {
        days, dateOf: r => r.effective_date, sumOf: r => r.total_amount_kwd,
      }),
    },
    breakdowns: {
      byCategory: rows.map(r => ({
        ...r,
        sharePct: totalRevenue ? Math.round(r.revenue * 100 / totalRevenue) : 0,
      })),
      byEquipment: byEquipment.slice(0, 10),
    },
    meta: {
      windowDays: days,
      fromDate,
      toDate,
      allTime,
      // Which source the numbers came from, so the card can say so instead of
      // presenting contracted value as billed revenue.
      revenueBasis: totalRevenue > 0 ? revenueBasis : null,
      leaseBasisBilled,
      emptyReason: totalRevenue > 0 ? null : await describeRevenueGap(fromDate, toDate),
      hasLineItems: items.length > 0,
      comparedTo: prevInvoices.length > 0 ? `previous ${days} days` : null,
      confidence: confidenceFrom({
        sampleSize: invoices.length,
        // An invoice with no quotation link falls into Unallocated, which is
        // precisely the attribution gap this figure should disclose.
        fieldCoverage: coverage(invoices, i => !!i.quotation_id && itemsByQuot.has(i.quotation_id)),
        windowDays: days,
      }),
    },
  };
}

// Explains an empty revenue window in terms of what the tables DO hold, so
// the card can point somewhere instead of just declining. Never throws.
async function describeRevenueGap(fromDate, toDate) {
  const span = `${fromDate} to ${toDate}`;
  try {
    const [inv, quo] = await Promise.all([
      safeQuery(supabase.from('invoices').select('issue_date, created_at')
        .order('created_at', { ascending: false }).limit(1), 'revByCat.probeInv'),
      safeQuery(supabase.from('quotations').select('quotation_date, created_at')
        .order('created_at', { ascending: false }).limit(1), 'revByCat.probeQuo'),
    ]);
    const newestInv = inv[0]?.issue_date ?? inv[0]?.created_at;
    const newestQuo = quo[0]?.quotation_date ?? quo[0]?.created_at;
    const newest = [newestInv, newestQuo].filter(Boolean).sort().pop();
    if (!newest) {
      return 'No invoices or quotations have been recorded yet. Once either exists, revenue by category appears here for whichever period you select.';
    }
    return `No invoiced or contracted value between ${span}. The most recent revenue document on record is ${String(newest).slice(0, 10)} — widen the date range or pick a period that covers it.`;
  } catch {
    return `No invoiced or contracted value between ${span}.`;
  }
}

// ── 4.9 Procurement vs leasing ──────────────────────────────────────────

// `procurements.type` was originally documented here as 'Buy'/'Lease' but the
// actual column stores 'Purchase'/'Lease' — the ProcurementPage `<option>`s,
// the badge in receiveProcurement, the finance page all say Purchase. Reading
// the raw column against a hard-coded 'Buy' therefore matched zero rows on
// every real environment, so the section fell straight through to
// "Insufficient data" even when the DB was full of procurement records. This
// normaliser is the single point at which any stored spelling (Buy /
// Purchase / Purchased / Own) collapses to the internal 'Buy' bucket the rest
// of the file already operates on.
const BUY_TYPE_SPELLINGS = new Set(['buy', 'purchase', 'purchased', 'own', 'owned', 'capex']);
const LEASE_TYPE_SPELLINGS = new Set(['lease', 'leased', 'rental', 'rent', 'hire']);
function normalizeProcMode(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (BUY_TYPE_SPELLINGS.has(s)) return 'Buy';
  if (LEASE_TYPE_SPELLINGS.has(s)) return 'Lease';
  return null;
}

// Turn a procurements payload + its line items into the analysis shape this
// section renders. Extracted so the same aggregation runs against the window,
// the all-time widen, and the equipment_units synthesised set — the alternative
// was three near-copies drifting apart every time a KPI moved.
function buildProcVsLeaseShape(procs, items, { days, windowStartIso, source, extra }) {
  const cancelled = procs.filter(p => ['Cancelled', 'Rejected'].includes(p.status));
  const active = procs
    .map(p => ({ ...p, _mode: normalizeProcMode(p.type) }))
    .filter(p => !['Cancelled', 'Rejected'].includes(p.status) && p._mode);

  let buyCount = 0, leaseCount = 0;
  let buySpend = 0, leaseCommit = 0, leaseMonthly = 0;
  for (const p of active) {
    if (p._mode === 'Buy') { buyCount += 1; buySpend += num(p.total_amount_kwd); }
    else if (p._mode === 'Lease') {
      leaseCount += 1;
      leaseCommit += num(p.total_amount_kwd);
      leaseMonthly += num(p.lease_monthly_kwd);
    }
  }

  const avgBuyPrice = buyCount ? buySpend / buyCount : 0;
  const avgMonthly = leaseCount ? leaseMonthly / leaseCount : 0;
  const breakEvenMonths = avgMonthly > 0 && avgBuyPrice > 0
    ? avgBuyPrice / avgMonthly
    : null;
  const annualLeaseExtrapolated = leaseMonthly * 12;

  const modeOf = new Map(active.map(p => [p.procurement_id, p._mode]));
  const monthlyOf = new Map(active.map(p => [p.procurement_id, num(p.lease_monthly_kwd)]));
  const lineCount = new Map();
  for (const it of items) {
    lineCount.set(it.procurement_id, (lineCount.get(it.procurement_id) ?? 0) + 1);
  }

  const perEquip = new Map();
  for (const it of items) {
    const t = it.equipment_types;
    const name = t ? typeName(t) : (clean(it.description) || 'Unspecified equipment');
    if (!perEquip.has(name)) {
      perEquip.set(name, {
        name,
        type_id: it.equipment_type_id ?? t?.type_id ?? null,
        category: t?.category ?? null,
        buyQty: 0, leaseQty: 0, buySpend: 0, leaseMonthly: 0,
      });
    }
    const row = perEquip.get(name);
    const qty = itemQty(it);
    const mode = modeOf.get(it.procurement_id);
    if (mode === 'Lease') {
      row.leaseQty += qty;
      row.leaseMonthly += (monthlyOf.get(it.procurement_id) ?? 0)
        / Math.max(1, lineCount.get(it.procurement_id) ?? 1);
    } else if (mode === 'Buy') {
      row.buyQty += qty;
      row.buySpend += num(it.unit_price_kwd) * qty;
    }
  }

  const byEquipment = [...perEquip.values()]
    .map(r => {
      const unitPrice = r.buyQty ? r.buySpend / r.buyQty : 0;
      const unitMonthly = r.leaseQty ? r.leaseMonthly / r.leaseQty : 0;
      return {
        ...r,
        buySpend: Math.round(r.buySpend * 100) / 100,
        leaseMonthly: Math.round(r.leaseMonthly * 100) / 100,
        avgBuyPrice: unitPrice,
        avgLeaseMonthly: unitMonthly,
        breakEvenMonths: unitPrice > 0 && unitMonthly > 0 ? unitPrice / unitMonthly : null,
        mode: r.buyQty && r.leaseQty ? 'Both' : r.leaseQty ? 'Lease' : 'Buy',
      };
    })
    .sort((a, b) => (b.buySpend + b.leaseMonthly * 12) - (a.buySpend + a.leaseMonthly * 12));

  const comparable = byEquipment.filter(r => r.breakEvenMonths != null);

  const byMonth = new Map();
  for (const p of active) {
    const m = (p.created_at ?? '').slice(0, 7);
    if (!m) continue;
    if (!byMonth.has(m)) byMonth.set(m, { month: m, Buy: 0, Lease: 0, buySpend: 0, leaseMonthly: 0 });
    const row = byMonth.get(m);
    if (p._mode === 'Lease') {
      row.Lease += 1;
      row.leaseMonthly += num(p.lease_monthly_kwd);
    } else if (p._mode === 'Buy') {
      row.Buy += 1;
      row.buySpend += num(p.total_amount_kwd);
    }
  }
  const monthly = [...byMonth.values()]
    .map(r => ({
      ...r,
      buySpend: Math.round(r.buySpend),
      leaseMonthly: Math.round(r.leaseMonthly),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const third = Math.max(1, Math.floor(monthly.length / 3));
  const mixShare = (slice) => {
    const b = slice.reduce((s, r) => s + r.Buy, 0);
    const l = slice.reduce((s, r) => s + r.Lease, 0);
    return (b + l) > 0 ? Math.round(b * 100 / (b + l)) : null;
  };
  const earlyBuyShare = monthly.length >= 3 ? mixShare(monthly.slice(0, third)) : null;
  const lateBuyShare = monthly.length >= 3 ? mixShare(monthly.slice(-third)) : null;

  return {
    kpis: {
      buyCount, leaseCount,
      buySpend, leaseCommit,
      leaseMonthlyCommit: leaseMonthly,
      annualLeaseExtrapolated,
      breakEvenMonths,
      avgBuyPrice,
      avgLeaseMonthly: avgMonthly,
      buySharePct: (buyCount + leaseCount) ? Math.round(buyCount * 100 / (buyCount + leaseCount)) : 0,
      cancelledCount: cancelled.length,
      comparableLines: comparable.length,
      topLineName: byEquipment[0]?.name ?? null,
      topLineMode: byEquipment[0]?.mode ?? null,
      topLineBreakEven: byEquipment[0]?.breakEvenMonths ?? null,
      leaseFavouredCount: comparable.filter(r => r.breakEvenMonths > 36).length,
      buyFavouredCount: comparable.filter(r => r.breakEvenMonths < 18).length,
      earlyBuyShare,
      lateBuyShare,
      mixShiftPct: (earlyBuyShare != null && lateBuyShare != null)
        ? lateBuyShare - earlyBuyShare
        : null,
      ...(extra?.kpis ?? {}),
    },
    series: { monthly },
    breakdowns: {
      rows: [
        { type: 'Buy',   count: buyCount,   spend: buySpend,   monthly: 0 },
        { type: 'Lease', count: leaseCount, spend: leaseCommit, monthly: leaseMonthly },
      ],
      byEquipment: byEquipment.slice(0, 10),
      comparable: comparable.slice(0, 8),
    },
    meta: {
      windowDays: days,
      windowStartIso: windowStartIso ?? null,
      hasLineItems: items.length > 0,
      source,
      confidence: confidenceFrom({
        sampleSize: active.length,
        fieldCoverage: coverage(active, p => p._mode === 'Lease'
          ? num(p.lease_monthly_kwd) > 0
          : num(p.total_amount_kwd) > 0),
        windowDays: days,
      }),
      ...(extra?.meta ?? {}),
    },
  };
}

export async function getProcurementVsLease(params = {}) {
  const { days, fromIso, toIso } = resolveWindow(params, 365);

  // ── Primary source: procurements in the selected window ────────────────
  const procs = await safeQuery(
    supabase
      .from('procurements')
      .select('procurement_id, type, status, total_amount_kwd, lease_monthly_kwd, created_at')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    'procVsLease'
  );

  const fetchItems = async (procRows) => {
    const ids = procRows
      .filter(p => !['Cancelled', 'Rejected'].includes(p.status))
      .map(p => p.procurement_id)
      .filter(Boolean);
    if (!ids.length) return [];
    return safeQuery(
      supabase
        .from('procurement_items')
        .select('*, equipment_types(type_id, name, category)')
        .in('procurement_id', ids),
      'procVsLease.items'
    );
  };

  const hasUsable = (rows) => rows.some(p =>
    normalizeProcMode(p.type) && !['Cancelled', 'Rejected'].includes(p.status)
  );

  if (hasUsable(procs)) {
    const items = await fetchItems(procs);
    return buildProcVsLeaseShape(procs, items, {
      days,
      windowStartIso: fromIso,
      source: 'procurements',
    });
  }

  // ── Fallback 1: procurements exist but not in the picked window ───────
  // Widen to all-time procurements so a custom range that lands in a quiet
  // month still answers the question rather than blanking. The section
  // subtitle discloses this via `meta.source` / `meta.rangeApplied`.
  const allProcs = await safeQuery(
    supabase
      .from('procurements')
      .select('procurement_id, type, status, total_amount_kwd, lease_monthly_kwd, created_at'),
    'procVsLease.allProcs'
  );

  if (hasUsable(allProcs)) {
    const items = await fetchItems(allProcs);
    return buildProcVsLeaseShape(allProcs, items, {
      days,
      windowStartIso: fromIso,
      source: 'procurements_all_time',
      extra: { meta: { rangeApplied: false, windowEmpty: procs.length === 0 } },
    });
  }

  // ── Fallback 2: synthesise from equipment_units ────────────────────────
  // No procurement records at all in this environment — but the fleet still
  // has Purchase vs Lease units on record with rates and dates. Rebuild the
  // same shape from equipment_units so the section still renders a real
  // Buy/Lease comparison rather than declining.
  //
  // Each unit becomes a synthetic "procurement": one Buy unit at its own
  // daily-rate × 30 as a proxy monthly rental value (used for share-of-value
  // ranking) and one Lease unit at the same, with the lease monthly cost
  // taken from procurements(lease_monthly_kwd) via the join when available.
  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select(`
        equipment_id, procurement_type, procurement_id, daily_rate_kwd,
        lease_start_date, lease_end_date, status, created_at, type_id,
        equipment_types(type_id, name, category),
        procurements(procurement_id, type, status, total_amount_kwd, lease_monthly_kwd, created_at)
      `),
    'procVsLease.units'
  );

  if (units.length === 0) {
    return buildProcVsLeaseShape([], [], {
      days,
      windowStartIso: fromIso,
      source: 'none',
      extra: { meta: { emptyReason: 'no_procurements_no_equipment' } },
    });
  }

  // Group units by their PARENT procurement id when available; otherwise treat
  // each unit as its own synthetic procurement so a manually-added unit still
  // ranks. `procurement_type` beats `procurements.type` on the unit side
  // because it captures the mode chosen at receive time even when a
  // procurement was later cancelled or reclassified.
  const synthProcs = new Map();
  const synthItems = [];
  for (const u of units) {
    if (!u) continue;
    const parent = u.procurements;
    const mode = normalizeProcMode(u.procurement_type ?? parent?.type);
    if (!mode) continue;
    const procId = parent?.procurement_id ?? `unit:${u.equipment_id}`;
    const created = parent?.created_at ?? u.created_at ?? u.lease_start_date ?? null;
    // The window filter is best-effort: if a range was picked, only include
    // units whose parent procurement (or lease start / created_at) landed in
    // it. If that leaves nothing, we fall through to all-time below.
    if (!synthProcs.has(procId)) {
      // Split the lease monthly across all units of the same lease
      // procurement, so per-unit monthly matches the header rate ÷ unit count.
      synthProcs.set(procId, {
        procurement_id: procId,
        type: mode,
        status: parent?.status ?? 'Received',
        total_amount_kwd: parent?.total_amount_kwd
          // For synthetic single-unit rows we do not know the purchase price,
          // so leave it null — the aggregator counts these but excludes them
          // from the average-price figure via the num()/coverage() checks.
          ?? null,
        lease_monthly_kwd: parent?.lease_monthly_kwd ?? null,
        created_at: created,
        _unitCount: 0,
      });
    }
    synthProcs.get(procId)._unitCount += 1;
    synthItems.push({
      procurement_id: procId,
      equipment_type_id: u.type_id ?? u.equipment_types?.type_id ?? null,
      equipment_types: u.equipment_types ?? null,
      unit_price_kwd: null,       // per-unit price is not held on equipment_units
      quantity: 1,
      received_qty: 1,
      description: null,
    });
  }

  // For lease procurements with multiple units the header monthly rate is the
  // whole procurement's cost; divide it across the units so per-unit numbers
  // are honest.
  const procList = [...synthProcs.values()].map(p => {
    if (p.type === 'Lease' && p.lease_monthly_kwd != null && p._unitCount > 1) {
      return { ...p, lease_monthly_kwd: Number(p.lease_monthly_kwd) };
    }
    return p;
  });

  // Try the window first, all-time as fallback. The window is on parent
  // procurement created_at (or unit created_at when there is no parent).
  const windowed = procList.filter(p => {
    const t = p.created_at ? new Date(p.created_at).getTime() : null;
    if (t == null || !Number.isFinite(t)) return false;
    return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
  });

  const chosen = windowed.length ? windowed : procList;
  const chosenIds = new Set(chosen.map(p => p.procurement_id));
  const chosenItems = synthItems.filter(it => chosenIds.has(it.procurement_id));

  return buildProcVsLeaseShape(chosen, chosenItems, {
    days,
    windowStartIso: fromIso,
    source: windowed.length ? 'equipment_units' : 'equipment_units_all_time',
    extra: {
      meta: {
        rangeApplied: windowed.length > 0,
        windowEmpty: windowed.length === 0,
        synthesised: true,
      },
    },
  });
}

// ── 4.10 Idle vs active equipment ───────────────────────────────────────

export async function getIdleVsActive(params = {}) {
  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, serial_number, capacity, status, location, updated_at, equipment_types(type_id, name, category)')
      .order('updated_at', { ascending: true }),
    'idleVsActive'
  );

  // Dispatch history for never-dispatched flag and last customer lookup.
  const allUnitIds = units.map(u => u?.equipment_id).filter(Boolean);
  const dispatchHistory = allUnitIds.length ? await safeQuery(
    supabase
      .from('dispatches')
      .select('equipment_id, customer_id, actual_return_date, customers(company_name)')
      .not('actual_return_date', 'is', null)
      .in('equipment_id', allUnitIds)
      .order('actual_return_date', { ascending: false }),
    'idleVsActive.history'
  ) : [];

  const everDispatchedSet = new Set(dispatchHistory.map(d => d?.equipment_id).filter(Boolean));
  const lastCustomerMap = new Map();
  for (const d of dispatchHistory) {
    if (!d?.equipment_id || lastCustomerMap.has(d.equipment_id)) continue;
    lastCustomerMap.set(d.equipment_id, d.customers?.company_name ?? null);
  }

  // ── What a date range can and cannot mean here ──────────────────────────
  //
  // `equipment_units.status` holds only the CURRENT state; there is no status
  // history, so no query can reconstruct "what was idle last March". What the
  // range CAN do honestly is move the reference date the idle DURATIONS are
  // measured against: with a range selected, "idle days" is counted to the end
  // of that range rather than to today, and a unit whose last movement falls
  // AFTER that date is not claimed to have been idle then.
  //
  // With no explicit range the reference is now and every number is exactly
  // what it was before — the filter is additive, not a change of meaning.
  const win = resolveWindow(params, 0);
  const asOf = win.explicitRange
    ? Math.min(new Date(win.toIso).getTime(), Date.now())
    : Date.now();

  // A finite timestamp, or null. `updated_at` is free-form enough in practice
  // that `new Date('not-a-date')` happens, and the old `u.updated_at ? ... : 0`
  // guard only caught null — an unparseable string sailed through and rendered
  // as "NaNd" in the longest-idle list.
  const stamp = (v) => {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const idleDaysOf = (v) => {
    const t = stamp(v);
    if (t === null) return 0;
    return Math.max(0, Math.floor((asOf - t) / 86_400_000));
  };

  let active = 0, idle = 0, maint = 0;
  const idleUnits = [];
  const byLocation = new Map();
  const perType = new Map();
  let excludedByAsOf = 0;

  for (const u of units) {
    if (!u) continue;   // a null row must not take the whole section down
    // Moved after the as-of date: whatever it is doing now, it was not
    // standing idle then, and counting it would be a claim about history the
    // data cannot support.
    const moved = stamp(u.updated_at);
    if (win.explicitRange && moved !== null && moved > asOf) { excludedByAsOf += 1; continue; }
    const tname = u.equipment_types?.name ?? 'Unknown';
    if (!perType.has(tname)) {
      perType.set(tname, {
        name: tname,
        category: u.equipment_types?.category ?? null,
        total: 0, idle: 0, active: 0, maint: 0,
      });
    }
    const t = perType.get(tname);
    t.total += 1;

    if (['Dispatched', 'Reserved'].includes(u.status)) { active += 1; t.active += 1; }
    else if (u.status === 'Available') {
      idle += 1;
      t.idle += 1;
      idleUnits.push(u);
      if (u.location) byLocation.set(u.location, (byLocation.get(u.location) ?? 0) + 1);
    } else if (u.status === 'Maintenance') { maint += 1; t.maint += 1; }
  }

  // Longest idle streak = time since updated_at for status Available.
  // The label is built here, in the API layer, for the same reason as every
  // other section: the chart, the list, the brief and the tooltip must all
  // quote the same string.
  const longestIdle = idleUnits
    .map(u => ({
      ...u,
      label: unitLabel({
        equipment_id: u.equipment_id,
        type_name: u.equipment_types?.name,
        capacity: u.capacity,
        serial_number: u.serial_number ?? null,
      }),
      type_name: u.equipment_types?.name ?? 'Unknown',
      idle_days: idleDaysOf(u.updated_at),
      never_dispatched: !everDispatchedSet.has(u.equipment_id),
      last_customer: lastCustomerMap.get(u.equipment_id) ?? null,
    }))
    .sort((a, b) => b.idle_days - a.idle_days)
    .slice(0, 10);

  const allIdleDays = idleUnits.map(u => idleDaysOf(u.updated_at));
  const idleOver30 = allIdleDays.filter(d => d > 30).length;
  const idleOver60 = allIdleDays.filter(d => d > 60).length;
  const idleOver90 = allIdleDays.filter(d => d > 90).length;

  const byType = [...perType.values()]
    .map(t => ({ ...t, idleSharePct: t.total ? Math.round(t.idle * 100 / t.total) : 0 }))
    .sort((a, b) => b.idle - a.idle || b.total - a.total);
  // A single idle unit of a one-unit type is 100% idle and means nothing;
  // the "coldest line" claim needs at least a pair to stand on.
  const coldest = byType.filter(t => t.total >= 2 && t.idle > 0)[0] ?? null;

  return {
    kpis: {
      active,
      idle,
      maint,
      total: units.length,
      idleSharePct: units.length ? Math.round(idle * 100 / units.length) : 0,
      longestIdleDays: longestIdle[0]?.idle_days ?? 0,
      longestIdleId: longestIdle[0]?.equipment_id ?? null,
      // Additive — the NAME is what the UI and the templates now read;
      // longestIdleId above is retained for the tooltip and existing callers.
      longestIdleLabel: longestIdle[0]?.label ?? null,
      idleOver30,
      idleOver60,
      idleOver90,
      avgIdleDays: allIdleDays.length
        ? Math.round(allIdleDays.reduce((s, d) => s + d, 0) / allIdleDays.length)
        : 0,
      coldestTypeName: coldest?.name ?? null,
      coldestTypeIdle: coldest?.idle ?? 0,
      coldestTypeTotal: coldest?.total ?? 0,
      topIdleLocation: [...byLocation.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      maintSharePct: units.length ? Math.round(maint * 100 / units.length) : 0,
    },
    series: {
      // How stale the idle stock is — a different question from how much of
      // it there is, and the one that decides whether to remarket.
      idleAgeing: [
        { bucket: '0–30d',  units: allIdleDays.filter(d => d <= 30).length },
        { bucket: '31–60d', units: allIdleDays.filter(d => d > 30 && d <= 60).length },
        { bucket: '61–90d', units: allIdleDays.filter(d => d > 60 && d <= 90).length },
        { bucket: '90d+',   units: idleOver90 },
      ].filter(r => r.units > 0),
    },
    breakdowns: {
      byStatus: [
        { name: 'Active',      value: active },
        { name: 'Idle',        value: idle },
        { name: 'Maintenance', value: maint },
      ],
      longestIdle,
      byType: byType.slice(0, 8),
      byLocation: [...byLocation.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    },
    meta: {
      // What period these numbers describe, so the card can say so rather
      // than implying a live reading when a range is in force.
      asOfDate: localDate(new Date(asOf)),
      // "All time" ends today, so the as-of date IS now and the numbers are
      // the live snapshot — labelling it as a historical as-of reading would
      // imply a distinction that does not exist.
      rangeApplied: win.explicitRange && !win.allTime,
      fromDate: win.explicitRange ? win.fromDate : null,
      toDate: win.explicitRange ? win.toDate : null,
      // Units whose last movement postdates the as-of date and so cannot be
      // described as idle then. Disclosed, not silently dropped.
      excludedByAsOf,
      emptyReason: units.length === 0
        ? 'No equipment units are on record yet. Once the fleet is registered, idle and active counts appear here.'
        : (idle === 0
          ? `Nothing is sitting idle${win.explicitRange ? ` as of ${win.toDate}` : ' right now'} — all ${units.length} unit${units.length === 1 ? ' is' : 's are'} either on hire or in the workshop.`
          : null),
      confidence: confidenceFrom({
        sampleSize: units.length,
        // Idle AGE is read off updated_at; a unit without one reports 0 days
        // idle, which understates the problem rather than overstating it.
        fieldCoverage: coverage(units, u => !!u.status && !!u.updated_at),
        windowDays: 0,
      }),
    },
  };
}

// ── 4.11 Top customers ──────────────────────────────────────────────────

export async function getTopCustomers(params = {}) {
  const { days, fromIso, toIso, fromDate, toDate } = resolveWindow(params, 365);

  // Windowed on the BUSINESS date (`quotation_date` / `issue_date`), not
  // `created_at`. A row's created_at is when it was TYPED INTO THE SYSTEM,
  // not when the quote or invoice actually happened — a backdated entry, a
  // bulk import, or a batch of paperwork keyed in weeks late all cluster
  // their created_at near "now" regardless of the real date on the
  // document. Filtering the window on created_at silently pulled every
  // such row into the CURRENT period and, worse, kept it out of the
  // PREVIOUS period below (whose created_at values are never that old),
  // so every account looked like it had zero prior-period billing —
  // "new this period" across the board. `windowedRows()` is the shared
  // fix for exactly this trap (see revByCategory / monthlyKPIs), falling
  // back to created_at only when the business date itself is null.
  const [customers, quotations, invoices] = await Promise.all([
    safeQuery(supabase.from('customers').select('customer_id, company_name'), 'topCustomers.customers'),
    windowedRows(
      'quotations',
      'quotation_id, customer_id, status, total_amount_kwd, quotation_date, created_at',
      {
        primary: 'quotation_date', primaryFrom: fromDate, primaryTo: toDate,
        fallback: 'created_at', fallbackFrom: fromIso, fallbackTo: toIso,
        tag: 'topCustomers.quotations',
      }
    ),
    windowedRows(
      'invoices',
      'invoice_id, customer_id, status, total_amount_kwd, amount_paid_kwd, issue_date, due_date, created_at',
      {
        primary: 'issue_date', primaryFrom: fromDate, primaryTo: toDate,
        fallback: 'created_at', fallbackFrom: fromIso, fallbackTo: toIso,
        tag: 'topCustomers.invoices',
      }
    ),
  ]);

  const map = new Map();
  const upsert = (id) => {
    if (!id) return null;
    if (!map.has(id)) map.set(id, { customer_id: id, company_name: null, approved_quotes: 0, billed_kwd: 0, paid_kwd: 0, last_quote_at: null, last_invoice_at: null, age_buckets: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }, max_days_late: 0 });
    return map.get(id);
  };

  for (const c of customers) {
    const row = upsert(c.customer_id);
    if (row) row.company_name = c.company_name;
  }
  for (const q of quotations) {
    const row = upsert(q.customer_id);
    if (!row) continue;
    if (q.status === 'Approved') row.approved_quotes += 1;
    // effective_date (quotation_date, falling back to created_at only when
    // unset) — not created_at — so "last activity" reflects when the quote
    // actually happened, not when it was keyed into the system.
    if (!row.last_quote_at || q.effective_date > row.last_quote_at) row.last_quote_at = q.effective_date;
  }
  for (const inv of invoices) {
    const row = upsert(inv.customer_id);
    if (!row) continue;
    if (['Sent', 'Paid', 'Partial'].includes(inv.status)) row.billed_kwd += Number(inv.total_amount_kwd ?? 0);
    if (inv.status === 'Paid' || inv.status === 'Partial') row.paid_kwd += Number(inv.amount_paid_kwd ?? 0);
    if (!row.last_invoice_at || inv.effective_date > row.last_invoice_at) row.last_invoice_at = inv.effective_date;
    if (inv.status === 'Sent' || (inv.status === 'Partial' && Number(inv.amount_paid_kwd ?? 0) < Number(inv.total_amount_kwd ?? 0))) {
      const outstanding = Number(inv.total_amount_kwd ?? 0) - Number(inv.amount_paid_kwd ?? 0);
      if (outstanding > 0) {
        const dueDate = inv.due_date ? new Date(inv.due_date) : null;
        const daysLate = dueDate ? Math.max(0, Math.round((Date.now() - dueDate.getTime()) / DAY_MS)) : 0;
        const bucket = !dueDate || daysLate === 0 ? 'current'
          : daysLate <= 30 ? '1-30'
          : daysLate <= 60 ? '31-60'
          : daysLate <= 90 ? '61-90' : '90+';
        if (row.age_buckets) row.age_buckets[bucket] = (row.age_buckets[bucket] ?? 0) + outstanding;
        if (daysLate > (row.max_days_late ?? 0)) row.max_days_late = daysLate;
      }
    }
  }

  // Same-length baseline, so each account can be told whether it is growing.
  // Only invoices are needed: billing is what the ranking is sorted on.
  // Same issue_date-first windowing as above — this is the query whose
  // created_at-only version made every account read "new this period",
  // since a baseline that can never contain a recently-inserted row will
  // always come back empty.
  const { prevFromIso, prevToIso } = resolvePrevWindow(params, 365);
  const prevInvoices = await windowedRows(
    'invoices',
    'invoice_id, customer_id, status, total_amount_kwd, issue_date, created_at',
    {
      primary: 'issue_date',
      primaryFrom: localDate(new Date(prevFromIso)), primaryTo: localDate(new Date(prevToIso)),
      fallback: 'created_at', fallbackFrom: prevFromIso, fallbackTo: prevToIso,
      tag: 'topCustomers.prevInvoices',
    }
  );
  const prevBilled = new Map();
  for (const inv of prevInvoices) {
    if (!['Sent', 'Paid', 'Partial'].includes(inv.status)) continue;
    prevBilled.set(inv.customer_id, (prevBilled.get(inv.customer_id) ?? 0) + num(inv.total_amount_kwd));
  }

  // Ignore customers with zero activity in the window
  // Screen every quotation in the window for record-level defects. This is
  // pure and never throws (see lib/operationalAnomalies.js), so it cannot
  // affect the customer ranking below even on wholly malformed input.
  const quoteScreen = screenQuotations(quotations);

  const rows = [...map.values()]
    .filter(r => r.approved_quotes || r.billed_kwd)
    .map(r => ({
      ...r,
      prevBilled: prevBilled.get(r.customer_id) ?? 0,
      trendPct: deltaPct(r.billed_kwd, prevBilled.get(r.customer_id) ?? 0),
      collectedPct: r.billed_kwd > 0 ? Math.round(r.paid_kwd * 100 / r.billed_kwd) : null,
      payment_score: r.billed_kwd > 0 ? Math.round(r.paid_kwd * 100 / r.billed_kwd) : null,
      days_since_activity: (() => {
        const last = Math.max(
          r.last_quote_at ? new Date(r.last_quote_at).getTime() : 0,
          r.last_invoice_at ? new Date(r.last_invoice_at).getTime() : 0,
        );
        return last > 0 ? Math.round((Date.now() - last) / DAY_MS) : null;
      })(),
      is_churned: (() => {
        const last = Math.max(
          r.last_quote_at ? new Date(r.last_quote_at).getTime() : 0,
          r.last_invoice_at ? new Date(r.last_invoice_at).getTime() : 0,
        );
        return last > 0 && last < (Date.now() - 60 * DAY_MS);
      })(),
    }))
    .sort((a, b) => b.billed_kwd - a.billed_kwd);

  const totalBilled = rows.reduce((s, r) => s + r.billed_kwd, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid_kwd, 0);
  const top5Billed = rows.slice(0, 5).reduce((s, r) => s + r.billed_kwd, 0);
  const prevTotalBilled = [...prevBilled.values()].reduce((s, v) => s + v, 0);

  // Sales pipeline funnel — same quotations/invoices already in memory.
  // Four stages: Quotes Raised → Approved → Invoiced → Fully Collected.
  const sfStages = [
    { key: 'quotes',    label: 'Quotes',    value: quotations.length },
    { key: 'approved',  label: 'Approved',  value: quotations.filter(q => q.status === 'Approved').length },
    { key: 'invoiced',  label: 'Invoiced',  value: invoices.filter(i => ['Sent', 'Paid', 'Partial'].includes(i.status)).length },
    { key: 'collected', label: 'Collected', value: invoices.filter(i => i.status === 'Paid').length },
  ];
  const sfTop = sfStages[0].value || 1;
  const salesFunnel = sfStages.map((s, i) => ({
    ...s,
    convPct: i === 0 ? 100 : Math.round(s.value * 100 / sfTop),
    dropPct: i === 0 ? 0 : (
      sfStages[i - 1].value > 0
        ? Math.round((1 - s.value / sfStages[i - 1].value) * 100)
        : 0
    ),
  }));

  const oneTime = rows.filter(r => r.approved_quotes === 1).length;

  const sixtyDays = Date.now() - 60 * 86_400_000;
  const lastActivityOf = (r) => Math.max(
    r.last_quote_at ? new Date(r.last_quote_at).getTime() : 0,
    r.last_invoice_at ? new Date(r.last_invoice_at).getTime() : 0,
  );
  const atRisk = rows.slice(0, 10).filter(r => r.billed_kwd > 0 && lastActivityOf(r) < sixtyDays);

  const withOutstanding = rows
    .map(r => ({ ...r, outstanding: Math.max(0, r.billed_kwd - r.paid_kwd) }))
    .filter(r => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
  const totalOutstanding = withOutstanding.reduce((s, r) => s + r.outstanding, 0);

  // Accounts that grew or shrank materially against the baseline. Both lists
  // are needed: a book can be flat in total while churning underneath.
  const scored = rows.filter(r => r.trendPct !== null && r.billed_kwd > 0);
  const growing = [...scored].filter(r => r.trendPct >= 25).sort((a, b) => b.trendPct - a.trendPct);
  const shrinking = [...scored].filter(r => r.trendPct <= -25).sort((a, b) => a.trendPct - b.trendPct);

  return {
    kpis: {
      topCustomer: rows[0]?.company_name ?? null,
      topBilled: rows[0]?.billed_kwd ?? 0,
      top5SharePct: totalBilled ? Math.round(top5Billed * 100 / totalBilled) : 0,
      oneTimeCount: oneTime,
      avgRevenuePerCustomer: rows.length ? totalBilled / rows.length : 0,
      totalBilled,
      // Additive.
      activeCustomers: rows.length,
      totalPaid,
      totalOutstanding,
      collectionRatePct: totalBilled ? Math.round(totalPaid * 100 / totalBilled) : 0,
      prevTotalBilled,
      billedDeltaPct: deltaPct(totalBilled, prevTotalBilled),
      topTrendPct: rows[0]?.trendPct ?? null,
      atRiskCount: atRisk.length,
      growingCount: growing.length,
      shrinkingCount: shrinking.length,
      fastestGrowingName: growing[0]?.company_name ?? null,
      fastestGrowingPct: growing[0]?.trendPct ?? null,
      largestDeclineName: shrinking[0]?.company_name ?? null,
      largestDeclinePct: shrinking[0]?.trendPct ?? null,
      worstDebtorName: withOutstanding[0]?.company_name ?? null,
      worstDebtorOutstanding: withOutstanding[0]?.outstanding ?? 0,
      churnedCount: rows.filter(r => r.is_churned).length,

      // ── Data quality ────────────────────────────────────────────────
      //
      // Every quotation already fetched for this window is run through the
      // shared record screener, so the Priority Signals ribbon can report
      // bad rows without a query of its own.
      //
      // Two counts are kept because they answer different questions.
      // `zeroValueQuoteCount` is the ACTIVE count — it excludes Cancelled
      // and Rejected quotes, which is what a manager wants when asking
      // "what is wrong in my live pipeline". `zeroValueTotalCount` is every
      // zero-value quote in the window regardless of status, which is what
      // a data-quality audit wants. Reporting only the first made the
      // ribbon disagree with any raw count of the table, so both are
      // exposed and the rule prints the one it means.
      zeroValueQuoteCount: quotations.filter(q =>
        !['Cancelled', 'Rejected'].includes(q.status) &&
        Number(q.total_amount_kwd ?? 0) === 0
      ).length,
      zeroValueApprovedCount: quotations.filter(q =>
        q.status === 'Approved' &&
        Number(q.total_amount_kwd ?? 0) === 0
      ).length,
      zeroValueTotalCount: quoteScreen.stats.zeroValue,
      negativeValueCount: quoteScreen.stats.negative,
      missingValueCount: quoteScreen.stats.missingValue,
      malformedDateCount: quoteScreen.stats.malformedDate,
      duplicateQuoteCount: quoteScreen.stats.duplicate,
      oversizedQuoteCount: quoteScreen.stats.oversized,
      quotesScreened: quoteScreen.stats.total,
      quotesExcluded: quoteScreen.stats.total - quoteScreen.stats.usable,
    },
    series: {
      // Revenue concentration curve: cumulative share against account rank.
      // A steep head is the concentration risk the template warns about, and
      // the shape communicates it faster than the single top-5 percentage.
      // Runs on the RAW (unrounded) cumulative sum and rounds only once per
      // point — accumulating already-rounded values drifts off the true
      // share with every step and can disagree with `top5SharePct`, which is
      // rounded directly from the same totalBilled denominator.
      concentration: (() => {
        let runningRaw = 0;
        return rows.slice(0, 10).map((r, i) => {
          const ownRaw = totalBilled ? (r.billed_kwd * 100 / totalBilled) : 0;
          runningRaw += ownRaw;
          return {
            rank: `#${i + 1}`,
            name: r.company_name ?? '—',
            billed: Math.round(r.billed_kwd),
            // This account's own share — distinct from cumulativePct, which
            // is everything from #1 through this rank combined. The chart
            // tooltip must show both or "95% cumulative" reads as this one
            // account's share, not the whole book up to it.
            sharePct: Math.round(ownRaw),
            cumulativePct: Math.min(100, Math.round(runningRaw)),
          };
        });
      })(),
    },
    breakdowns: {
      // The individual offending rows, ranked critical-first, so a drill-in
      // can name the quote rather than only count it. Capped: the ribbon
      // shows a headline, not a register.
      dataQualityFlags: rankFlags(quoteScreen.flags).slice(0, 25),
      top20: rows.slice(0, 20).map(r => ({
        ...r,
        outstanding: Math.max(0, r.billed_kwd - r.paid_kwd),
      })),
      atRisk,
      growing: growing.slice(0, 5),
      shrinking: shrinking.slice(0, 5),
      outstanding: withOutstanding.slice(0, 5),
      salesFunnel,
    },
    meta: {
      windowDays: days,
      comparedTo: prevInvoices.length > 0 ? `previous ${days} days` : null,
      confidence: confidenceFrom({
        sampleSize: rows.length,
        // A customer row with no company name renders as "—" everywhere and
        // is exactly the sort of gap this figure exists to surface.
        fieldCoverage: coverage(rows, r => !!r.company_name),
        windowDays: days,
      }),
    },
  };
}

// ── 4.12 Maintenance cost trends ────────────────────────────────────────

export async function getMaintenanceCostTrends(params = {}) {
  const { days, fromDate, toDate } = resolveWindow(params, 365);

  // The equipment join is what makes "which unit is driving the cost?"
  // answerable by NAME from this section rather than only from §4.4.
  const jobs = await safeQuery(
    supabase
      .from('maintenance')
      .select('maintenance_id, equipment_id, service_date, start_date, completion_date, status, issue_type, cost_kwd, equipment_units(equipment_id, serial_number, capacity, location, equipment_types(type_id, name, category))')
      .gte('service_date', fromDate)
      .lte('service_date', toDate),
    'maintCost.jobs'
  );

  const byMonth = new Map();
  const byIssueType = new Map();
  const perUnit = new Map();
  const perType = new Map();
  let ytd = 0, mtd = 0, totalJobs = 0, totalCost = 0;

  const now = new Date();
  const currentMonthKey = now.toISOString().slice(0, 7);
  const currentYear = now.getFullYear();

  // Only completed jobs carry a settled cost, which is why the whole
  // aggregation below skips everything else — an open job's cost_kwd is an
  // estimate at best and would inflate the trend it is being read from.
  const completed = jobs.filter(j => j.status === 'Completed');

  for (const j of completed) {
    totalJobs += 1;
    const cost = Number(j.cost_kwd ?? 0);
    totalCost += cost;

    const u = j.equipment_units;
    const uid = j.equipment_id;
    if (uid) {
      if (!perUnit.has(uid)) {
        perUnit.set(uid, {
          equipment_id: uid,
          label: unitLabel({
            equipment_id: uid,
            type_name: u?.equipment_types?.name,
            capacity: u?.capacity,
            serial_number: u?.serial_number ?? null,
          }),
          type_name: u?.equipment_types?.name ?? 'Unknown',
          serial_number: u?.serial_number ?? null,
          location: u?.location ?? null,
          cost: 0, jobs: 0, topIssue: null,
          issues: new Map(),
          downtime_days: 0,
          last_service_date: null,
        });
      }
      const row = perUnit.get(uid);
      row.cost += cost;
      row.jobs += 1;
      const key = j.issue_type || 'Other';
      row.issues.set(key, (row.issues.get(key) ?? 0) + 1);
      const span = daysBetween(j.start_date || j.service_date, j.completion_date);
      if (Number.isFinite(span) && span > 0) row.downtime_days += span;
      if (j.service_date && (!row.last_service_date || j.service_date > row.last_service_date)) {
        row.last_service_date = j.service_date;
      }
    }
    const tname = u?.equipment_types?.name;
    if (tname) {
      if (!perType.has(tname)) perType.set(tname, { name: tname, cost: 0, jobs: 0 });
      const t = perType.get(tname);
      t.cost += cost;
      t.jobs += 1;
    }

    const date = j.completion_date || j.service_date;
    if (!date) continue;
    const m = date.slice(0, 7);
    const y = Number(date.slice(0, 4));

    const itKey = j.issue_type || 'Other';
    if (!byMonth.has(m)) byMonth.set(m, { month: m, total: 0, jobs: 0 });
    byMonth.get(m).total += cost;
    byMonth.get(m).jobs += 1;
    byMonth.get(m)[itKey] = (byMonth.get(m)[itKey] ?? 0) + cost;

    if (!byIssueType.has(itKey)) byIssueType.set(itKey, { name: itKey, cost: 0, jobs: 0 });
    byIssueType.get(itKey).cost += cost;
    byIssueType.get(itKey).jobs += 1;

    if (m === currentMonthKey) mtd += cost;
    if (y === currentYear) ytd += cost;
  }

  const series = [...byMonth.values()]
    .map(r => ({ ...r, avgCost: r.jobs ? Math.round(r.total / r.jobs) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const topIssue = [...byIssueType.values()].sort((a, b) => b.cost - a.cost)[0];

  // A 3-month trailing mean alongside the monthly bars: a single spike month
  // reads very differently once the run rate is drawn next to it, and this is
  // the comparison the "is spend rising?" question actually needs.
  const withTrailing = series.map((r, i) => {
    const slice = series.slice(Math.max(0, i - 2), i + 1);
    return {
      ...r,
      trailing3: Math.round(slice.reduce((s, x) => s + x.total, 0) / slice.length),
    };
  });

  // month-over-month delta on total cost
  let momDeltaPct = null;
  if (series.length >= 2) {
    const last = series[series.length - 1].total;
    const prev = series[series.length - 2].total;
    if (prev > 0) momDeltaPct = Math.round(((last - prev) / prev) * 100);
  }

  // Half-over-half on the window, which is steadier than MoM on a series
  // this sparse — one big repair can swing a single month by 300%.
  const half = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, half).reduce((s, r) => s + r.total, 0);
  const secondHalf = series.slice(half).reduce((s, r) => s + r.total, 0);
  const halfDeltaPct = series.length >= 4 ? deltaPct(secondHalf, firstHalf) : null;

  const byUnit = [...perUnit.values()]
    .map(u => {
      const top = [...u.issues.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        equipment_id: u.equipment_id,
        label: u.label,
        type_name: u.type_name,
        serial_number: u.serial_number,
        location: u.location,
        cost: Math.round(u.cost * 100) / 100,
        jobs: u.jobs,
        avgCost: u.jobs ? u.cost / u.jobs : 0,
        topIssue: top?.[0] ?? null,
        sharePct: totalCost ? Math.round(u.cost * 100 / totalCost) : 0,
        downtime_days: Math.round(u.downtime_days),
        last_service_date: u.last_service_date,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const top5UnitCost = byUnit.slice(0, 5).reduce((s, u) => s + u.cost, 0);

  // Work-order funnel: how jobs flow through the maintenance workflow.
  const woStages = [
    { key: 'logged',      label: 'Logged',      value: jobs.length },
    { key: 'in_progress', label: 'In Progress',  value: jobs.filter(j => j.status === 'In Progress').length },
    { key: 'completed',   label: 'Completed',   value: completed.length },
  ];
  const woTop = woStages[0].value || 1;
  const workOrderFunnel = woStages.map((s, i) => ({
    ...s,
    convPct: i === 0 ? 100 : Math.round(s.value * 100 / woTop),
    dropPct: i === 0 ? 0 : (
      woStages[i - 1].value > 0
        ? Math.round((1 - s.value / woStages[i - 1].value) * 100)
        : 0
    ),
  }));

  return {
    kpis: {
      totalJobs,
      totalCost,
      ytdCost: ytd,
      mtdCost: mtd,
      avgCostPerJob: totalJobs ? totalCost / totalJobs : 0,
      topIssueType: topIssue?.name ?? null,
      topIssueCost: topIssue?.cost ?? 0,
      momDeltaPct,
      // Additive.
      halfDeltaPct,
      monthlyRunRate: series.length ? totalCost / series.length : 0,
      peakMonth: [...series].sort((a, b) => b.total - a.total)[0]?.month ?? null,
      peakMonthCost: [...series].sort((a, b) => b.total - a.total)[0]?.total ?? 0,
      topUnitLabel: byUnit[0]?.label ?? null,
      topUnitId: byUnit[0]?.equipment_id ?? null,
      topUnitCost: byUnit[0]?.cost ?? 0,
      topUnitSharePct: byUnit[0]?.sharePct ?? 0,
      top5UnitSharePct: totalCost ? Math.round(top5UnitCost * 100 / totalCost) : 0,
      unitsWithCost: byUnit.length,
      topTypeName: [...perType.values()].sort((a, b) => b.cost - a.cost)[0]?.name ?? null,
      topTypeCost: [...perType.values()].sort((a, b) => b.cost - a.cost)[0]?.cost ?? 0,
      openJobCount: jobs.length - completed.length,
    },
    series: { byMonth: withTrailing },
    breakdowns: {
      byIssueType: [...byIssueType.values()].sort((a, b) => b.cost - a.cost),
      byUnit: byUnit.slice(0, 10),
      byType: [...perType.values()]
        .map(t => ({ ...t, avgCost: t.jobs ? t.cost / t.jobs : 0 }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 8),
      workOrderFunnel,
    },
    meta: {
      windowDays: days,
      confidence: confidenceFrom({
        sampleSize: completed.length,
        // A completed job with no cost recorded silently drags every average
        // in this section down, so coverage is measured on exactly that.
        fieldCoverage: coverage(completed, j => num(j.cost_kwd) > 0),
        windowDays: days,
      }),
    },
  };
}

// ── 4.12a Equipment-level maintenance records (drill-down) ───────────────
// Called only when the user clicks into a specific unit from MaintDrillPanel.
// Filters to Completed jobs so cost figures match the parent trend exactly.

export async function getEquipmentMaintenanceRecords(params = {}, equipmentId = null) {
  const { fromDate, toDate } = resolveWindow(params, 365);
  let builder = supabase
    .from('maintenance')
    .select('maintenance_id, equipment_id, service_date, start_date, completion_date, status, issue_type, cost_kwd, notes, equipment_units(serial_number, capacity, location, equipment_types(name))')
    .gte('service_date', fromDate)
    .lte('service_date', toDate);
  if (equipmentId) builder = builder.eq('equipment_id', equipmentId);
  const rows = await safeQuery(builder, 'maintDrill');
  return rows
    .filter(r => r.status === 'Completed')
    .map(r => {
      const downtime = Math.round(Math.max(0, daysBetween(r.start_date || r.service_date, r.completion_date) ?? 0));
      return {
        maintenance_id:  r.maintenance_id,
        equipment_id:    r.equipment_id,
        service_date:    r.service_date,
        completion_date: r.completion_date,
        issue_type:      r.issue_type || 'Other',
        cost_kwd:        Number(r.cost_kwd ?? 0),
        downtime_days:   downtime,
        notes:           r.notes ?? null,
        unit_label:      unitLabel({ equipment_id: r.equipment_id, type_name: r.equipment_units?.equipment_types?.name, capacity: r.equipment_units?.capacity, serial_number: r.equipment_units?.serial_number ?? null }),
        serial_number:   r.equipment_units?.serial_number ?? null,
        location:        r.equipment_units?.location ?? null,
        type_name:       r.equipment_units?.equipment_types?.name ?? null,
      };
    })
    .sort((a, b) => b.cost_kwd - a.cost_kwd);
}

// ── Drill-down: on-demand per-entity detail ─────────────────────────────
//
// These mirror `getEquipmentMaintenanceRecords` above: called ONLY when a
// user clicks into one row of an already-rendered chart/ranking, never as
// part of a section's own load. Each accepts the section's own date-range
// params (so the drill-down respects whatever period the card is showing)
// plus the one identifier that was clicked. Never invoked from `useAnalytics`
// — the caller wires them through its own `useQuery`, so a slow or failing
// drill-down can never touch the section's own loading/error state or the
// SectionCard mascot loader.

// One equipment unit's individual rental events — the record-level view
// behind "Most rented equipment"'s per-unit ranking and any other
// fleet/rental chart.
//
// This MUST reproduce `getMostRentedEquipment`'s source resolution exactly,
// or the drill-down contradicts the ranking that opened it. That fetcher
// counts a rental from THREE places, in this order:
//   1. a dispatch header linked straight to the unit,
//   2. a `dispatch_items` line on a multi-item dispatch (whose header's own
//      equipment link is null),
//   3. FALLBACK — `quotation_items`, used when the window holds no dispatch
//      activity at all, because some deployments record rentals only on the
//      contract side.
// Reading just (1) and (2) is what made a unit that plainly ranked in "Top
// rented units" report "No rental activity recorded": its rentals were all
// quotation lines, so the ranking saw them and the drill-down did not.
//
// The fallback is applied PER UNIT here rather than globally as the ranking
// does. That is strictly safer: a unit only reaches this function because it
// is in the ranking, so if it has no dispatch rows its rentals must have come
// from the quotation path — and when the ranking did use dispatches, this
// unit has dispatch rows and the fallback never runs.
//
// Every window filter is applied by the DATABASE, on the same column and with
// the same bounds the ranking query uses, so neither a DATE-vs-timestamp
// string comparison nor a differently-derived window can drift between them.
export async function getEquipmentRentalRecords(params = {}, equipmentId = null) {
  if (!equipmentId) return [];
  // Fallback of 30 days matches `getMostRentedEquipment`'s, so an unspecified
  // window resolves to the identical span in both.
  const { fromIso, toIso } = resolveWindow(params, 30);

  // `dispatches` has NO `customer_id` column — verified directly against the
  // database (`column dispatches.customer_id does not exist`), not assumed.
  // Selecting one made every query below a Postgres syntax error, which
  // `safeQuery` converts to `[]` — so EVERY dispatch-sourced rental fell
  // through to the quotation-fallback block regardless of whether real
  // dispatch rows existed. For a unit whose rental had no matching
  // quotation inside the window (or no quotation at all), that produced
  // exactly the reported symptom: ranked with real activity, drilled down to
  // "No rental activity recorded".
  //
  // A dispatch's only path to a customer is through the quotation it was
  // raised from (`dispatches.quotation_id`), fetched in a second pass below
  // once the actual dispatch rows are known — reaching it costs one extra
  // batched query instead of a broken inline embed.
  //
  // Two disjoint queries rather than embedding `dispatches` through
  // `dispatch_items` — same reason `getMostRentedEquipment` above joins them
  // client-side instead of relying on a nested PostgREST embed through a
  // line-item table: a multi-item dispatch's header still carries the
  // destination this needs, and fetching-then-mapping avoids depending on an
  // embed PostgREST may not resolve the same way for every relation shape.
  const dispatchSelect = 'dispatch_id, quotation_id, dispatch_date, return_date, status, destination, equipment_id';
  const dispatches = await safeQuery(
    supabase
      .from('dispatches')
      .select(dispatchSelect)
      .eq('equipment_id', equipmentId)
      .gte('dispatch_date', fromIso)
      .lte('dispatch_date', toIso),
    'equipRentalRecords.dispatches'
  );

  const items = await safeQuery(
    supabase
      .from('dispatch_items')
      .select('item_id, dispatch_id, equipment_id')
      .eq('equipment_id', equipmentId),
    'equipRentalRecords.items'
  );

  // A dispatch that HAS line items is represented by those items, and the
  // ranking skips its header outright (`if (itemised.has(...)) continue`) —
  // because the header either duplicates an item or points at equipment the
  // items contradict. Reading headers by `equipment_id` alone would surface
  // a rental the ranking never counted, so the same exclusion is applied
  // here. Asked for ALL items on those dispatches, not just this unit's,
  // since "does this dispatch have items at all" is the actual question.
  const headerIds = dispatches.map(d => d?.dispatch_id).filter(Boolean);
  const itemsOnHeaders = headerIds.length
    ? await safeQuery(
      supabase.from('dispatch_items').select('dispatch_id').in('dispatch_id', headerIds),
      'equipRentalRecords.headerItems'
    )
    : [];
  const itemised = new Set(itemsOnHeaders.map(it => it?.dispatch_id).filter(v => v != null));
  const headerRows = dispatches.filter(d => !itemised.has(d?.dispatch_id));

  const itemDispatchIds = [...new Set(items.map(it => it?.dispatch_id).filter(Boolean))];
  // Windowed in the QUERY, not by comparing date strings afterwards: a DATE
  // column ("2026-07-21") compared against an ISO instant
  // ("2026-07-21T09:00:00Z") sorts as the shorter prefix and silently drops
  // rows that sit exactly on the lower edge.
  const itemDispatches = itemDispatchIds.length
    ? await safeQuery(
      supabase
        .from('dispatches')
        .select(dispatchSelect)
        .in('dispatch_id', itemDispatchIds)
        .gte('dispatch_date', fromIso)
        .lte('dispatch_date', toIso),
      'equipRentalRecords.itemDispatches'
    )
    : [];

  const seen = new Set(headerRows.map(d => d?.dispatch_id).filter(Boolean));
  const fromItems = [];
  for (const parent of itemDispatches) {
    if (!parent?.dispatch_id || seen.has(parent.dispatch_id)) continue;
    seen.add(parent.dispatch_id);
    fromItems.push(parent);
  }

  const dispatchRows = [...headerRows, ...fromItems];

  // The customer behind each dispatch, via its `quotation_id` — the only
  // link this schema actually has. Batched once for every row rather than
  // per-row, and built defensively: an ad-hoc dispatch with no quotation_id
  // simply has no customer name to show, not an error.
  const quotationIds = [...new Set(dispatchRows.map(d => d?.quotation_id).filter(Boolean))];
  const dispatchQuotes = quotationIds.length
    ? await safeQuery(
      supabase
        .from('quotations')
        .select('quotation_id, customer_id, customers(company_name)')
        .in('quotation_id', quotationIds),
      'equipRentalRecords.dispatchQuotes'
    )
    : [];
  const customerByQuotationId = new Map(
    dispatchQuotes.map(q => [q.quotation_id, q.customers?.company_name ?? null])
  );

  const rows = dispatchRows.map(d => {
    const daysOut = d.return_date
      ? daysBetween(d.dispatch_date, d.return_date)
      : (d.dispatch_date ? daysBetween(d.dispatch_date, new Date().toISOString()) : null);
    return {
      key: `D${d.dispatch_id}`,
      source: 'dispatch',
      dispatch_id: d.dispatch_id,
      dispatch_date: d.dispatch_date ?? null,
      return_date: d.return_date ?? null,
      status: d.status ?? null,
      destination: clean(d.destination) || null,
      customer_name: customerByQuotationId.get(d.quotation_id) ?? null,
      quantity: null,
      days_out: daysOut == null ? null : Math.max(0, Math.round(daysOut)),
    };
  });

  if (rows.length === 0) {
    // The quotation path the ranking itself falls back to. `created_at` is
    // the column it windows quotations on, so this uses the same one.
    const qItems = await safeQuery(
      supabase
        .from('quotation_items')
        .select('item_id, quotation_id, equipment_id, quantity, rental_start_date, rental_end_date')
        .eq('equipment_id', equipmentId),
      'equipRentalRecords.quotationItems'
    );
    const quoteIds = [...new Set(qItems.map(q => q?.quotation_id).filter(Boolean))];
    const quotes = quoteIds.length
      ? await safeQuery(
        supabase
          .from('quotations')
          .select('quotation_id, created_at, status, customer_id, customers(company_name)')
          .in('quotation_id', quoteIds)
          .gte('created_at', fromIso)
          .lte('created_at', toIso),
        'equipRentalRecords.quotations'
      )
      : [];
    const quoteById = new Map(quotes.map(q => [q.quotation_id, q]));
    for (const qi of qItems) {
      const parent = quoteById.get(qi?.quotation_id);
      if (!parent) continue; // outside the window, or no such quotation
      const span = daysBetween(qi.rental_start_date, qi.rental_end_date);
      rows.push({
        key: `Q${qi.item_id ?? qi.quotation_id}`,
        source: 'quotation',
        // Matches the synthetic id the ranking gives a quotation-sourced
        // rental, so the two are traceable to the same record.
        dispatch_id: `Q${qi.quotation_id}`,
        dispatch_date: qi.rental_start_date ?? parent.created_at ?? null,
        return_date: qi.rental_end_date ?? null,
        status: parent.status ?? null,
        destination: null,
        customer_name: parent.customers?.company_name ?? null,
        quantity: Number(qi.quantity) > 0 ? Number(qi.quantity) : null,
        days_out: span == null ? null : Math.max(0, Math.round(span)),
      });
    }
  }

  return rows.sort((a, b) => String(b.dispatch_date ?? '').localeCompare(String(a.dispatch_date ?? '')));
}

// One equipment line's individual procurement line items — the record-level
// view behind "Most procured equipment"'s per-equipment ranking. Keyed the
// same way that ranking is: `typeId` when the line resolved to a real
// equipment_type_id, else a free-text `description` match, exactly mirroring
// the fallback key `foldItems` uses to group lines with no type link.
export async function getEquipmentProcurementRecords(params = {}, typeId = null, description = null) {
  if (!typeId && !description) return [];
  const { fromIso, toIso } = resolveWindow(params, 90);

  // `select('*')` rather than a column list, same reason as
  // `getMostProcuredEquipment`: quantity's real column name varies by
  // deployment, and naming one Postgres doesn't have turns the whole query
  // into an error. Procurements are fetched separately (one flat embed to
  // `vendors`, the same proven shape `getMostProcuredEquipment` already
  // relies on) rather than embedding two levels deep through
  // `procurement_items` — a nested embed PostgREST may not resolve the same
  // way for every relation shape.
  let builder = supabase.from('procurement_items').select('*');
  if (typeId) builder = builder.eq('equipment_type_id', typeId);
  const rows = await safeQuery(builder, 'equipProcRecords.items');

  const wantDesc = String(description ?? '').trim().toLowerCase();
  const matched = typeId
    ? rows
    : rows.filter(it => String(it.description ?? '').trim().toLowerCase() === wantDesc);

  const procIds = [...new Set(matched.map(it => it.procurement_id).filter(Boolean))];
  const procs = procIds.length
    ? await safeQuery(
      supabase
        .from('procurements')
        .select('procurement_id, status, type, created_at, vendors(name)')
        .in('procurement_id', procIds),
      'equipProcRecords.procurements'
    )
    : [];
  const procById = new Map(procs.map(p => [p.procurement_id, p]));

  return matched
    .map(it => {
      const p = procById.get(it.procurement_id);
      const qty = itemQty(it);
      return {
        procurement_id: it.procurement_id,
        date: p?.created_at ?? null,
        status: p?.status ?? null,
        type: p?.type ?? null,
        vendor: p?.vendors?.name ?? null,
        quantity: qty,
        unitPriceKwd: num(it.unit_price_kwd),
        lineTotalKwd: num(it.unit_price_kwd) * qty,
        description: clean(it.description) || null,
      };
    })
    .filter(r => !r.date || (r.date >= fromIso && r.date <= toIso))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// One supplier's individual procurements — the record-level view behind the
// "Most procured equipment" section's supplier contribution list.
export async function getSupplierTransactions(params = {}, vendorId = null, vendorName = null) {
  if (!vendorId && !vendorName) return [];
  const { fromIso, toIso } = resolveWindow(params, 90);

  let builder = supabase
    .from('procurements')
    .select('procurement_id, type, status, total_amount_kwd, created_at, vendor_id, vendors(vendor_id, name)')
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (vendorId) builder = builder.eq('vendor_id', vendorId);
  const rows = await safeQuery(builder, 'supplierTransactions.procurements');
  const filtered = vendorId ? rows : rows.filter(r => (r.vendors?.name ?? '') === vendorName);

  const ids = filtered.map(r => r.procurement_id).filter(Boolean);
  const items = ids.length
    ? await safeQuery(
      supabase.from('procurement_items').select('procurement_id, equipment_types(name)').in('procurement_id', ids),
      'supplierTransactions.items'
    )
    : [];
  const equipByProc = new Map();
  for (const it of items) {
    const name = it?.equipment_types?.name;
    if (!name) continue;
    if (!equipByProc.has(it.procurement_id)) equipByProc.set(it.procurement_id, new Set());
    equipByProc.get(it.procurement_id).add(name);
  }

  return filtered
    .map(r => ({
      procurement_id: r.procurement_id,
      date: r.created_at ?? null,
      type: r.type ?? null,
      status: r.status ?? null,
      totalKwd: num(r.total_amount_kwd),
      equipment: [...(equipByProc.get(r.procurement_id) ?? [])].sort(),
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// One customer's billing and rental-contract history — quotations (the
// rental/lease contract side) and invoices (the billing side), both filtered
// to the same customer and period. This is genuinely new data no chart on
// the page already carries client-side, unlike the equipment drill-downs
// above which mostly re-slice an already-fetched ranking.
export async function getCustomerBillingDetails(params = {}, customerId = null) {
  if (!customerId) return { invoices: [], quotations: [] };
  const { fromIso, toIso, fromDate, toDate } = resolveWindow(params, 365);

  const invoices = await windowedRows(
    'invoices',
    'invoice_id, quotation_id, status, total_amount_kwd, amount_paid_kwd, issue_date, due_date, created_at',
    {
      primary: 'issue_date', primaryFrom: fromDate, primaryTo: toDate,
      fallback: 'created_at', fallbackFrom: fromIso, fallbackTo: toIso,
      tag: 'customerBilling.invoices',
      tune: (q) => q.eq('customer_id', customerId),
    }
  );
  const quotations = await windowedRows(
    'quotations',
    'quotation_id, status, quotation_date, created_at, total_amount_kwd',
    {
      primary: 'quotation_date', primaryFrom: fromDate, primaryTo: toDate,
      fallback: 'created_at', fallbackFrom: fromIso, fallbackTo: toIso,
      tag: 'customerBilling.quotations',
      tune: (q) => q.eq('customer_id', customerId),
    }
  );

  return {
    invoices: invoices
      .map(r => ({
        invoice_id: r.invoice_id,
        status: r.status ?? null,
        totalKwd: num(r.total_amount_kwd),
        paidKwd: num(r.amount_paid_kwd),
        outstandingKwd: Math.max(0, num(r.total_amount_kwd) - num(r.amount_paid_kwd)),
        issueDate: r.issue_date ?? null,
        dueDate: r.due_date ?? null,
        date: r.effective_date,
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    quotations: quotations
      .map(r => ({
        quotation_id: r.quotation_id,
        status: r.status ?? null,
        totalKwd: num(r.total_amount_kwd),
        date: r.effective_date,
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
  };
}

// All units of one equipment TYPE, with their live status — the record-level
// view behind Fleet Utilisation's per-line percentage. Live snapshot, same
// as the section it drills from: no date window, `status` is current-state.
export async function getEquipmentUnitsByType(typeId) {
  if (!typeId) return [];
  const rows = await safeQuery(
    supabase
      .from('equipment_units')
      .select('equipment_id, serial_number, capacity, location, status, updated_at, equipment_types(type_id, name, category)')
      .eq('type_id', typeId),
    'equipUnitsByType'
  );
  return rows
    .map(u => ({
      equipment_id: u.equipment_id,
      label: unitLabel({
        equipment_id: u.equipment_id,
        type_name: u.equipment_types?.name,
        capacity: u.capacity,
        serial_number: u.serial_number ?? null,
      }),
      serial_number: u.serial_number ?? null,
      location: u.location ?? null,
      status: clean(u.status) || 'Unknown',
      updated_at: u.updated_at ?? null,
    }))
    .sort((a, b) => a.status.localeCompare(b.status) || a.label.localeCompare(b.label));
}

// ── 4.13 Monthly operational KPIs ───────────────────────────────────────

export async function getMonthlyKPIs(params = {}) {
  // "This month" = calendar month to date. "Prev month" = the full previous
  // calendar month. Both windows are computed once here so every child
  // query hits the same boundary.
  //
  // When the page's date filter supplies an explicit range, THAT becomes the
  // reporting period and the baseline becomes the equal-length span before it.
  // The scorecard is the one place where the comparison is the whole point, so
  // it has to move with the filter rather than stay pinned to a calendar month
  // the user did not ask about.
  const now = new Date();
  const explicit = resolveWindow(params, 0);
  const useRange = explicit.explicitRange;
  const prevRange = useRange ? resolvePrevWindow(params, 0) : null;

  const startThis = useRange
    ? explicit.fromIso
    : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const endThis = useRange ? explicit.toIso : null;
  const startPrev = useRange
    ? prevRange.prevFromIso
    : new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endPrev = useRange ? prevRange.prevToIso : startThis;

  // Upper bounds are only applied when a range was chosen; without one every
  // "this period" query stays open-ended exactly as it was.
  const capIso = (q, col) => (endThis ? q.lte(col, endThis) : q);
  const capDate = (q, col) => (endThis ? q.lte(col, endThis.slice(0, 10)) : q);

  // Six calendar months back from the start of the current one — the trend
  // context behind the single MoM arrow on each tile. One extra query per
  // domain, all issued in the same Promise.all as everything else.
  const startTrend = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [
    invoicesThis, invoicesPrev,
    dispatchesThis, dispatchesPrev,
    maintThis, maintPrev,
    procsThis, procsPrev,
    customersThis, customersPrev,
    unitsRow,
    overdue,
    invoicesTrend, dispatchesTrend, maintTrend,
    requirementsThis, quotationsThis,
  ] = await Promise.all([
    safeQuery(capDate(supabase.from('invoices').select('total_amount_kwd, amount_paid_kwd, issue_date, status').gte('issue_date', startThis.slice(0,10)), 'issue_date'), 'kpi.invThis'),
    safeQuery(supabase.from('invoices').select('total_amount_kwd, amount_paid_kwd, issue_date, status').gte('issue_date', startPrev.slice(0,10)).lt('issue_date', endPrev.slice(0,10)), 'kpi.invPrev'),
    safeQuery(capIso(supabase.from('dispatches').select('dispatch_id, dispatch_date, return_date').gte('dispatch_date', startThis), 'dispatch_date'), 'kpi.dispThis'),
    safeQuery(supabase.from('dispatches').select('dispatch_id, dispatch_date, return_date').gte('dispatch_date', startPrev).lt('dispatch_date', endPrev), 'kpi.dispPrev'),
    safeQuery(capDate(supabase.from('maintenance').select('maintenance_id, service_date, cost_kwd, status').gte('service_date', startThis.slice(0,10)), 'service_date'), 'kpi.maintThis'),
    safeQuery(supabase.from('maintenance').select('maintenance_id, service_date, cost_kwd, status').gte('service_date', startPrev.slice(0,10)).lt('service_date', endPrev.slice(0,10)), 'kpi.maintPrev'),
    safeQuery(capIso(supabase.from('procurements').select('procurement_id, total_amount_kwd, status, created_at').gte('created_at', startThis), 'created_at'), 'kpi.procThis'),
    safeQuery(supabase.from('procurements').select('procurement_id, total_amount_kwd, status, created_at').gte('created_at', startPrev).lt('created_at', endPrev), 'kpi.procPrev'),
    safeQuery(capIso(supabase.from('customers').select('customer_id, created_at').gte('created_at', startThis), 'created_at'), 'kpi.custThis'),
    safeQuery(supabase.from('customers').select('customer_id, created_at').gte('created_at', startPrev).lt('created_at', endPrev), 'kpi.custPrev'),
    safeQuery(supabase.from('equipment_units').select('status'), 'kpi.units'),
    safeQuery(
      supabase.from('dispatches')
        .select('dispatch_id')
        .in('status', ['Assigned', 'In Transit', 'Pending'])
        .is('return_date', null)
        .lt('dispatch_date', new Date(Date.now() - 30 * 86_400_000).toISOString()),
      'kpi.overdue'
    ),
    safeQuery(supabase.from('invoices').select('total_amount_kwd, issue_date, status').gte('issue_date', startTrend.slice(0,10)), 'kpi.invTrend'),
    safeQuery(supabase.from('dispatches').select('dispatch_id, dispatch_date').gte('dispatch_date', startTrend), 'kpi.dispTrend'),
    safeQuery(supabase.from('maintenance').select('maintenance_id, service_date, cost_kwd').gte('service_date', startTrend.slice(0,10)), 'kpi.maintTrend'),
    safeQuery(capIso(supabase.from('requirements').select('requirement_id').gte('created_at', startThis), 'created_at'), 'kpi.reqThis'),
    safeQuery(capIso(supabase.from('quotations').select('quotation_id').gte('created_at', startThis), 'created_at'), 'kpi.quotThis'),
  ]);

  const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const avgTurnaround = (rows) => {
    const days = rows.map(r => daysBetween(r.dispatch_date, r.return_date)).filter(d => d != null && d >= 0);
    return days.length ? days.reduce((s, d) => s + d, 0) / days.length : 0;
  };

  const revThis = invoicesThis.filter(i => ['Sent', 'Paid', 'Partial'].includes(i.status));
  const revPrev = invoicesPrev.filter(i => ['Sent', 'Paid', 'Partial'].includes(i.status));

  let inUse = 0, allUnits = 0, inMaint = 0;
  for (const u of unitsRow) {
    allUnits += 1;
    if (['Dispatched', 'Reserved'].includes(u.status)) inUse += 1;
    else if (u.status === 'Maintenance') inMaint += 1;
  }
  const utilPct = (allUnits - inMaint) > 0 ? Math.round(inUse * 100 / (allUnits - inMaint)) : 0;

  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

  // Six month buckets, oldest first, seeded to zero so a month with no
  // activity plots as a real zero rather than vanishing from the axis and
  // making the line look continuous when it is not.
  const monthKeys = [];
  for (let i = 5; i >= 0; i--) {
    monthKeys.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7));
  }
  const trend = new Map(monthKeys.map(m => [m, {
    month: m, revenue: 0, dispatches: 0, maintSpend: 0,
  }]));
  const intoTrend = (rows, dateKey, field, valueKey) => {
    for (const r of rows ?? []) {
      const m = String(r?.[dateKey] ?? '').slice(0, 7);
      const row = trend.get(m);
      if (!row) continue;
      row[field] += valueKey ? num(r[valueKey]) : 1;
    }
  };
  intoTrend(invoicesTrend.filter(i => ['Sent', 'Paid', 'Partial'].includes(i.status)),
    'issue_date', 'revenue', 'total_amount_kwd');
  intoTrend(dispatchesTrend, 'dispatch_date', 'dispatches');
  intoTrend(maintTrend, 'service_date', 'maintSpend', 'cost_kwd');
  const trendRows = [...trend.values()].map(r => ({
    ...r,
    revenue: Math.round(r.revenue),
    maintSpend: Math.round(r.maintSpend),
    // Maintenance as a share of revenue is the margin signal the six tiles
    // above can only imply — it is the one derived ratio worth plotting.
    maintRatioPct: r.revenue > 0 ? Math.round(r.maintSpend * 100 / r.revenue) : 0,
  }));

  const revenue = sum(revThis, 'total_amount_kwd');
  const maintSpend = sum(maintThis, 'cost_kwd');
  const procurementSpend = sum(procsThis.filter(p => !['Cancelled', 'Rejected'].includes(p.status)), 'total_amount_kwd');
  const collected = sum(revThis, 'amount_paid_kwd');

  // Pipeline funnel — how many records progressed through each stage this
  // period. convPct is vs the top stage (Requirements); dropPct is vs the
  // immediately preceding stage. Both are 0 for the first stage.
  const funnelStages = [
    { key: 'requirements', label: 'Requirements', value: requirementsThis.length },
    { key: 'quotations',   label: 'Quotations',   value: quotationsThis.length   },
    { key: 'dispatches',   label: 'Dispatches',   value: dispatchesThis.length   },
    { key: 'invoiced',     label: 'Invoiced',      value: revThis.length          },
    { key: 'collected',    label: 'Collected',     value: revThis.filter(i => i.status === 'Paid').length },
  ];
  const funnelTop = funnelStages[0].value || 1;
  const funnel = funnelStages.map((s, i) => ({
    ...s,
    convPct: i === 0 ? 100 : Math.round(s.value * 100 / funnelTop),
    dropPct: i === 0 ? 0 : (
      funnelStages[i - 1].value > 0
        ? Math.round((1 - s.value / funnelStages[i - 1].value) * 100)
        : 0
    ),
  }));

  return {
    kpis: {
      revenue,
      revenueDeltaPct: pct(revenue, sum(revPrev, 'total_amount_kwd')),

      dispatches: dispatchesThis.length,
      dispatchesDeltaPct: pct(dispatchesThis.length, dispatchesPrev.length),
      avgTurnaroundDays: avgTurnaround(dispatchesThis),

      utilizationPct: utilPct,

      maintJobs: maintThis.length,
      maintSpend,
      maintSpendDeltaPct: pct(maintSpend, sum(maintPrev, 'cost_kwd')),

      procurementSpend,
      procurementCount: procsThis.length,
      procurementDeltaPct: pct(procsThis.length, procsPrev.length),

      newCustomers: customersThis.length,
      newCustomersDeltaPct: pct(customersThis.length, customersPrev.length),

      overdueCount: overdue.length,

      // Additive — the composite figures an executive summary reads from.
      prevRevenue: sum(revPrev, 'total_amount_kwd'),
      collected,
      collectionRatePct: revenue > 0 ? Math.round(collected * 100 / revenue) : 0,
      // Every KWD leaving the business this month against every KWD invoiced.
      totalOutflow: maintSpend + procurementSpend,
      costRatioPct: revenue > 0 ? Math.round(((maintSpend + procurementSpend) * 100) / revenue) : null,
      maintRatioPct: revenue > 0 ? Math.round((maintSpend * 100) / revenue) : null,
      revenuePerDispatch: dispatchesThis.length ? revenue / dispatchesThis.length : 0,
      fleetInMaint: inMaint,
      fleetTotal: allUnits,
      bestMonthRevenue: Math.max(0, ...trendRows.map(r => r.revenue)),
      sixMonthRevenue: trendRows.reduce((s, r) => s + r.revenue, 0),
    },
    series: { trend: trendRows },
    breakdowns: { funnel },
    meta: {
      // Calendar-month keys are ONLY meaningful when no explicit range was
      // chosen — in that case the section is genuinely "this month vs prev
      // month" and the subtitle can quote calendar months. Under an
      // explicit range those keys were previously stamped anyway, so a
      // brief pulled from a custom / All-time range labelled the numbers
      // "this month" even when the data spanned six years. That is the
      // "13-day window but says this month" report; the keys are now null
      // whenever they would mislead, and the subtitle falls back to the
      // actual queried edges the range helper prints.
      monthKey: useRange ? null : now.toISOString().slice(0, 7),
      prevMonthKey: useRange ? null : new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7),
      // The actual period the queries ran against, so `describeRange` in
      // analyticsLabels.js can produce faithful phrasing for the brief.
      // Under the default (no range) the period IS the calendar month, so
      // fromDate/toDate reflect month-start / today; under an explicit
      // range they mirror the user's pick.
      windowDays: useRange ? explicit.days : now.getDate(),
      fromDate: useRange ? explicit.fromDate : startThis.slice(0, 10),
      toDate: useRange ? explicit.toDate : localDate(now),
      allTime: useRange && explicit.allTime === true,
      explicitRange: useRange,
      // A comparison is only meaningful when there IS a prior period. The
      // default "this month" has one (the previous calendar month); every
      // explicit range gets an equal-length prior; only "All time" has no
      // prior at all. The brief reads this flag rather than inferring.
      hasPrior: !(useRange && explicit.allTime === true),
      confidence: confidenceFrom({
        sampleSize: invoicesThis.length + dispatchesThis.length + maintThis.length,
        // Month-to-date by construction, so a thin early-month scorecard
        // should say so rather than reading as a full month's performance.
        fieldCoverage: 1,
        windowDays: useRange ? explicit.days : now.getDate(),
      }),
    },
  };
}

// ── 4.14 Unit-level P&L (ESTIMATE) ──────────────────────────────────────
//
// The single most decision-triggering visual in the whole page: which
// individual units are earning their keep and which are quietly losing us
// money. Deliberately labelled as an ESTIMATE — a full P&L would need COGS,
// depreciation, and labour-rate breakdowns we do not yet have. What we can
// do honestly is:
//
//   Revenue  =  Σ (approved quotation_items rate × days) for lines with an
//               equipment_id whose rental period overlaps the window
//             + Σ (lease_monthly_kwd × months in window) for units on lease
//               during the window
//   Cost     =  Σ maintenance.cost_kwd (Completed only) for the unit in the
//               window
//   Net      =  Revenue − Cost   (contribution, before overheads)
//
// Every basis is disclosed in `meta` and the section subtitle re-states it,
// so the number is defensible without pretending to be book accounting.
//
// The whole computation is defensive: any missing table falls through empty
// (safeQuery), any null row is filtered, and a unit with only cost / only
// revenue still appears in the ranking so a "quietly losing money" unit is
// never invisible.
export async function getUnitPnL(params = {}) {
  const { days, fromIso, toIso, fromDate, toDate, allTime } =
    resolveWindow(params, 90);
  const winStartMs = new Date(fromIso).getTime();
  const winEndMs   = new Date(toIso).getTime();

  // Quotation items with rental dates that OVERLAP the window. Under the
  // Supabase JS client "A overlaps window" is expressed as "A.start <= winEnd
  // AND (A.end IS NULL OR A.end >= winStart)". IS NULL is combined with a
  // separate .or() clause because .lte / .gte alone drop nulls. Filtering
  // on the parent quotation.status happens client-side after the join, since
  // a filter on the JOINED table via PostgREST syntax is more fragile than
  // it needs to be for a section that already reads defensively.
  // Unbounded below on rental_start_date (only an upper bound, `toDate`) and
  // filtered to nothing narrower than "has an equipment_id" — of every raw
  // query in this file, this one had the least protection against the
  // 1000-row cap, and quotation_items had already crossed it. Paged via
  // safeQueryAll rather than left as the single riskiest unbounded query.
  const quotationItems = await safeQueryAll(
    () => supabase
      .from('quotation_items')
      .select(
        'item_id, quotation_id, equipment_id, quantity, unit, unit_rate_kwd, rental_start_date, rental_end_date, ' +
        'quotations(quotation_id, status, created_at), ' +
        'equipment_units(equipment_id, serial_number, capacity, location, ' +
          'lease_monthly_kwd, lease_start_date, lease_end_date, lease_returned_at, ' +
          'equipment_types(type_id, name, category))'
      )
      .not('equipment_id', 'is', null)
      .lte('rental_start_date', toDate),
    PK_COLUMN.quotation_items,
    'unitPnL.quotationItems'
  );

  // Every unit that was on a lease at ANY point in the window: lease started
  // on/before the window end AND (was not returned OR returned after window
  // start). Also picks up open leases with no end date. The unit-metadata
  // block is the same shape as the quotation-item join so the label helper
  // reads one path in both places.
  const leaseUnits = await safeQuery(
    supabase
      .from('equipment_units')
      .select(
        'equipment_id, serial_number, capacity, location, ' +
        'lease_monthly_kwd, lease_start_date, lease_end_date, lease_returned_at, ' +
        'equipment_types(type_id, name, category)'
      )
      .not('lease_monthly_kwd', 'is', null)
      .not('lease_start_date', 'is', null)
      .lte('lease_start_date', toDate),
    'unitPnL.leaseUnits'
  );

  // Maintenance costs in the window, per unit. Only Completed jobs carry a
  // settled cost — the same discipline maintenance_cost_trends uses. Open
  // jobs' cost_kwd is estimate at best and would poison the P&L trend.
  const maintenance = await safeQuery(
    supabase
      .from('maintenance')
      .select(
        'maintenance_id, equipment_id, cost_kwd, service_date, status, ' +
        'equipment_units(equipment_id, serial_number, capacity, ' +
          'equipment_types(type_id, name, category))'
      )
      .gte('service_date', fromDate)
      .lte('service_date', toDate)
      .eq('status', 'Completed'),
    'unitPnL.maintenance'
  );

  // ── Aggregation ───────────────────────────────────────────────────────
  const perUnit = new Map();
  const ensureUnit = (eqId, seed) => {
    if (!eqId) return null;
    if (!perUnit.has(eqId)) {
      const t = seed?.equipment_types;
      perUnit.set(eqId, {
        equipment_id: eqId,
        label: unitLabel({
          equipment_id: eqId,
          type_name: t?.name,
          capacity: seed?.capacity,
          serial_number: seed?.serial_number ?? null,
        }),
        type_name: t?.name ?? 'Unknown',
        type_id: t?.type_id ?? null,
        category: t?.category ?? null,
        serial_number: seed?.serial_number ?? null,
        location: seed?.location ?? null,
        rentalRevenue: 0,
        leaseRevenue: 0,
        maintenanceCost: 0,
        rentalDays: 0,
        maintJobs: 0,
        lastMaintDate: null,
      });
    }
    return perUnit.get(eqId);
  };

  // Rental revenue attribution. `unit_rate_kwd` is a KWD/day rate in this
  // schema (the create path stores rows with unit='Days'), so a line's
  // contribution to the window is min(end, winEnd) − max(start, winStart) + 1
  // days × rate, floored at zero. quantity is deliberately NOT multiplied in
  // here: the schema stores quantity=1 for equipment items and the price is
  // per-unit, so quantity × rate × days would double-count.
  const ELIGIBLE_QUOTE_STATUSES = new Set(
    ['Approved', 'Sent', 'Paid', 'Partial', 'Invoiced']
  );
  for (const it of quotationItems) {
    if (!it?.equipment_id) continue;
    const q = it.quotations;
    // A quotation whose status is void / cancelled / rejected did not earn
    // money; skip it. Missing status also skipped — a line without a parent
    // is not a contract we can defend as revenue.
    const status = q?.status;
    if (!status || isVoid(status) || !ELIGIBLE_QUOTE_STATUSES.has(status)) continue;

    const startMs = it.rental_start_date
      ? new Date(it.rental_start_date).getTime() : NaN;
    const endMs = it.rental_end_date
      ? new Date(it.rental_end_date).getTime() : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < winStartMs || startMs > winEndMs) continue;

    const overlapStart = Math.max(startMs, winStartMs);
    const overlapEnd   = Math.min(endMs,   winEndMs);
    const overlapDays  = Math.max(0, Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1);
    if (overlapDays <= 0) continue;

    const rate = num(it.unit_rate_kwd);
    if (rate <= 0) continue;

    const row = ensureUnit(it.equipment_id, it.equipment_units);
    if (!row) continue;
    row.rentalRevenue += rate * overlapDays;
    row.rentalDays   += overlapDays;
  }

  // Lease revenue attribution. Months in window = overlap days / 30.4375, so
  // a full window of a monthly lease resolves to exactly its monthly rate ×
  // the number of months, without needing calendar-month arithmetic that
  // would drift over long windows.
  for (const u of leaseUnits) {
    if (!u?.equipment_id) continue;
    const startMs = u.lease_start_date
      ? new Date(u.lease_start_date).getTime() : NaN;
    if (!Number.isFinite(startMs)) continue;
    // A lease that ended before this window started did not earn from it.
    // `lease_returned_at` (actual return) takes precedence over `lease_end_date`
    // (contracted end) — the returned date is what really stopped the meter.
    const returnedMs = u.lease_returned_at
      ? new Date(u.lease_returned_at).getTime() : NaN;
    const contractEndMs = u.lease_end_date
      ? new Date(u.lease_end_date).getTime() : NaN;
    const effectiveEnd = Number.isFinite(returnedMs) ? returnedMs
      : Number.isFinite(contractEndMs) ? contractEndMs
      : winEndMs;   // open lease = still running as of window end
    if (effectiveEnd < winStartMs) continue;

    const overlapStart = Math.max(startMs, winStartMs);
    const overlapEnd   = Math.min(effectiveEnd, winEndMs);
    if (overlapEnd < overlapStart) continue;
    const overlapDays  = Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
    if (overlapDays <= 0) continue;

    const monthly = num(u.lease_monthly_kwd);
    if (monthly <= 0) continue;

    const row = ensureUnit(u.equipment_id, u);
    if (!row) continue;
    row.leaseRevenue += monthly * (overlapDays / 30.4375);
  }

  // Maintenance cost per unit.
  for (const j of maintenance) {
    if (!j?.equipment_id) continue;
    const row = ensureUnit(j.equipment_id, j.equipment_units);
    if (!row) continue;
    row.maintenanceCost += num(j.cost_kwd);
    row.maintJobs += 1;
    if (j.service_date &&
        (!row.lastMaintDate || j.service_date > row.lastMaintDate)) {
      row.lastMaintDate = j.service_date;
    }
  }

  // Derived per-unit figures. Round to whole KWD for display; keep raw
  // numbers around for the totals so summing rounded values does not drift.
  const rows = [...perUnit.values()].map(u => {
    const revenue = u.rentalRevenue + u.leaseRevenue;
    const net = revenue - u.maintenanceCost;
    return {
      ...u,
      rentalRevenue: Math.round(u.rentalRevenue),
      leaseRevenue:  Math.round(u.leaseRevenue),
      revenue:       Math.round(revenue),
      maintenanceCost: Math.round(u.maintenanceCost),
      net:           Math.round(net),
      // Contribution margin as a % of revenue; null when there is no revenue
      // to compare against, so the UI can print "—" rather than a fake 0%.
      marginPct: revenue > 0 ? Math.round((net / revenue) * 100) : null,
    };
  });

  const earners = rows.filter(r => r.net > 0).sort((a, b) => b.net - a.net);
  const losers  = rows.filter(r => r.net < 0).sort((a, b) => a.net - b.net);
  const breakEven = rows.filter(r => r.net === 0).length;

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost    = rows.reduce((s, r) => s + r.maintenanceCost, 0);
  const totalNet     = totalRevenue - totalCost;

  // "Top 5" style ranking for the chart — mixing earners and losers so a
  // manager sees both edges of the distribution on one bar chart. Signed
  // net contribution renders as green above zero, red below.
  const chartTop = [
    ...earners.slice(0, 5),
    ...losers.slice(0, 5).reverse(),
  ].sort((a, b) => b.net - a.net);

  return {
    kpis: {
      unitsMeasured: rows.length,
      earnerCount: earners.length,
      loserCount: losers.length,
      breakEvenCount: breakEven,
      totalRevenue,
      totalCost,
      totalNet,
      // Named lists for the template / brief.
      topEarnerLabel: earners[0]?.label ?? null,
      topEarnerNet: earners[0]?.net ?? 0,
      worstLoserLabel: losers[0]?.label ?? null,
      worstLoserNet: losers[0]?.net ?? 0,
      // Marginless: a unit with cost but no revenue is the strongest signal
      // in the whole section — surface a count so the template can lead
      // with it.
      idleWithCostCount: rows.filter(r => r.revenue === 0 && r.maintenanceCost > 0).length,
      idleWithCostLabel: rows.find(r => r.revenue === 0 && r.maintenanceCost > 0)?.label ?? null,
      avgNetPerUnit: rows.length ? Math.round(totalNet / rows.length) : 0,
    },
    series: {
      // Signed net contribution — the whole story in one bar chart.
      pnl: chartTop.map(r => ({
        label: r.label,
        equipment_id: r.equipment_id,
        net: r.net,
        revenue: r.revenue,
        cost: r.maintenanceCost,
      })),
    },
    breakdowns: {
      earners: earners.slice(0, 10),
      losers:  losers.slice(0, 10),
    },
    meta: {
      windowDays: days,
      fromDate,
      toDate,
      allTime,
      // The basis disclosure. Every KWD figure in this section rides on
      // this assumption stack; the section subtitle reads it back.
      basis: 'estimate',
      basisNote: 'Revenue from approved quotation lines (rate × overlap days) plus pro-rated lease commitment. Cost from completed maintenance jobs. Overheads, depreciation, and labour rates are NOT included.',
      confidence: confidenceFrom({
        sampleSize: rows.length,
        // A unit whose type link is missing cannot carry a real name in the
        // ranking, and a unit with neither revenue nor cost is a phantom.
        fieldCoverage: coverage(rows, r =>
          r.type_name !== 'Unknown' && (r.revenue > 0 || r.maintenanceCost > 0)),
        windowDays: days,
      }),
    },
  };
}

// ── 4.15 Forward revenue forecast (booked lease commitments) ────────────
//
// Forward-looking KWD — the single most demo-worthy chart in the app.
// Everything here is BOOKED lease commitment from `equipment_units`: no
// growth assumption, no renewal likelihood, no rental add-on. That is on
// purpose — a manager's first "will I hit the number?" question deserves
// a floor built only from contracts already in the ground, and the
// section subtitle re-states that.
//
// Time-buckets: 30 / 60 / 90 days from today. For each bucket we sum, over
// every currently-open lease (lease_returned_at IS NULL and
// lease_start_date <= horizon), the fraction of the bucket the lease will
// actually be live for × its monthly rate. A lease that ends inside the
// bucket contributes only up to its contracted end date; an open-ended
// lease contributes the full bucket.
//
// Also returns a 12-week series for a small trailing chart, and lists of
// leases expiring inside each bucket so the manager can see the renewal
// risk that sits alongside the forecast number.
export async function getForwardForecast(params = {}) {
  const horizonDays = Math.max(30, Math.min(365, Number(params?.horizonDays) || 90));
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonDays * DAY_MS;
  const horizonDate = localDate(new Date(horizonMs));

  // Every unit currently on a lease that has at least some overlap with the
  // forecast horizon: the lease started on/before the horizon end AND has
  // not been returned yet (or was returned in the future, which shouldn't
  // happen but the query still tolerates).
  const units = await safeQuery(
    supabase
      .from('equipment_units')
      .select(
        'equipment_id, serial_number, capacity, location, ' +
        'lease_monthly_kwd, lease_start_date, lease_end_date, lease_returned_at, ' +
        'equipment_types(type_id, name, category)'
      )
      .not('lease_monthly_kwd', 'is', null)
      .gt('lease_monthly_kwd', 0)
      .not('lease_start_date', 'is', null)
      .is('lease_returned_at', null)
      .lte('lease_start_date', horizonDate),
    'forecast.units'
  );

  // Bucket boundaries — 30 / 60 / 90 days from today (or capped at
  // horizonDays if the caller asked for less).
  const bucketEdges = [30, 60, 90].filter(d => d <= horizonDays);
  if (!bucketEdges.length) bucketEdges.push(horizonDays);

  const buckets = bucketEdges.map((edge, i) => {
    const prevEdge = i === 0 ? 0 : bucketEdges[i - 1];
    return {
      label: `Next ${edge}d`,
      edge,
      startMs: nowMs + prevEdge * DAY_MS,
      endMs: nowMs + edge * DAY_MS,
      forecastKwd: 0,
      leases: 0,
      openEnded: 0,
      expiringInBucket: 0,
    };
  });

  const activeMonthly = units.reduce((s, u) => s + num(u.lease_monthly_kwd), 0);
  const expiringSoon = [];

  for (const u of units) {
    if (!u?.equipment_id) continue;
    const monthly = num(u.lease_monthly_kwd);
    if (monthly <= 0) continue;
    const daily = monthly / 30.4375;

    const startMs = new Date(u.lease_start_date).getTime();
    if (!Number.isFinite(startMs)) continue;
    const endMs = u.lease_end_date
      ? new Date(u.lease_end_date).getTime()
      : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(endMs) && u.lease_end_date) continue;

    // Days until this lease's contracted end (from today). Negative means it
    // is already past its end date but has not been returned — surfaced as
    // "overdue return" in the section subtitle rather than counted forward.
    const daysToEnd = endMs === Number.POSITIVE_INFINITY
      ? null
      : Math.floor((endMs - nowMs) / DAY_MS);

    for (const b of buckets) {
      const overlapStart = Math.max(startMs, b.startMs, nowMs);
      const overlapEnd   = Math.min(endMs,   b.endMs);
      if (overlapEnd <= overlapStart) continue;
      const overlapDays = (overlapEnd - overlapStart) / DAY_MS;
      b.forecastKwd += daily * overlapDays;
      b.leases += 1;
      if (endMs === Number.POSITIVE_INFINITY) b.openEnded += 1;
      if (endMs !== Number.POSITIVE_INFINITY && endMs > b.startMs && endMs <= b.endMs) {
        b.expiringInBucket += 1;
      }
    }

    if (daysToEnd != null && daysToEnd >= 0 && daysToEnd <= horizonDays) {
      const t = u.equipment_types;
      expiringSoon.push({
        equipment_id: u.equipment_id,
        label: unitLabel({
          equipment_id: u.equipment_id,
          type_name: t?.name,
          capacity: u.capacity,
          serial_number: u.serial_number ?? null,
        }),
        type_name: t?.name ?? 'Unknown',
        monthly: Math.round(monthly),
        daysToEnd,
        endDate: u.lease_end_date,
      });
    }
  }

  const seriesRows = buckets.map(b => ({
    label: b.label,
    edge: b.edge,
    forecastKwd: Math.round(b.forecastKwd),
    leases: b.leases,
    expiringInBucket: b.expiringInBucket,
  }));
  expiringSoon.sort((a, b) => a.daysToEnd - b.daysToEnd);

  const totalToHorizon = Math.round(
    buckets.reduce((s, b) => s + b.forecastKwd, 0)
  );

  return {
    kpis: {
      horizonDays,
      horizonDate,
      leaseCount: units.length,
      activeMonthlyCommit: Math.round(activeMonthly),
      forecast30: Math.round(buckets.find(b => b.edge === 30)?.forecastKwd ?? 0),
      forecast60: Math.round(
        (buckets.find(b => b.edge === 30)?.forecastKwd ?? 0) +
        (buckets.find(b => b.edge === 60)?.forecastKwd ?? 0)
      ),
      forecast90: Math.round(
        (buckets.find(b => b.edge === 30)?.forecastKwd ?? 0) +
        (buckets.find(b => b.edge === 60)?.forecastKwd ?? 0) +
        (buckets.find(b => b.edge === 90)?.forecastKwd ?? 0)
      ),
      totalToHorizon,
      expiringCount: expiringSoon.length,
      soonestExpiryLabel: expiringSoon[0]?.label ?? null,
      soonestExpiryDays: expiringSoon[0]?.daysToEnd ?? null,
    },
    series: {
      buckets: seriesRows,
    },
    breakdowns: {
      expiringSoon: expiringSoon.slice(0, 12),
    },
    meta: {
      horizonDays,
      basis: 'booked-only',
      basisNote: 'Forecast is booked lease commitments only. Renewal likelihood, new deals, and rental (dispatch) add-on are NOT included — this is a floor, not a plan.',
      confidence: confidenceFrom({
        sampleSize: units.length,
        // A lease row without an end date can still contribute (treated as
        // open-ended for the horizon), but a rate of zero cannot.
        fieldCoverage: coverage(units, u => num(u.lease_monthly_kwd) > 0),
        windowDays: horizonDays,
      }),
    },
  };
}

// ── 4.15 Fleet Action Queue ──────────────────────────────────────────────
//
// Prescriptive complement to the 14 descriptive sections. Answers
// "what do I do today" by surfacing three current-state signals:
//   1. Idle units       — Available, last returned > IDLE_THRESHOLD_DAYS ago
//   2. Grounded units   — Maintenance status with an open maintenance job
//   3. Collection items — Unpaid / partial invoices above the threshold
//
// Idle duration is measured from the dispatch return_date, not from
// equipment_units.updated_at — updated_at changes on any field edit,
// whereas return_date is the actual moment the unit came back to yard.
// Units never dispatched show idle_days = null ("never hired").

export async function getFleetActionQueue() {
  const IDLE_THRESHOLD_DAYS = 14;
  const COLLECTION_THRESHOLD_KWD = 500;
  const today = new Date();
  const twoYearsAgo = localDate(new Date(today.getTime() - 730 * DAY_MS));
  const sixMonthsAgo = localDate(new Date(today.getTime() - 180 * DAY_MS));

  const [units, dispatches, openJobs, openInvoices, customers, overdueDispatches] = await Promise.all([
    // All equipment units — status + daily rate drive both idle and grounded signals
    safeQuery(
      supabase
        .from('equipment_units')
        .select('equipment_id, serial_number, status, location, daily_rate_kwd, capacity, equipment_types(name)'),
      'fleetAction_units'
    ),
    // Return dates for the last two years — used to compute how long each
    // Available unit has been sitting since its last dispatch.
    safeQuery(
      supabase
        .from('dispatches')
        .select('equipment_id, return_date')
        .not('return_date', 'is', null)
        .gte('return_date', twoYearsAgo),
      'fleetAction_dispatches'
    ),
    // Open jobs — provide start_date and issue_type for the grounded signal
    safeQuery(
      supabase
        .from('maintenance')
        .select('maintenance_id, equipment_id, start_date, issue_type, cost_kwd')
        .in('status', ['Open', 'In Progress']),
      'fleetAction_jobs'
    ),
    // Unpaid / partially-paid invoices in the last 180 days
    safeQuery(
      supabase
        .from('invoices')
        .select('invoice_id, customer_id, total_amount_kwd, amount_paid_kwd, issue_date, due_date')
        .in('status', ['Sent', 'Partial'])
        .gte('issue_date', sixMonthsAgo),
      'fleetAction_invoices'
    ),
    // Customer names to label collection actions
    safeQuery(
      supabase.from('customers').select('customer_id, company_name'),
      'fleetAction_customers'
    ),
    // Dispatches whose return_date has passed but unit is still out
    safeQuery(
      supabase
        .from('dispatches')
        .select('dispatch_id, equipment_id, return_date, destination, equipment_units(equipment_id, serial_number, capacity, equipment_types(name))')
        .in('status', ['Assigned', 'In Transit', 'Pending'])
        .not('return_date', 'is', null)
        .lt('return_date', localDate(today)),
      'fleetAction_overdue'
    ),
  ]);

  // ── Lookup maps ──────────────────────────────────────────────────────────

  const lastReturnMap = new Map();
  for (const d of dispatches) {
    if (!d.equipment_id || !d.return_date) continue;
    const existing = lastReturnMap.get(d.equipment_id);
    if (!existing || d.return_date > existing) lastReturnMap.set(d.equipment_id, d.return_date);
  }

  const openJobMap = new Map();
  for (const j of openJobs) {
    if (!j.equipment_id || openJobMap.has(j.equipment_id)) continue;
    openJobMap.set(j.equipment_id, j);
  }

  const customerMap = new Map();
  for (const c of customers) {
    if (c.customer_id) customerMap.set(c.customer_id, c.company_name ?? null);
  }

  // ── Signal 1: Idle ───────────────────────────────────────────────────────
  const idleActions = [];
  for (const u of units) {
    if (u.status !== 'Available') continue;
    const lastReturn = lastReturnMap.get(u.equipment_id);
    const idleDays = lastReturn
      ? Math.round((today.getTime() - new Date(lastReturn).getTime()) / DAY_MS)
      : null;
    const effectiveIdle = idleDays ?? 9999;
    if (effectiveIdle < IDLE_THRESHOLD_DAYS) continue;
    const rate = Number(u.daily_rate_kwd ?? 0);
    idleActions.push({
      equipment_id: u.equipment_id,
      unit_label: unitLabel({ equipment_id: u.equipment_id, type_name: u.equipment_types?.name, capacity: u.capacity, serial_number: u.serial_number ?? null }),
      serial_number: u.serial_number ?? null,
      location: u.location ?? null,
      type_name: u.equipment_types?.name ?? null,
      rate_kwd: rate,
      idle_days: idleDays,
      forgone_kwd: Math.round(rate * (idleDays !== null ? idleDays : 90)),
      action: 'idle',
      priority: effectiveIdle >= 30 ? 'high' : 'medium',
    });
  }
  idleActions.sort((a, b) => (b.idle_days ?? 9999) - (a.idle_days ?? 9999));

  // ── Signal 2: Grounded ───────────────────────────────────────────────────
  const groundedActions = [];
  for (const u of units) {
    if (u.status !== 'Maintenance') continue;
    const job = openJobMap.get(u.equipment_id);
    const startDate = job?.start_date ? new Date(job.start_date) : null;
    const daysGrounded = startDate
      ? Math.round((today.getTime() - startDate.getTime()) / DAY_MS)
      : null;
    const rate = Number(u.daily_rate_kwd ?? 0);
    groundedActions.push({
      equipment_id: u.equipment_id,
      unit_label: unitLabel({ equipment_id: u.equipment_id, type_name: u.equipment_types?.name, capacity: u.capacity, serial_number: u.serial_number ?? null }),
      serial_number: u.serial_number ?? null,
      location: u.location ?? null,
      type_name: u.equipment_types?.name ?? null,
      rate_kwd: rate,
      days_grounded: daysGrounded,
      issue_type: job?.issue_type ?? null,
      job_cost_kwd: Number(job?.cost_kwd ?? 0),
      forgone_kwd: Math.round(rate * (daysGrounded ?? 7)),
      action: 'grounded',
      priority: (daysGrounded ?? 7) >= 7 ? 'high' : 'medium',
    });
  }
  groundedActions.sort((a, b) => (b.days_grounded ?? 0) - (a.days_grounded ?? 0));

  // ── Signal 3: Collection ─────────────────────────────────────────────────
  const collMap = new Map();
  for (const inv of openInvoices) {
    const outstanding = Number(inv.total_amount_kwd ?? 0) - Number(inv.amount_paid_kwd ?? 0);
    if (outstanding < 0.01) continue;
    const cid = inv.customer_id ?? `_anon_${inv.invoice_id}`;
    const entry = collMap.get(cid) ?? {
      customer_id: inv.customer_id,
      company_name: customerMap.get(inv.customer_id) ?? 'Unknown Customer',
      outstanding_kwd: 0,
      invoice_count: 0,
      oldest_invoice_date: null,
      action: 'collection',
      age_buckets: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
      max_days_late: 0,
    };
    entry.outstanding_kwd += outstanding;
    entry.invoice_count += 1;
    if (!entry.oldest_invoice_date || inv.issue_date < entry.oldest_invoice_date) {
      entry.oldest_invoice_date = inv.issue_date;
    }
    const dueDate = inv.due_date ? new Date(inv.due_date) : null;
    const daysLate = dueDate ? Math.max(0, Math.round((today.getTime() - dueDate.getTime()) / DAY_MS)) : 0;
    const bucket = !dueDate || daysLate === 0 ? 'current'
      : daysLate <= 30 ? '1-30'
      : daysLate <= 60 ? '31-60'
      : daysLate <= 90 ? '61-90' : '90+';
    entry.age_buckets[bucket] = (entry.age_buckets[bucket] ?? 0) + outstanding;
    if (daysLate > (entry.max_days_late ?? 0)) entry.max_days_late = daysLate;
    collMap.set(cid, entry);
  }
  const collectionActions = [...collMap.values()]
    .filter(c => c.outstanding_kwd >= COLLECTION_THRESHOLD_KWD)
    .map(c => ({ ...c, outstanding_kwd: Math.round(c.outstanding_kwd), priority: c.outstanding_kwd >= 2000 ? 'high' : 'medium' }))
    .sort((a, b) => b.outstanding_kwd - a.outstanding_kwd)
    .slice(0, 10);

  // ── Signal 4: Overdue Returns ────────────────────────────────────────────
  const overdueActions = [];
  const seenOverdue = new Set();
  for (const d of overdueDispatches) {
    if (!d.equipment_id || seenOverdue.has(d.equipment_id)) continue;
    seenOverdue.add(d.equipment_id);
    const u = d.equipment_units;
    const daysOverdue = d.return_date
      ? Math.round((today.getTime() - new Date(d.return_date).getTime()) / DAY_MS)
      : 0;
    overdueActions.push({
      equipment_id: d.equipment_id,
      unit_label: unitLabel({ equipment_id: d.equipment_id, type_name: u?.equipment_types?.name, capacity: u?.capacity, serial_number: u?.serial_number ?? null }),
      serial_number: u?.serial_number ?? null,
      location: d.destination ?? null,
      type_name: u?.equipment_types?.name ?? null,
      days_overdue: daysOverdue,
      return_date: d.return_date,
      action: 'overdue',
      priority: daysOverdue >= 7 ? 'high' : 'medium',
    });
  }
  overdueActions.sort((a, b) => b.days_overdue - a.days_overdue);

  // ── Totals ───────────────────────────────────────────────────────────────
  const totalForgoneKwd = idleActions.reduce((s, a) => s + a.forgone_kwd, 0)
    + groundedActions.reduce((s, a) => s + a.forgone_kwd, 0);
  const totalOutstandingKwd = collectionActions.reduce((s, a) => s + a.outstanding_kwd, 0);
  const allActions = [...idleActions, ...groundedActions, ...collectionActions, ...overdueActions];
  const highPriorityCount = allActions.filter(a => a.priority === 'high').length;

  return {
    kpis: {
      totalActions: allActions.length,
      idleCount: idleActions.length,
      groundedCount: groundedActions.length,
      collectionCount: collectionActions.length,
      overdueCount: overdueActions.length,
      highPriorityCount,
      totalForgoneKwd: Math.round(totalForgoneKwd),
      totalOutstandingKwd: Math.round(totalOutstandingKwd),
      totalExposureKwd: Math.round(totalForgoneKwd + totalOutstandingKwd),
    },
    breakdowns: {
      idle: idleActions.slice(0, 15),
      grounded: groundedActions,
      collection: collectionActions,
      overdue: overdueActions,
    },
    meta: {
      asOf: localDate(today),
      idleThresholdDays: IDLE_THRESHOLD_DAYS,
      collectionThresholdKwd: COLLECTION_THRESHOLD_KWD,
      confidence: confidenceFrom({
        sampleSize: units.length,
        fieldCoverage: coverage(units, u => Number(u.daily_rate_kwd) > 0),
        windowDays: 180,
      }),
    },
  };
}
