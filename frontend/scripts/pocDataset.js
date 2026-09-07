/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// POC dataset — 180 days of connected operational history.
//
// This module BUILDS the data (pure, deterministic). It does not write it
// anywhere. Two consumers read it:
//   generate_poc_seed.js            → emits frontend/seed_poc_operations_2026.sql
//   verify_operational_model.mjs    → asserts the dashboard model against it
//
// The chain is generated forwards, one business day at a time, so every
// downstream count is genuinely caused by the one above it:
//
//   requirement → quotation → (approval) order → dispatch → delivery → return
//
// Nothing is sampled independently. If quotes spike, orders spike two days
// later because those specific quotes were approved; if dispatch capacity is
// capped, the backlog that appears is the orders that did not get a dispatch
// row. That is what makes the dashboard explainable on a demo call: every
// line moves for a reason you can point at in this file.
//
// Determinism: a fixed-seed mulberry32 PRNG. Re-running produces byte-identical
// output, so the SQL file diffs cleanly and the REST applier is idempotent.
//
// Row text is deliberately plain operational wording: no phase names and no
// "anomaly" labels are written into the data, so a reader of the rows sees
// what an operator would have typed. The scenario structure lives here and in
// docs/operational-dashboard.md, not in the seeded records.
//
// Rollback: every row carries the marker below in a text column, and the
// generated SQL deletes on that marker before inserting. It cannot touch rows
// that were not produced here. The marker is a rollback tag, not a label —
// it is the only string the DELETE block can match on.
// ═════════════════════════════════════════════════════════════════════════

const MARKER = '[JTC-POC-09]';

// The last day with actual data. The forecast begins the day after, so the
// projection is always visibly beyond the end of the history.
const LAST_DAY = '2026-09-04';
const HISTORY_DAYS = 180;

// Kuwait works Sunday–Thursday. Friday is near-dead and Saturday is a light
// day; without this the day-of-week factor in lib/forecast.js has nothing to
// find and the forecast looks suspiciously smooth.
//                  Sun   Mon   Tue   Wed   Thu   Fri   Sat
const DOW_FACTOR = [1.05, 1.12, 1.08, 1.00, 0.92, 0.12, 0.38];

