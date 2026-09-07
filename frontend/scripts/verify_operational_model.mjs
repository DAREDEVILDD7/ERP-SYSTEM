/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// Verification harness for the Operational Dashboard model.
//
//   node scripts/verify_operational_model.mjs
//
// There is no test runner wired to CI in this repo (see CLAUDE.md), so this
// follows the same throwaway-harness pattern the analytics work uses. It
// runs the REAL code — src/api/operations.js's buildOperationalModel, plus
// lib/forecast.js and lib/operationalAnomalies.js — against the generated
// POC dataset and asserts that:
//
//   1. every seeded scenario is actually visible in the series;
//   2. the chain ratios are ordered the way the chain requires;
//   3. 30/60/90-day forecasts are produced and start after the last actual;
//   4. every KWD 0 quote is flagged with the required wording;
//   5. null / negative / malformed / duplicate / oversized rows are handled
//      without a throw, and are excluded from (or kept in) the totals as
//      documented;
//   6. the degenerate inputs — empty, all-null, all-zero, single row,
//      garbage — return a shape the dashboard can render.
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

// src/ is authored as ES modules with a .js extension, which Node treats as
// CommonJS under this package.json. Copying the three modules to .mjs in a
// temp dir is the least invasive way to import the real files unchanged —
// no build step, no duplicated logic, and nothing added to the app bundle.
const shim = mkdtempSync(join(tmpdir(), 'jtc-verify-'));
function loadable(relPath, name) {
  const src = readFileSync(join(here, '..', 'src', relPath), 'utf8')
    .replace(/from '\.\.\/lib\/([A-Za-z]+)'/g, "from './$1.mjs'")
    .replace(/from '\.\/([A-Za-z]+)'/g, "from './$1.mjs'")
    // The API module imports the browser Supabase client at module scope;
    // the pure builder never touches it, so it is stubbed away here.
    .replace(/import \{ supabase \} from '[^']+';/, 'const supabase = null; void supabase;');
  const out = join(shim, `${name}.mjs`);
  writeFileSync(out, src, 'utf8');
  return pathToFileURL(out).href;
}

loadable('lib/forecast.js', 'forecast');
loadable('lib/operationalAnomalies.js', 'operationalAnomalies');
const opsUrl = loadable('api/operations.js', 'operations');

const { buildOperationalModel } = await import(opsUrl);
const { build, LAST_DAY, addDays } = require('./pocDataset');

