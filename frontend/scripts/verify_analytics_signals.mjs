/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// Verification harness for the two Analytics-page surfaces the POC leans on:
//
//   1. Priority Signals  (components/analytics/AnomalyRibbon → lib/anomalyRules)
//   2. Forward forecast — booked lease commitments (api/analytics
//      getForwardForecast → components/analytics/OverviewPanel)
//
//   node scripts/verify_analytics_signals.mjs
//
// Section 1 runs the REAL rules (lib/anomalyRules.js) over the REAL screener
// (lib/operationalAnomalies.js) fed with the generated quotations, which is
// exactly the path getTopCustomers → AnomalyRibbon takes at runtime.
//
// Section 2 re-implements getForwardForecast's bucket arithmetic against the
// seeded lease book. That maths lives inline inside the fetcher and cannot be
// imported without a Supabase client, so this is a MODEL of it, not the code
// itself — it is here to prove the seeded lease book has the shape the
// section needs (three non-zero buckets, a visible renewal cliff, edge rows
// that contribute nothing), not to test the fetcher's own correctness.
//
// Exits non-zero on the first failed assertion.
// ═════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));

// src/ is ESM with a .js extension, which Node treats as CommonJS under this
// package.json. Copying to .mjs in a temp dir imports the real files unchanged.
const shim = mkdtempSync(join(tmpdir(), 'jtc-signals-'));
function loadable(relPath, name) {
  const src = readFileSync(join(here, '..', 'src', relPath), 'utf8')
    .replace(/from '\.\.\/lib\/([A-Za-z]+)'/g, "from './$1.mjs'")
    .replace(/from '\.\/([A-Za-z]+)'/g, "from './$1.mjs'");
  const out = join(shim, `${name}.mjs`);
  writeFileSync(out, src, 'utf8');
  return pathToFileURL(out).href;
}

const { screenQuotations } = await import(loadable('lib/operationalAnomalies.js', 'operationalAnomalies'));
const { buildAnomalies } = await import(loadable('lib/anomalyRules.js', 'anomalyRules'));
const { build, LAST_DAY } = require('./pocDataset');