// ── Reference data (read from the live database on 2026-09-04) ──────────
const CUSTOMERS = [
  'KW-CUST-0001', 'KW-CUST-0002', 'KW-CUST-0003', 'KW-CUST-0004', 'KW-CUST-0005',
  'KW-CUST-0006', 'KW-CUST-0007', 'KW-CUST-0008', 'KW-CUST-0009', 'KW-CUST-0010',
  'KW-CUST-0011', 'KW-CUST-0012', 'KW-CUST-0013', 'KW-CUST-0014', 'KW-CUST-0015',
  'KW-CUST-0016', 'KW-CUST-0018', 'KW-CUST-0019', 'KW-CUST-0020', 'KW-CUST-0021',
];
const SALES_USER = 'KW-USR-0003';   // Farhan Al Rashid  — Sales Executive
const OPS_USER   = 'KW-USR-0004';   // Ahmed Rahman      — Operations Manager
const DISP_USER  = 'KW-USR-0006';   // Mohammed Hassan   — Dispatch Coordinator
const FIN_USER   = 'KW-USR-0007';   // Khalid Ahmed      — Finance Officer
// The real unit ids, read from equipment_units. NOT generated from a
// counter: the sequence has gaps (0039-0063, 0068, 0073-0076, 0083 are
// absent), and a generated id would fail the dispatches FK.
const EQUIPMENT = [
  'KW-EQP-0001', 'KW-EQP-0002', 'KW-EQP-0003', 'KW-EQP-0004', 'KW-EQP-0005',
  'KW-EQP-0006', 'KW-EQP-0007', 'KW-EQP-0008', 'KW-EQP-0009', 'KW-EQP-0010',
  'KW-EQP-0011', 'KW-EQP-0012', 'KW-EQP-0013', 'KW-EQP-0014', 'KW-EQP-0015',
  'KW-EQP-0016', 'KW-EQP-0017', 'KW-EQP-0018', 'KW-EQP-0019', 'KW-EQP-0020',
  'KW-EQP-0021', 'KW-EQP-0022', 'KW-EQP-0023', 'KW-EQP-0024', 'KW-EQP-0025',
  'KW-EQP-0026', 'KW-EQP-0027', 'KW-EQP-0028', 'KW-EQP-0029', 'KW-EQP-0030',
  'KW-EQP-0031', 'KW-EQP-0032', 'KW-EQP-0033', 'KW-EQP-0034', 'KW-EQP-0035',
  'KW-EQP-0036', 'KW-EQP-0037', 'KW-EQP-0038', 'KW-EQP-0064', 'KW-EQP-0065',
  'KW-EQP-0066', 'KW-EQP-0067', 'KW-EQP-0069', 'KW-EQP-0070', 'KW-EQP-0071',
  'KW-EQP-0072', 'KW-EQP-0075', 'KW-EQP-0077', 'KW-EQP-0078', 'KW-EQP-0079',
  'KW-EQP-0080', 'KW-EQP-0081', 'KW-EQP-0082', 'KW-EQP-0084', 'KW-EQP-0085',
  'KW-EQP-0086', 'KW-EQP-0087', 'KW-EQP-0088', 'KW-EQP-0089', 'KW-EQP-0090',
  'KW-EQP-0091', 'KW-EQP-0092', 'KW-EQP-0093', 'KW-EQP-0094', 'KW-EQP-0095',
  'KW-EQP-0096', 'KW-EQP-0097', 'KW-EQP-0098', 'KW-EQP-0099', 'KW-EQP-0100',
  'KW-EQP-0101', 'KW-EQP-0102', 'KW-EQP-0103', 'KW-EQP-0104', 'KW-EQP-0105',
  'KW-EQP-0106', 'KW-EQP-0107', 'KW-EQP-0108', 'KW-EQP-0109', 'KW-EQP-0110',
  'KW-EQP-0111', 'KW-EQP-0112', 'KW-EQP-0113'
];

// ── Lease book ─────────────────────────────────────────────────────────
//
// Units that are safe to write lease commitments onto: on 2026-09-04 these
// 38 had NO lease fields and NO notes, so the seed can set them and the
// rollback can null them back without destroying anything a human wrote.
// The three units that already carry real leases (KW-EQP-0104/0105/0106)
// are deliberately NOT in this list.
const LEASE_UNITS = [
  'KW-EQP-0001', 'KW-EQP-0002', 'KW-EQP-0003', 'KW-EQP-0004', 'KW-EQP-0005', 'KW-EQP-0006',
  'KW-EQP-0007', 'KW-EQP-0008', 'KW-EQP-0009', 'KW-EQP-0010', 'KW-EQP-0011', 'KW-EQP-0012',
  'KW-EQP-0013', 'KW-EQP-0014', 'KW-EQP-0015', 'KW-EQP-0016', 'KW-EQP-0018', 'KW-EQP-0019',
  'KW-EQP-0020', 'KW-EQP-0021', 'KW-EQP-0022', 'KW-EQP-0023', 'KW-EQP-0024', 'KW-EQP-0025',
  'KW-EQP-0026', 'KW-EQP-0027', 'KW-EQP-0028', 'KW-EQP-0029', 'KW-EQP-0030', 'KW-EQP-0031',
  'KW-EQP-0032', 'KW-EQP-0033', 'KW-EQP-0034', 'KW-EQP-0035', 'KW-EQP-0036', 'KW-EQP-0037',
  'KW-EQP-0038', 'KW-EQP-0075',
];