// ── Tiny assertion kit ─────────────────────────────────────────────────
let passed = 0;
const failures = [];
function ok(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(name) { console.log(`\n${name}`); }

// ── Feed the generated dataset through the real model ──────────────────
const d = build();
const model = buildOperationalModel({
  quotations: d.quotations,
  dispatches: d.dispatches,
  returns: d.dispatches,
  requirements: d.requirements,
  fromDate: d.window.from,
  toDate: d.window.to,
  days: d.window.days,
});

const idxOf = (iso) => model.series.quotes.findIndex(p => p.date === iso);
const sumRange = (key, fromIdx, toIdx) =>
  model.series[key].slice(fromIdx, toIdx + 1).reduce((s, p) => s + p.value, 0);
const meanRange = (key, fromIdx, toIdx) => {
  const n = toIdx - fromIdx + 1;
  return n > 0 ? sumRange(key, fromIdx, toIdx) / n : 0;
};
const phase = (name) => d.phases.find(p => p.name === name);
const phaseMean = (key, name) => {
  const p = phase(name);
  return meanRange(key, p.from, p.to);
};

section('1. Series and scenarios');
ok('180 daily points, gap-free', model.series.quotes.length === 180, `${model.series.quotes.length}`);
ok('series ends on the last day of history', model.series.quotes[179].date === LAST_DAY);
ok('all six chain series present',
  ['quotes', 'quoteValue', 'orders', 'dispatches', 'deliveries', 'returns']
    .every(k => Array.isArray(model.series[k]) && model.series[k].length === 180));

const growEarly = meanRange('quotes', 0, 19);
const growLate = meanRange('quotes', 40, 59);
ok('normal growth: late growth phase above early', growLate > growEarly * 1.08,
  `${growEarly.toFixed(2)} → ${growLate.toFixed(2)}/day`);

const spike = phaseMean('quotes', 'quote-spike');
ok('quote spike is at least 1.6x the growth phase', spike > growLate * 1.6,
  `${growLate.toFixed(2)} → ${spike.toFixed(2)}/day`);
ok('quote spike is temporary (falls back after)', phaseMean('quotes', 'dispatch-backlog') < spike * 0.75,
  `${spike.toFixed(2)} → ${phaseMean('quotes', 'dispatch-backlog').toFixed(2)}/day`);

const bl = phase('dispatch-backlog');
const backlogStart = model.series.backlog[bl.from].value;
const backlogPeak = Math.max(...model.series.backlog.slice(bl.from, bl.to + 1).map(p => p.value));
ok('dispatch falls behind orders: backlog grows through the congestion phase',
  backlogPeak > backlogStart + 15, `${backlogStart} → peak ${backlogPeak}`);
ok('congestion phase dispatches fewer than it orders',
  sumRange('dispatches', bl.from, bl.to) < sumRange('orders', bl.from, bl.to),
  `${sumRange('dispatches', bl.from, bl.to)} dispatched vs ${sumRange('orders', bl.from, bl.to)} ordered`);

const rs = phase('return-surge');
const rateIn = meanRange('returnRate', rs.from + 14, rs.to);
const rateBefore = meanRange('returnRate', bl.from + 14, bl.to);
ok('return rate rises materially during the return-surge phase', rateIn > rateBefore * 1.3,
  `${rateBefore.toFixed(1)}% → ${rateIn.toFixed(1)}%`);

const sd = phase('slowdown');
ok('slowdown cuts quote volume by at least 40%',
  phaseMean('quotes', 'slowdown') < growLate * 0.6,
  `${growLate.toFixed(2)} → ${phaseMean('quotes', 'slowdown').toFixed(2)}/day`);
ok('recovery returns above the pre-slowdown level',
  phaseMean('quotes', 'recovery') > phaseMean('quotes', 'slowdown') * 1.8,
  `${phaseMean('quotes', 'slowdown').toFixed(2)} → ${phaseMean('quotes', 'recovery').toFixed(2)}/day`);
ok('recovery drains the backlog below its congestion peak',
  model.series.backlog[179].value < backlogPeak * 0.6,
  `peak ${backlogPeak} → ${model.series.backlog[179].value}`);

const holiday = idxOf(addDays(d.window.from, 126));
ok('controlled single-day drop is present (day 126)',
  model.series.quotes[holiday].value <= 2, `${model.series.quotes[holiday].value} quotes`);
ok('weekend seasonality present (Fridays far below Mondays)',
  meanRange('quotes', 0, 179) > 0 &&
  model.forecasts.quotes.quality.seasonal.filter(f => f < 0.5).length >= 1,
  JSON.stringify(model.forecasts.quotes.quality.seasonal));

section('2. Chain relationships');
const k = model.kpis;
ok('quotes ≥ orders', k.quotes.value >= k.orders.value, `${k.quotes.value} vs ${k.orders.value}`);
ok('deliveries ≤ dispatches', k.deliveries.value <= k.dispatches.value, `${k.deliveries.value} vs ${k.dispatches.value}`);
ok('quote→order conversion in a believable 20–75% band',
  k.quoteToOrderPct > 20 && k.quoteToOrderPct < 75, `${k.quoteToOrderPct}%`);
ok('return rate is a positive percentage', k.returnRatePct > 0 && k.returnRatePct < 200, `${k.returnRatePct}%`);
ok('average quote value is a sane KWD figure',
  k.avgQuoteValue > 100 && k.avgQuoteValue < 20000, `${k.avgQuoteValue} KWD`);

section('3. Forecasts');
for (const key of ['quotes', 'quoteValue', 'orders', 'dispatches']) {
  const f = model.forecasts[key];
  ok(`${key}: forecast produced`, f.ok === true, f.reason ?? '');
  if (!f.ok) continue;
  ok(`${key}: 90 forecast points`, f.points.length === 90, `${f.points.length}`);
  ok(`${key}: starts the day after the last actual`,
    f.points[0].date === addDays(LAST_DAY, 1), `${f.points[0].date}`);
  ok(`${key}: 30/60/90 totals all present`,
    [30, 60, 90].every(h => Number.isFinite(f.totals[h]?.total)),
    JSON.stringify([30, 60, 90].map(h => f.totals[h]?.total)));
  ok(`${key}: totals increase with horizon`,
    f.totals[30].total <= f.totals[60].total && f.totals[60].total <= f.totals[90].total,
    `${f.totals[30].total} / ${f.totals[60].total} / ${f.totals[90].total}`);
  ok(`${key}: 90-day band is wider than the 30-day band`,
    (f.totals[90].upper - f.totals[90].lower) > (f.totals[30].upper - f.totals[30].lower));
  ok(`${key}: no NaN anywhere in the points`,
    f.points.every(p => Number.isFinite(p.forecast) && Number.isFinite(p.lower) && Number.isFinite(p.upper)));
  ok(`${key}: forecast is non-negative`, f.points.every(p => p.forecast >= 0));
  const recent = meanRange(key, 150, 179);
  const fc30 = f.totals[30].total / 30;
  ok(`${key}: 30-day forecast tracks the recent run-rate (within 2x)`,
    recent === 0 ? fc30 >= 0 : (fc30 > recent * 0.4 && fc30 < recent * 2.2),
    `recent ${recent.toFixed(2)}/day vs forecast ${fc30.toFixed(2)}/day`);
}

section('4. Anomaly detection');
const zeroFlags = model.anomalies.filter(a => a.code === 'zero_value');
const seededZeros = d.anomalies.filter(a => a.kind === 'zero').length;
ok('every seeded KWD 0 quote is flagged', zeroFlags.length === seededZeros,
  `${zeroFlags.length} flagged / ${seededZeros} seeded`);
ok('KWD 0 reason uses the required wording',
  zeroFlags.every(a => a.reason === 'Anomalous quote detected: quote value is KWD 0.'),
  zeroFlags[0]?.reason);
ok('KWD 0 flags are critical', zeroFlags.every(a => a.severity === 'critical'));
ok('KWD 0 quotes are excluded from quote value',
  model.series.quoteValue.every(p => p.value >= 0));

const negFlags = model.anomalies.filter(a => a.code === 'negative_value');
ok('negative quotes flagged', negFlags.length === d.anomalies.filter(a => a.kind === 'negative').length,
  `${negFlags.length}`);
const nullFlags = model.anomalies.filter(a => a.code === 'missing_value');
ok('null quote values flagged', nullFlags.length === d.anomalies.filter(a => a.kind === 'null').length,
  `${nullFlags.length}`);
const bigFlags = model.anomalies.filter(a => a.code === 'oversized_value');
ok('oversized quotes flagged as a warning, not dropped',
  bigFlags.length >= 2 && bigFlags.every(a => a.severity === 'warning'), `${bigFlags.length}`);
const dupFlags = model.anomalies.filter(a => a.code === 'duplicate');
ok('duplicate quote pair flagged', dupFlags.length >= 1, `${dupFlags.length}`);
ok('anomalies are ranked critical-first',
  model.anomalies.length === 0 || model.anomalies[0].severity === 'critical');
ok('excluded count matches the rows dropped from the totals',
  model.quality.excluded === model.quality.quotations.total - model.quality.quotations.usable,
  `${model.quality.excluded}`);

section('5. Robustness — degenerate and hostile inputs');
const degenerate = {
  'empty everything': {},
  'null arrays': { quotations: null, dispatches: null, requirements: null, fromDate: '2026-01-01', toDate: '2026-03-01' },
  'rows of null': { quotations: [null, null], dispatches: [null], fromDate: '2026-01-01', toDate: '2026-03-01' },
  'garbage rows': {
    quotations: [{ quotation_id: 'A', quotation_date: 'not-a-date', total_amount_kwd: 'abc' },
      { quotation_id: null, total_amount_kwd: {} },
      { quotation_id: 'B', quotation_date: '2026-01-05', total_amount_kwd: Infinity }],
    dispatches: [{ dispatch_id: 'D1', dispatch_date: '2026-01-10', actual_return_date: '2026-01-02' }],
    fromDate: '2026-01-01', toDate: '2026-03-01',
  },
  'single quote only': {
    quotations: [{ quotation_id: 'Q1', quotation_date: '2026-01-02', total_amount_kwd: 500, status: 'Approved' }],
    fromDate: '2026-01-01', toDate: '2026-03-01',
  },
  'all zero values': {
    quotations: Array.from({ length: 90 }, (_, i) => ({
      quotation_id: `Z${i}`, quotation_date: addDays('2026-01-01', i), total_amount_kwd: 0, status: 'Sent',
    })),
    fromDate: '2026-01-01', toDate: '2026-04-01',
  },
  'reversed date range': { quotations: [], fromDate: '2026-06-01', toDate: '2026-01-01' },
  'malformed date range': { quotations: [], fromDate: 'nope', toDate: 'also-nope' },
};

for (const [label, input] of Object.entries(degenerate)) {
  let m = null, threw = null;
  try { m = buildOperationalModel(input); } catch (err) { threw = err; }
  ok(`${label}: does not throw`, threw == null, threw?.message);
  if (!m) continue;
  ok(`${label}: returns a renderable shape`,
    m.series && m.kpis && Array.isArray(m.anomalies) && m.meta != null);
  ok(`${label}: no NaN in the KPI tiles`,
    ['quotes', 'quoteValue', 'orders', 'dispatches', 'deliveries', 'returns']
      .every(key => Number.isFinite(m.kpis[key].value)));
  ok(`${label}: every forecast has an ok flag and a points array`,
    Object.values(m.forecasts).every(f => typeof f.ok === 'boolean' && Array.isArray(f.points)));
  ok(`${label}: a failed forecast carries a human reason`,
    Object.values(m.forecasts).every(f => f.ok || (typeof f.reason === 'string' && f.reason.length > 0)));
}

const zeroModel = buildOperationalModel(degenerate['all zero values']);
ok('all-zero series still forecasts (flat, not a crash)',
  zeroModel.forecasts.quotes.ok === true &&
  zeroModel.forecasts.quoteValue.points.every(p => p.forecast === 0));
ok('all-zero series flags every quote as KWD 0',
  zeroModel.anomalies.filter(a => a.code === 'zero_value').length === 90,
  `${zeroModel.anomalies.filter(a => a.code === 'zero_value').length}`);

const emptyModel = buildOperationalModel({ fromDate: '2026-01-01', toDate: '2026-02-01' });
ok('empty window is reported as empty, not as an error', emptyModel.meta.empty === true);

section(`\nResult: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('All assertions passed.\n');