let passed = 0;
const failures = [];
function ok(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (n) => console.log(`\n${n}`);

const d = build();
const DAY = 86_400_000;
const nowMs = Date.parse(`${LAST_DAY}T12:00:00Z`);
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── 1. Priority Signals ────────────────────────────────────────────────
//
// getTopCustomers windows quotations on quotation_date over 365 days by
// default, then screens them. Reproduced here.
section('1. Priority Signals — data-quality rules');

const from365 = dayStr(nowMs - 364 * DAY);
const windowed = d.quotations.filter(q => q.quotation_date >= from365 && q.quotation_date <= LAST_DAY);
const screen = screenQuotations(windowed);

const kpisFrom = (sc, rows) => ({
  zeroValueQuoteCount: rows.filter(q =>
    !['Cancelled', 'Rejected'].includes(q.status) && Number(q.total_amount_kwd ?? 0) === 0).length,
  zeroValueApprovedCount: rows.filter(q =>
    q.status === 'Approved' && Number(q.total_amount_kwd ?? 0) === 0).length,
  zeroValueTotalCount: sc.stats.zeroValue,
  negativeValueCount: sc.stats.negative,
  missingValueCount: sc.stats.missingValue,
  malformedDateCount: sc.stats.malformedDate,
  duplicateQuoteCount: sc.stats.duplicate,
  oversizedQuoteCount: sc.stats.oversized,
  quotesScreened: sc.stats.total,
});

const flags = buildAnomalies({ customers: { kpis: kpisFrom(screen, windowed) } });
const byId = Object.fromEntries(flags.map(f => [f.id, f]));

const seededZeros = d.anomalies.filter(a => a.kind === 'zero').length;
ok('every seeded KWD 0 quote is counted', screen.stats.zeroValue === seededZeros,
  `${screen.stats.zeroValue} screened / ${seededZeros} seeded`);
ok('KWD 0 signal fires', !!byId.zero_value_quotes);
ok('KWD 0 signal uses the required wording',
  /anomalous quotes? detected: quote value is KWD 0\./i.test(byId.zero_value_quotes?.headline ?? ''),
  byId.zero_value_quotes?.headline);
ok('KWD 0 signal reconciles audit count against active count',
  (byId.zero_value_quotes?.detail ?? '').includes('still active in the pipeline'),
  byId.zero_value_quotes?.detail);

ok('missing-value signal fires with required wording',
  /anomalous quotes? detected: quote value is missing\./i.test(byId.missing_value_quotes?.headline ?? ''),
  byId.missing_value_quotes?.headline);
ok('missing-value count matches the seed',
  screen.stats.missingValue === d.anomalies.filter(a => a.kind === 'null').length);

ok('negative-value signal fires with required wording',
  /anomalous quotes? detected: quote value is negative\./i.test(byId.negative_value_quotes?.headline ?? ''),
  byId.negative_value_quotes?.headline);
ok('negative-value count matches the seed',
  screen.stats.negative === d.anomalies.filter(a => a.kind === 'negative').length);

ok('duplicate + oversized rolled into one "second look" signal', !!byId.suspect_quote_values);
ok('duplicates detected', screen.stats.duplicate >= 1, `${screen.stats.duplicate}`);
ok('oversized quotes detected', screen.stats.oversized === 2, `${screen.stats.oversized}`);
ok('suspect signal states the totals are still counted',
  (byId.suspect_quote_values?.detail ?? '').includes('still counted'));

ok('critical signals outrank warnings',
  flags.findIndex(f => f.severity === 'critical') < flags.findIndex(f => f.severity === 'warning'));
ok('no signal has an empty headline or detail',
  flags.every(f => f.headline && f.detail));

section('2. Priority Signals — robustness');
const hostile = {
  'no data at all': {},
  'customers still loading': { customers: undefined },
  'customers errored': { customers: null },
  'kpis missing': { customers: {} },
  'kpis all null': {
    customers: { kpis: {
      zeroValueTotalCount: null, negativeValueCount: null, missingValueCount: null,
      duplicateQuoteCount: null, oversizedQuoteCount: null,
    } },
  },
  'kpis are strings': {
    customers: { kpis: {
      zeroValueTotalCount: 'three', negativeValueCount: '2', missingValueCount: NaN,
      duplicateQuoteCount: {}, oversizedQuoteCount: [],
    } },
  },
  'clean dataset (no defects)': {
    customers: { kpis: {
      zeroValueTotalCount: 0, zeroValueQuoteCount: 0, zeroValueApprovedCount: 0,
      negativeValueCount: 0, missingValueCount: 0, duplicateQuoteCount: 0, oversizedQuoteCount: 0,
    } },
  },
};
for (const [label, input] of Object.entries(hostile)) {
  let out = null, threw = null;
  try { out = buildAnomalies(input); } catch (err) { threw = err; }
  ok(`${label}: does not throw`, threw == null, threw?.message);
  ok(`${label}: returns an array`, Array.isArray(out));
  ok(`${label}: no NaN or undefined in any headline`,
    (out ?? []).every(f => f.headline && !/NaN|undefined/.test(f.headline)));
}
const clean = buildAnomalies(hostile['clean dataset (no defects)']);
ok('a clean dataset raises no data-quality signals',
  !clean.some(f => ['zero_value_quotes', 'missing_value_quotes', 'negative_value_quotes',
    'suspect_quote_values'].includes(f.id)));

// ── 2b. Signal explanations ────────────────────────────────────────────
//
// Clicking a chip used to open the section named by the rule's `promptId`.
// Eight of the fifteen rules name `top_customers`, so the four data-quality
// signals answered "who are our top customers by billing?" — a question
// nobody asked. Each rule now carries an `explain` block that the chat
// renders instead. These assertions cover every rule at once, so a new rule
// added without an explanation fails here rather than shipping as a chip
// that explains nothing.
section('2b. Signal explanations — every rule');

// Every catalogue prompt id, read from the page itself rather than copied,
// so a renamed prompt breaks this check instead of silently orphaning a chip.
const CATALOGUE_IDS = new Set(
  [...readFileSync(join(here, '..', 'src', 'pages', 'analytics', 'AnalyticsPage.jsx'), 'utf8')
    .matchAll(/^\s{4}id: '([a-z_]+)',$/gm)].map(m => m[1])
);
ok('catalogue ids were parsed from AnalyticsPage', CATALOGUE_IDS.size >= 10,
  `found ${CATALOGUE_IDS.size}`);

// A payload deliberately shaped so that every one of the fifteen rules fires
// at once — otherwise a rule with a broken explain block would simply not be
// exercised.
const allFiring = {
  leases: { kpis: {
    monthlyAtRisk30: 24350, expiring30: 12, soonestExpiryLabel: 'Crawler Crane 50T',
  } },
  customers: {
    kpis: {
      ...kpisFrom(screen, windowed),
      largestDeclineName: 'Burgan Contracting', largestDeclinePct: -71,
      totalOutstanding: 358304, worstDebtorName: 'Alghanim Industries',
      worstDebtorOutstanding: 34781,
      top5SharePct: 82, topCustomer: 'Alghanim Industries', topBilled: 34781,
      fastestGrowingName: 'KOC Services', fastestGrowingPct: 140,
    },
    breakdowns: { dataQualityFlags: screen.flags },
  },
  maint:   { kpis: { momDeltaPct: 187, topIssue: { name: 'Hydraulic ram seals', cost: 1240 } } },
  idle:    { kpis: { idleOver30: 42, longestIdleDays: 121, longestIdleLabel: 'Flatbed Trailer 3' } },
  util:    { kpis: { maintDragPct: 35, fleetUtilPct: 22, coldNames: ['Scissor lift 12m', 'Forklift 3T', 'Crane 25T'] } },
  monthly: { kpis: { overdueCount: 9, revenueDeltaPct: 45, revenue: 118400, prevRevenue: 81600 } },
};

const EVERY_RULE = [
  'renewal_risk_30', 'customer_decline', 'outstanding_ar', 'maint_spike', 'idle_stale',
  'concentration_risk', 'workshop_drag', 'util_cold', 'overdue_returns',
  'zero_value_quotes', 'missing_value_quotes', 'negative_value_quotes',
  'suspect_quote_values', 'customer_growing', 'revenue_up',
];

const fired = buildAnomalies(allFiring);
const firedById = Object.fromEntries(fired.map(f => [f.id, f]));

ok('the test payload fires every known rule',
  EVERY_RULE.every(id => firedById[id]),
  EVERY_RULE.filter(id => !firedById[id]).join(', ') || undefined);

ok('no rule fires that this harness does not know about',
  fired.every(f => EVERY_RULE.includes(f.id)),
  fired.filter(f => !EVERY_RULE.includes(f.id)).map(f => f.id).join(', ') || undefined);

for (const id of EVERY_RULE) {
  const f = firedById[id];
  if (!f) continue;                         // already reported above
  const ex = f.explain;
  ok(`${id}: has an explain block`, !!ex && typeof ex === 'object');
  if (!ex) continue;

  ok(`${id}: says what the signal is`, typeof ex.what === 'string' && ex.what.length > 20);
  ok(`${id}: says why it fired`, typeof ex.why === 'string' && ex.why.length > 10);
  ok(`${id}: states how it is measured`, typeof ex.basis === 'string' && ex.basis.length > 20);
  ok(`${id}: offers at least one action`,
    Array.isArray(ex.actions) && ex.actions.length > 0 && ex.actions.every(a => typeof a === 'string' && a.length > 10));
  ok(`${id}: offers at least one metric`,
    Array.isArray(ex.metrics) && ex.metrics.length > 0 &&
    ex.metrics.every(m => m && m.label && m.value != null));

  // The whole point of the change: the related section is offered, not
  // substituted for the answer — and every one must resolve.
  ok(`${id}: every related prompt resolves against the catalogue`,
    Array.isArray(ex.related) && ex.related.length > 0 &&
    ex.related.every(r => r && CATALOGUE_IDS.has(r.promptId) && typeof r.label === 'string'),
    (ex.related ?? []).filter(r => !CATALOGUE_IDS.has(r?.promptId)).map(r => r?.promptId).join(', ') || undefined);

  ok(`${id}: the rule's own promptId still resolves`,
    !f.promptId || CATALOGUE_IDS.has(f.promptId), f.promptId);

  // A formatter that received a null would leak these into prose the manager
  // reads. fmtKwd/fmtPct return "—" instead, and this proves it.
  const prose = [ex.what, ex.why, ex.basis, ...(ex.actions ?? []),
    ...(ex.metrics ?? []).map(m => `${m.label} ${m.value} ${m.hint ?? ''}`)].join(' ');
  ok(`${id}: no NaN, undefined or [object Object] in the prose`,
    !/NaN|undefined|\[object Object\]/.test(prose),
    (prose.match(/NaN|undefined|\[object Object\]/) ?? [])[0]);
}

// The four data-quality rules must name the rows behind their counts. That
// evidence comes from breakdowns.dataQualityFlags, which getTopCustomers
// already ships — no new query — so an empty table here means the wiring
// between the fetcher and the rule has broken.
const RECORD_RULES = {
  zero_value_quotes:    'zeroValue',
  missing_value_quotes: 'missingValue',
  negative_value_quotes:'negative',
};
for (const [id, statKey] of Object.entries(RECORD_RULES)) {
  const rows = firedById[id]?.explain?.records?.rows;
  ok(`${id}: names the affected quotations`, Array.isArray(rows) && rows.length > 0,
    `rows=${rows?.length}`);
  ok(`${id}: one row per screened defect (${screen.stats[statKey]})`,
    (rows?.length ?? 0) === screen.stats[statKey],
    `${rows?.length} vs ${screen.stats[statKey]}`);
  ok(`${id}: every row carries a quotation reference`,
    (rows ?? []).every(r => typeof r.id === 'string' && r.id.length > 0));
}
const suspectRows = firedById.suspect_quote_values?.explain?.records?.rows;
ok('suspect_quote_values: names both duplicates and outliers',
  Array.isArray(suspectRows) &&
  suspectRows.length === screen.stats.duplicate + screen.stats.oversized,
  `${suspectRows?.length} vs ${screen.stats.duplicate + screen.stats.oversized}`);

// The evidence table is optional everywhere else — a rule with nothing to
// list must omit it rather than render an empty table.
ok('rules with no per-row evidence omit the records block entirely',
  ['renewal_risk_30', 'outstanding_ar', 'util_cold', 'revenue_up']
    .every(id => firedById[id]?.explain?.records === undefined));

// Missing evidence must degrade to metrics-only, never throw. This is the
// realistic failure: a cached payload from before breakdowns existed.
for (const [label, breakdowns] of Object.entries({
  'breakdowns absent': undefined,
  'breakdowns null': null,
  'dataQualityFlags absent': {},
  'dataQualityFlags null': { dataQualityFlags: null },
  'dataQualityFlags not an array': { dataQualityFlags: 'oops' },
  'dataQualityFlags holds junk': { dataQualityFlags: [null, 42, {}, { code: 'zero_value' }] },
})) {
  let out = null, threw = null;
  try {
    out = buildAnomalies({ ...allFiring, customers: { ...allFiring.customers, breakdowns } });
  } catch (err) { threw = err; }
  ok(`${label}: does not throw`, threw == null, threw?.message);
  ok(`${label}: the signal still fires with its explanation`,
    !!out?.find(f => f.id === 'zero_value_quotes')?.explain?.what);
}

// A rule that fires with no explain block must still be renderable — the
// component falls back to headline + detail, which every rule always has.
ok('every fired signal has a headline and a detail to fall back on',
  fired.every(f => f.headline && f.detail));

// ── 3. Forward forecast — booked lease commitments ─────────────────────
//
// Model of getForwardForecast(): for each 30/60/90 bucket, sum over every
// open lease the fraction of the bucket it is live for × its monthly rate.
section('3. Forward forecast — booked lease commitments');

// The three leases already in the database on 2026-09-04. All ended in
// August, so they must contribute zero — which is exactly why the section
// reads KWD 0 today and why the seed is needed.
const PRE_EXISTING = [
  { equipment_id: 'KW-EQP-0104', lease_monthly_kwd: 2200, lease_start_date: '2026-05-22', lease_end_date: '2026-08-22' },
  { equipment_id: 'KW-EQP-0105', lease_monthly_kwd: 3800, lease_start_date: '2026-06-25', lease_end_date: '2026-08-25' },
  { equipment_id: 'KW-EQP-0106', lease_monthly_kwd: 1900, lease_start_date: '2026-06-30', lease_end_date: '2026-08-29' },
];

function forecast(units, horizonDays = 90) {
  const horizonDate = dayStr(nowMs + horizonDays * DAY);
  // The fetcher's own PostgREST filters, applied here so the model sees the
  // same rows the query would return.
  const eligible = units.filter(u =>
    u.lease_monthly_kwd != null && Number(u.lease_monthly_kwd) > 0 &&
    u.lease_start_date != null && u.lease_start_date <= horizonDate &&
    u.lease_returned_at == null);

  const edges = [30, 60, 90].filter(e => e <= horizonDays);
  const buckets = edges.map((edge, i) => ({
    edge,
    startMs: nowMs + (i === 0 ? 0 : edges[i - 1]) * DAY,
    endMs: nowMs + edge * DAY,
    kwd: 0, leases: 0, expiring: 0,
  }));
  const expiringSoon = [];
  let activeMonthly = 0;

  for (const u of eligible) {
    const monthly = Number(u.lease_monthly_kwd);
    activeMonthly += monthly;
    const daily = monthly / 30.4375;
    const startMs = Date.parse(`${u.lease_start_date}T12:00:00Z`);
    if (!Number.isFinite(startMs)) continue;
    const endMs = u.lease_end_date ? Date.parse(`${u.lease_end_date}T12:00:00Z`) : Infinity;
    const daysToEnd = endMs === Infinity ? null : Math.floor((endMs - nowMs) / DAY);
    for (const b of buckets) {
      const os = Math.max(startMs, b.startMs, nowMs);
      const oe = Math.min(endMs, b.endMs);
      if (oe <= os) continue;
      b.kwd += daily * (oe - os) / DAY;
      b.leases += 1;
      if (endMs !== Infinity && endMs > b.startMs && endMs <= b.endMs) b.expiring += 1;
    }
    if (daysToEnd != null && daysToEnd >= 0 && daysToEnd <= horizonDays) {
      expiringSoon.push({ id: u.equipment_id, monthly, daysToEnd });
    }
  }
  const at = (e) => Math.round(buckets.find(b => b.edge === e)?.kwd ?? 0);
  return {
    eligible: eligible.length,
    buckets,
    forecast30: at(30),
    forecast60: at(30) + at(60),
    forecast90: at(30) + at(60) + at(90),
    activeMonthly: Math.round(activeMonthly),
    expiringSoon: expiringSoon.sort((a, b) => a.daysToEnd - b.daysToEnd),
  };
}

const before = forecast(PRE_EXISTING);
ok('WITHOUT the seed the forecast is empty (this is today\'s state)',
  before.forecast30 === 0 && before.forecast90 === 0,
  `30d=${before.forecast30} 90d=${before.forecast90}`);

const after = forecast([...d.leases, ...PRE_EXISTING]);
console.log(`    → 30d ${after.forecast30} · 60d ${after.forecast60} · 90d ${after.forecast90} KWD ` +
  `(${after.eligible} open leases, ${after.activeMonthly} KWD/mo committed)`);

ok('all three horizons are non-zero',
  after.forecast30 > 0 && after.forecast60 > 0 && after.forecast90 > 0);
ok('cumulative totals increase with horizon',
  after.forecast30 < after.forecast60 && after.forecast60 < after.forecast90);
ok('per-bucket revenue DECLINES — the renewal cliff is visible',
  after.buckets[0].kwd > after.buckets[1].kwd && after.buckets[1].kwd > after.buckets[2].kwd,
  after.buckets.map(b => `${b.edge}d=${Math.round(b.kwd)}`).join(' '));
ok('the cliff is steep enough to be the headline (90d bucket <70% of 30d)',
  after.buckets[2].kwd < after.buckets[0].kwd * 0.7,
  `${Math.round(after.buckets[2].kwd / after.buckets[0].kwd * 100)}%`);
ok('every bucket has leases expiring inside it (renewal-risk list is populated)',
  after.buckets.every(b => b.expiring > 0),
  after.buckets.map(b => `${b.edge}d:${b.expiring}`).join(' '));
ok('leases expire across all three horizons',
  after.expiringSoon.some(e => e.daysToEnd <= 30) &&
  after.expiringSoon.some(e => e.daysToEnd > 30 && e.daysToEnd <= 60) &&
  after.expiringSoon.some(e => e.daysToEnd > 60 && e.daysToEnd <= 90));
ok('no bucket is negative or NaN',
  after.buckets.every(b => Number.isFinite(b.kwd) && b.kwd >= 0));

section('4. Forward forecast — deliberate edge cases in the lease book');
const zeroRate = d.leases.filter(l => Number(l.lease_monthly_kwd) === 0);
ok('a zero-rate lease exists in the seed', zeroRate.length === 1);
ok('zero-rate lease is excluded by the fetcher\'s own > 0 filter',
  !forecast([...d.leases, ...PRE_EXISTING]).eligible ||
  after.eligible === d.leases.length + PRE_EXISTING.length - zeroRate.length - 0,
  `eligible=${after.eligible} of ${d.leases.length + PRE_EXISTING.length}`);

const backwards = d.leases.filter(l => l.lease_end_date && l.lease_end_date < l.lease_start_date);
ok('an end-before-start lease exists in the seed', backwards.length === 1);
const onlyBackwards = forecast(backwards);
ok('end-before-start contributes exactly zero, never a negative',
  onlyBackwards.forecast90 === 0, `${onlyBackwards.forecast90}`);

const overdue = d.leases.filter(l => l.lease_end_date && l.lease_end_date < LAST_DAY &&
  l.lease_end_date >= l.lease_start_date);
ok('an expired-but-unreturned lease exists in the seed', overdue.length >= 1);
const onlyOverdue = forecast(overdue);
ok('expired-but-unreturned is not counted forward', onlyOverdue.forecast90 === 0);
ok('expired-but-unreturned is not listed as expiring', onlyOverdue.expiringSoon.length === 0);

const openEnded = d.leases.filter(l => l.lease_end_date == null);
ok('open-ended leases exist in the seed', openEnded.length === 2);
const onlyOpen = forecast(openEnded);
ok('open-ended leases contribute equally to all three buckets',
  Math.abs(onlyOpen.buckets[0].kwd - onlyOpen.buckets[2].kwd) < 1,
  onlyOpen.buckets.map(b => Math.round(b.kwd)).join(' / '));

section('5. Rollback safety');
const REAL_LEASED = new Set(PRE_EXISTING.map(u => u.equipment_id));
ok('seed never writes to a unit that already holds a real lease',
  d.leases.every(l => !REAL_LEASED.has(l.equipment_id)));
ok('every seeded lease carries the rollback marker',
  d.leases.every(l => l.notes.includes(d.marker)));
ok('no unit is leased twice',
  new Set(d.leases.map(l => l.equipment_id)).size === d.leases.length);

section(`\nResult: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('All assertions passed.\n');