// The forecast story, expressed as when each lease ENDS relative to today.
//
// getForwardForecast() sums, per 30/60/90-day bucket, the fraction of that
// bucket each open lease is still live for x its monthly rate. So the shape
// of the chart is decided entirely by the spread of end dates: leases that
// roll off early stop contributing to the later buckets. Loading the book
// towards near-term expiries therefore produces a visible RENEWAL CLIFF —
// day-30 revenue is largely secured, day-90 is not — which is the single
// most useful thing this section can tell a manager.
//
//   endsInDays  days from today the lease is contracted to end
//               (null = open-ended: contributes to every bucket in full)
//   monthly     KWD/month committed
const LEASE_BOOK = [
  // Expiring inside 30 days — the renewal risk list, and the reason the
  // 60- and 90-day buckets fall away.
  { endsInDays:   6, monthly: 2400 },
  { endsInDays:  11, monthly: 1850 },
  { endsInDays:  17, monthly: 3200 },
  { endsInDays:  22, monthly: 1450 },
  { endsInDays:  28, monthly: 2750 },
  { endsInDays:  29, monthly:  950 },

  // Expiring in 31-60 days.
  { endsInDays:  36, monthly: 4100 },
  { endsInDays:  43, monthly: 1600 },
  { endsInDays:  51, monthly: 2250 },
  { endsInDays:  58, monthly: 1150 },

  // Expiring in 61-90 days.
  { endsInDays:  67, monthly: 3400 },
  { endsInDays:  74, monthly: 1900 },
  { endsInDays:  88, monthly: 2600 },

  // Running past the horizon — the secured floor under all three buckets.
  { endsInDays: 118, monthly: 3900 },
  { endsInDays: 145, monthly: 2050 },
  { endsInDays: 171, monthly: 1750 },
  { endsInDays: 204, monthly: 4500 },
  { endsInDays: 246, monthly: 2900 },
  { endsInDays: 310, monthly: 1350 },

  // Open-ended (no contracted end). Contributes in full to every bucket and
  // exercises the null-end-date branch of the forecast.
  { endsInDays: null, monthly: 3050 },
  { endsInDays: null, monthly: 1250 },

  // ── Deliberate edge cases ──────────────────────────────────────────
  // Already past its end date but never returned. The forecast must NOT
  // count it forward and must NOT list it as expiring; it should surface as
  // an overdue return instead.
  { endsInDays: -19, monthly: 2150, edge: 'overdue-return' },
  // End date BEFORE start date — impossible data. Every bucket overlap is
  // empty, so it must contribute zero rather than a negative number.
  { endsInDays:  40, monthly: 1700, edge: 'end-before-start' },
  // Zero rate: excluded by the fetcher's own `lease_monthly_kwd > 0` filter,
  // and proves a rate of zero cannot divide its way into the total.
  { endsInDays:  55, monthly: 0,    edge: 'zero-rate' },
];

const SITES = [
  'Ahmadi Field Camp', 'Shuaiba Industrial', 'Mina Abdullah Refinery',
  'Sabhan Yard', 'Jahra Road Project', 'Burgan Field', 'Doha Port',
  'Subiya Causeway', 'Kuwait City CBD', 'Ardiya Depot',
];
const EQUIP_DESC = [
  'Forklift 3T — daily rental', 'Boom lift 20m — weekly rental',
  'Scissor lift 12m — daily rental', 'Telehandler 4T — weekly rental',
  'Generator 250kVA — monthly rental', 'Air compressor 400cfm — weekly rental',
  'Crane 25T — daily rental', 'Manlift 14m — weekly rental',
];

// ── Scenario timeline ──────────────────────────────────────────────────
//
// Day indices are 0-based from the start of the 180-day window. Each phase
// states what a viewer is supposed to SEE, because that is the whole point
// of a POC dataset.
//
//   quoteMul       multiplier on the baseline quote volume
//   convBase       share of quotes that become orders
//   dispatchShare  share of orders that get a dispatch row at all
//                  (the remainder IS the backlog)
//   leadDays       order → dispatch lead time, in days
//   rentalDays     dispatch → return, in days
//   returnBoost    extra share of dispatches that come back early/faulty
const PHASES = [
  { from:   0, to:  59, name: 'normal-growth',
    quoteMul: 1.00, convBase: 0.44, dispatchShare: 0.92, leadDays: [1, 3], rentalDays: [10, 26], returnBoost: 0.00,
    story: 'Normal business growth — volume drifts up ~35% over two months, nothing dramatic.' },

  { from:  60, to:  74, name: 'quote-spike',
    quoteMul: 2.10, convBase: 0.33, dispatchShare: 0.90, leadDays: [1, 3], rentalDays: [10, 26], returnBoost: 0.00,
    story: 'Temporary quote/order spike — a tender round doubles quotes for two weeks. Conversion DROPS (tender quotes convert worse), so orders rise less than quotes.' },

  { from:  75, to: 104, name: 'dispatch-backlog',
    quoteMul: 1.15, convBase: 0.48, dispatchShare: 0.58, leadDays: [4, 11], rentalDays: [10, 26], returnBoost: 0.00,
    story: 'Dispatch falling behind orders — fleet is saturated. Orders hold up, only ~58% get dispatched, lead time triples, backlog climbs every day.' },

  { from: 105, to: 134, name: 'return-surge',
    quoteMul: 1.05, convBase: 0.46, dispatchShare: 0.86, leadDays: [2, 5], rentalDays: [3, 9], returnBoost: 0.22,
    story: 'Increased return rate — a bad batch of lifts comes back early. Rentals shorten and an extra 22% of dispatches return inside a week.' },

  { from: 135, to: 149, name: 'slowdown',
    quoteMul: 0.42, convBase: 0.36, dispatchShare: 0.70, leadDays: [3, 7], rentalDays: [8, 20], returnBoost: 0.05,
    story: 'Operational slowdown — a site shutdown cuts everything by ~58% for a fortnight.' },

  { from: 150, to: 179, name: 'recovery',
    quoteMul: 1.35, convBase: 0.52, dispatchShare: 0.94, leadDays: [1, 3], rentalDays: [10, 24], returnBoost: 0.00,
    story: 'Recovery after the slowdown — volume returns above the pre-shutdown trend, conversion and dispatch share both recover, backlog drains.' },
];

// Single-day controlled events, on top of whatever phase they land in. Two
// spikes and one drop — enough to be visible, few enough to stay explainable.
const EVENTS = {
  38:  { mul: 2.6, note: 'KOC framework tender — single-day quote burst' },
  93:  { mul: 2.4, note: 'KNPC shutdown package — single-day quote burst' },
  126: { mul: 0.2, note: 'National holiday — near-zero trading day' },
};

// ── Deterministic PRNG ─────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Date helpers (UTC noon, so no DST can shift a day) ─────────────────
const DAY_MS = 86_400_000;
function dayMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}
function addDays(iso, n) {
  return new Date(dayMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}
function dow(iso) { return new Date(dayMs(iso)).getUTCDay(); }

function phaseFor(dayIdx) {
  return PHASES.find(p => dayIdx >= p.from && dayIdx <= p.to) ?? PHASES[PHASES.length - 1];
}

// ── Builder ────────────────────────────────────────────────────────────
function build({ seed = 20260904 } = {}) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const between = ([lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));
  const jitter = (spread) => 1 + (rnd() * 2 - 1) * spread;

  const startDay = addDays(LAST_DAY, -(HISTORY_DAYS - 1));

  const requirements = [];
  const quotations = [];
  const quotationItems = [];
  const dispatches = [];
  const invoices = [];

  // Orders waiting for capacity. Each phase dispatches `dispatchShare` of the
  // day's new orders plus, when there is slack, some of the queue — which is
  // how the backlog built in the congestion phase actually drains in recovery.
  const queue = [];

  let seqReq = 0, seqQuote = 0, seqDisp = 0, seqInv = 0;
  const id = (prefix, n) => `${prefix}${String(n).padStart(4, '0')}`;

  // Anomaly plan — a fixed, small set placed on known days so a demo can
  // point straight at them. Each entry is (dayIdx → kind).
  const ANOMALY_PLAN = [
    [12, 'zero'], [29, 'zero'], [47, 'zero'], [66, 'zero'],
    [88, 'zero'], [111, 'zero'], [143, 'zero'], [171, 'zero'],
    [55, 'negative'], [132, 'negative'],
    [71, 'oversized'], [158, 'oversized'],
    [40, 'null'], [149, 'null'],
    [101, 'duplicate'],
  ];
  const anomalyByDay = new Map(ANOMALY_PLAN);
  const anomalyLog = [];

  for (let dayIdx = 0; dayIdx < HISTORY_DAYS; dayIdx++) {
    const date = addDays(startDay, dayIdx);
    const phase = phaseFor(dayIdx);
    const event = EVENTS[dayIdx];

    // Baseline grows 4.0 → 6.4 quotes/day across the window: the "normal
    // business growth" the first phase is supposed to show, still present
    // underneath every later phase.
    const baseline = 4.0 + 2.4 * (dayIdx / (HISTORY_DAYS - 1));
    const raw = baseline
      * phase.quoteMul
      * DOW_FACTOR[dow(date)]
      * (event?.mul ?? 1)
      * jitter(0.18);
    const quoteCount = Math.max(0, Math.round(raw));

    // Requirements sit one stage above quotes: roughly 1 per 1.4 quotes,
    // because a single requirement often produces more than one quotation.
    const reqCount = Math.max(quoteCount > 0 ? 1 : 0, Math.round(quoteCount / 1.4));
    const dayReqs = [];
    for (let i = 0; i < reqCount; i++) {
      const rid = id('KW-REQ-P26-', ++seqReq);
      const site = pick(SITES);
      dayReqs.push(rid);
      requirements.push({
        requirement_id: rid,
        customer_id: pick(CUSTOMERS),
        created_by: SALES_USER,
        assigned_to: OPS_USER,
        requested_by: 'Site Engineer',
        requirement_summary: `${pick(EQUIP_DESC).split(' —')[0]} for ${site}`,
        location: site,
        start_date: addDays(date, between([2, 8])),
        end_date: addDays(date, between([20, 60])),
        status: 'Quoted',
        priority: rnd() < 0.15 ? 'High' : 'Normal',
        notes: `Rental requirement raised for ${site}. ${MARKER}`,
        created_at: `${date}T08:${String(between([0, 59])).padStart(2, '0')}:00+00:00`,
        updated_at: `${date}T08:${String(between([0, 59])).padStart(2, '0')}:00+00:00`,
      });
    }

    const plannedAnomaly = anomalyByDay.get(dayIdx);

    for (let i = 0; i < quoteCount; i++) {
      const qid = id('KW-QT-P26-', ++seqQuote);
      const customer = pick(CUSTOMERS);
      const requirementId = dayReqs.length ? dayReqs[i % dayReqs.length] : null;
      const desc = pick(EQUIP_DESC);

      // Value: a lognormal-ish spread centred near 1,700 KWD. The tails are
      // what make the median-based outlier rule in operationalAnomalies.js a
      // real test rather than a formality.
      const qty = between([1, 6]);
      const rate = Math.round((120 + rnd() * 680) * 1000) / 1000;
      let subtotal = Math.round(qty * rate * 1000) / 1000;
      let total = Math.round(subtotal * 1.0 * 1000) / 1000;
      let note = `Quotation issued against requirement. ${MARKER}`;
      let anomalyKind = null;

      // Only the FIRST quote of a planned anomaly day carries it, so the
      // count stays exactly what ANOMALY_PLAN says.
      if (i === 0 && plannedAnomaly) {
        anomalyKind = plannedAnomaly;
        if (anomalyKind === 'zero') {
          subtotal = 0; total = 0;
          note = `Pricing not finalised at time of issue. ${MARKER}`;
        } else if (anomalyKind === 'negative') {
          subtotal = -Math.abs(subtotal); total = -Math.abs(total);
          note = `Credit adjustment recorded against this document. ${MARKER}`;
        } else if (anomalyKind === 'oversized') {
          subtotal = Math.round(subtotal * 90 * 1000) / 1000;
          total = subtotal;
          note = `Framework tender pricing — pending commercial review. ${MARKER}`;
        } else if (anomalyKind === 'null') {
          subtotal = null; total = null;
          note = `Total pending — awaiting rate confirmation. ${MARKER}`;
        }
        anomalyLog.push({ day: date, quotation_id: qid, kind: anomalyKind });
      }

      // Conversion: the phase base, nudged by a slow upward drift so the
      // "growth" story is visible in conversion as well as in volume.
      const conv = Math.min(0.95, phase.convBase + 0.05 * (dayIdx / HISTORY_DAYS));
      const won = anomalyKind == null && rnd() < conv;

      // Losing quotes end Sent / Rejected / Expired rather than all sitting
      // in one bucket, so the status pie on the snapshot dashboard is real.
      const status = won
        ? (rnd() < 0.55 ? 'Approved' : 'Invoiced')
        : (rnd() < 0.5 ? 'Sent' : rnd() < 0.6 ? 'Rejected' : 'Expired');

      quotations.push({
        quotation_id: qid,
        requirement_id: requirementId,
        customer_id: customer,
        prepared_by: SALES_USER,
        approved_by: won ? OPS_USER : null,
        status,
        quotation_date: date,
        valid_until: addDays(date, 30),
        subtotal_kwd: subtotal,
        vat_percent: 0,
        vat_amount_kwd: 0,
        total_amount_kwd: total,
        notes: note,
        created_at: `${date}T09:${String(between([0, 59])).padStart(2, '0')}:00+00:00`,
        updated_at: `${date}T09:${String(between([0, 59])).padStart(2, '0')}:00+00:00`,
      });

      quotationItems.push({
        quotation_id: qid,
        description: `${desc} ${MARKER}`,
        quantity: qty,
        unit: 'Days',
        unit_rate_kwd: rate,
        total_kwd: subtotal == null ? null : Math.abs(subtotal),
      });

      // The duplicate anomaly is an exact copy of the row just written,
      // under a new id — same customer, same day, same value.
      if (anomalyKind === 'duplicate') {
        const dupId = id('KW-QT-P26-', ++seqQuote);
        quotations.push({
          ...quotations[quotations.length - 1],
          quotation_id: dupId,
          requirement_id: requirementId,
          notes: `Re-keyed by a second user against ${qid}. ${MARKER}`,
        });
        quotationItems.push({
          quotation_id: dupId,
          description: `${desc} ${MARKER}`,
          quantity: qty, unit: 'Days', unit_rate_kwd: rate,
          total_kwd: subtotal == null ? null : Math.abs(subtotal),
        });
        anomalyLog.push({ day: date, quotation_id: dupId, kind: 'duplicate' });
      }

      if (won) {
        queue.push({ quotation_id: qid, requirement_id: requirementId, orderedOn: date, dayIdx });
      }
    }

    // ── Dispatch stage ────────────────────────────────────────────────
    //
    // Capacity is expressed as a share of the day's new orders, but it is
    // spent on the OLDEST waiting order first. That is why the congestion
    // phase leaves a visible queue and the recovery phase drains it: the
    // rows are the same rows, just dispatched later.
    const newOrdersToday = queue.filter(o => o.dayIdx === dayIdx).length;
    const capacity = Math.round(newOrdersToday * phase.dispatchShare + (rnd() < 0.4 ? 1 : 0));
    let shipped = 0;
    while (shipped < capacity && queue.length) {
      const order = queue.shift();
      shipped += 1;
      const lead = between(phase.leadDays);
      const dispatchDate = addDays(order.orderedOn, lead);
      // Never dispatch into the future: a dispatch dated after the last day
      // of history would show up as "actual data" inside the forecast range.
      if (dispatchDate > LAST_DAY) { queue.unshift(order); break; }

      const early = rnd() < phase.returnBoost;
      const rental = early ? between([2, 6]) : between(phase.rentalDays);
      const returnDate = addDays(dispatchDate, rental);
      const returned = returnDate <= LAST_DAY;

      // Status reflects where the unit actually is on the last day of
      // history, so the snapshot dashboard and the trend agree.
      const status = returned
        ? (early ? 'Returned' : 'Completed')
        : (rnd() < 0.65 ? 'In Transit' : 'Assigned');

      const did = id('KW-DSP-P26-', ++seqDisp);
      dispatches.push({
        dispatch_id: did,
        quotation_id: order.quotation_id,
        requirement_id: order.requirement_id,
        equipment_id: pick(EQUIPMENT),
        assigned_by: DISP_USER,
        driver_name: pick(['Salem A.', 'Yousef M.', 'Rashid K.', 'Talal H.', 'Nasser B.']),
        vehicle_type: pick(['Flatbed', 'Lowbed', 'Boom truck']),
        vehicle_plate: `${between([1, 9])}-${between([10000, 99999])}`,
        destination: pick(SITES),
        status,
        dispatch_date: dispatchDate,
        return_date: returned ? returnDate : null,
        actual_return_date: returned ? returnDate : null,
        notes: `Dispatched to site.${early ? ' Unit returned early — reported faulty.' : ''} ${MARKER}`,
        dispatch_type: 'Full',
        items_total: 1,
        items_dispatched: 1,
        items_returned: returned ? 1 : 0,
        created_at: `${dispatchDate}T06:${String(between([0, 59])).padStart(2, '0')}:00+00:00`,
        updated_at: `${dispatchDate}T06:${String(between([0, 59])).padStart(2, '0')}:00+00:00`,
      });

      // An invoice on delivery keeps the existing revenue KPIs and the
      // Analytics page meaningful over the same window.
      if (returned) {
        const q = quotations.find(x => x.quotation_id === order.quotation_id);
        const amount = q && Number.isFinite(Number(q.total_amount_kwd)) ? Number(q.total_amount_kwd) : 0;
        if (amount > 0) {
          invoices.push({
            invoice_id: id('KW-INV-P26-', ++seqInv),
            quotation_id: order.quotation_id,
            customer_id: q.customer_id,
            created_by: FIN_USER,
            issue_date: returnDate,
            due_date: addDays(returnDate, 30),
            total_amount_kwd: amount,
            amount_paid_kwd: rnd() < 0.72 ? amount : 0,
            status: rnd() < 0.72 ? 'Paid' : 'Sent',
            notes: `Invoice raised on return of equipment. ${MARKER}`,
            created_at: `${returnDate}T12:00:00+00:00`,
          });
        }
      }
    }
  }

  // ── Lease commitments ─────────────────────────────────────────────
  //
  // These are UPDATEs to existing equipment_units rows, not inserts — the
  // fleet already exists. Each is dated backwards from LAST_DAY so the
  // 30/60/90 buckets in getForwardForecast() land where LEASE_BOOK says.
  const leases = LEASE_BOOK.map((entry, i) => {
    const equipmentId = LEASE_UNITS[i % LEASE_UNITS.length];
    // Leases started 1-8 months ago, so every one is genuinely mid-term
    // rather than all beginning on the same day.
    const startedAgo = 30 + ((i * 37) % 210);
    let startDate = addDays(LAST_DAY, -startedAgo);
    let endDate = entry.endsInDays == null ? null : addDays(LAST_DAY, entry.endsInDays);

    // The malformed row: end date deliberately before the start date.
    if (entry.edge === 'end-before-start') {
      startDate = addDays(LAST_DAY, 20);
      endDate = addDays(LAST_DAY, -40);
    }

    const note = entry.edge === 'overdue-return'
      ? `Lease term ended ${endDate} — unit not yet returned. ${MARKER}`
      : entry.edge === 'end-before-start'
        ? `Lease dates require correction. ${MARKER}`
        : entry.edge === 'zero-rate'
          ? `Rate pending contract signature. ${MARKER}`
          : entry.endsInDays == null
            ? `Open-ended lease, rolling monthly. ${MARKER}`
            : `Lease running to ${endDate}. ${MARKER}`;

    return {
      equipment_id: equipmentId,
      lease_monthly_kwd: entry.monthly,
      lease_start_date: startDate,
      lease_end_date: endDate,
      lease_returned_at: null,
      notes: note,
    };
  });

  return {
    marker: MARKER,
    window: { from: startDay, to: LAST_DAY, days: HISTORY_DAYS },
    leases,
    phases: PHASES,
    events: EVENTS,
    anomalies: anomalyLog,
    requirements, quotations, quotationItems, dispatches, invoices,
  };
}

module.exports = { build, MARKER, LAST_DAY, HISTORY_DAYS, PHASES, EVENTS, addDays };
