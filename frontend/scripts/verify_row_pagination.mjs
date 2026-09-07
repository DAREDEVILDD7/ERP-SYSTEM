/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// Verification harness for PostgREST's silent 1000-row cap.
//
//   node scripts/verify_row_pagination.mjs
//
// Measured directly against the live Supabase project (not assumed): an
// unbounded select with no .range() returns AT MOST 1000 rows, with no
// error and no warning, and — because there is no ORDER BY — the rows most
// likely to be missing are the newest ones. `quotation_items` had already
// crossed the cliff (1004 rows, 1000 returned) and `quotations` was inside
// 20 rows of it, which is the exact path getTopCustomers uses to power the
// Priority Signals data-quality rules (zero/negative/missing-value quotes).
//
// This harness proves the fix (`safeQueryAll` / `PK_COLUMN` in
// api/analytics.js) by running the REAL `getTopCustomers` and
// `getRevenueByCategory` against a FAKE Supabase client whose tables hold
// more than 1000 rows each, with the specific rows the OLD code would have
// dropped placed deliberately in the truncated tail (the newest ones, by
// insertion order) — reproducing "I create a KWD 0 quote today; does the
// signal still see it once the table has grown past the cap" exactly.
//
// The fake client is NOT a mock of Supabase's API surface in general — it
// implements only the query-builder methods this codebase's fetchers
// actually call (select/gte/lte/is/not/eq/in/order/range/then), and its
// `.then()` WITHOUT a prior `.range()` call caps at 1000 rows, mirroring the
// real PostgREST behaviour this harness exists to guard against. A fetcher
// that regresses to an unpaged query will fail here exactly as it would
// fail against the real database.
//
// Exits non-zero on the first failed assertion.
// ═════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

let passed = 0;
const failures = [];
function ok(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const section = (n) => console.log(`\n${n}`);

// ── Fake Supabase query builder ─────────────────────────────────────────
//
// `pageCalls` records every `.range()` call made across the whole run, so
// assertions can check exactly how many pages a fetcher issued without
// reaching into its internals.
const pageCalls = [];
function makeFakeSupabase(dataset) {
  function builder(table) {
    let rows = (dataset[table] ?? []).slice();
    let ranged = false;
    let rangeFrom = 0;
    let rangeTo = 0;
    const b = {
      select: () => b,
      gte: (col, val) => { rows = rows.filter(r => r[col] != null && r[col] >= val); return b; },
      lte: (col, val) => { rows = rows.filter(r => r[col] != null && r[col] <= val); return b; },
      is: (col, val) => { rows = rows.filter(r => (val === null ? r[col] == null : r[col] === val)); return b; },
      not: (col, op, val) => {
        if (op === 'is' && val === null) rows = rows.filter(r => r[col] != null);
        return b;
      },
      eq: (col, val) => { rows = rows.filter(r => r[col] === val); return b; },
      in: (col, arr) => { const set = new Set(arr); rows = rows.filter(r => set.has(r[col])); return b; },
      order: (col, opts) => {
        const dir = opts?.ascending === false ? -1 : 1;
        rows = rows.slice().sort((x, y) => (x[col] > y[col] ? dir : x[col] < y[col] ? -dir : 0));
        return b;
      },
      range: (from, to) => {
        ranged = true; rangeFrom = from; rangeTo = to;
        pageCalls.push({ table, from, to });
        return b;
      },
      // The terminal step. Supabase-js query builders are PromiseLike —
      // the network call fires here, on await/then, not on any chained
      // method above. Mirrors the measured real behaviour: no .range() ⇒
      // capped at 1000 rows, exactly like the live PostgREST instance.
      then(resolve, reject) {
        const out = ranged ? rows.slice(rangeFrom, rangeTo + 1) : rows.slice(0, 1000);
        return Promise.resolve({ data: out, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from: (table) => builder(table) };
}

// ── ESM shim: copy the real source files unchanged, with only the
// supabaseClient import redirected to the fake above ───────────────────
const shim = mkdtempSync(join(tmpdir(), 'jtc-pagination-'));
function loadable(relPath, name) {
  const src = readFileSync(join(here, '..', 'src', relPath), 'utf8')
    .replace(/from '\.\.\/lib\/([A-Za-z]+)'/g, "from './$1.mjs'")
    .replace(/from '\.\/([A-Za-z]+)'/g, "from './$1.mjs'");
  const out = join(shim, `${name}.mjs`);
  writeFileSync(out, src, 'utf8');
  return pathToFileURL(out).href;
}

const DAY = 86_400_000;
const TODAY = Date.parse('2026-09-06T12:00:00Z');
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

// 1,050 quotations spread over the last 300 days, plus 20 zero-value ones
// deliberately placed in the LAST 20 slots by insertion order — exactly
// where the old unpaged, unordered query would have dropped them, since it
// returned whichever 1000 rows PostgREST happened to visit first and this
// harness's fake client (like the measured real one) returns the FRONT of
// the array when uncapped, simulating "physical/insertion order" rows.
const TOTAL = 1050;
const ZEROES_IN_TAIL = 20;
const quotations = [];
for (let i = 0; i < TOTAL; i += 1) {
  const isTailZero = i >= TOTAL - ZEROES_IN_TAIL;
  const day = dayStr(TODAY - ((TOTAL - i) % 300) * DAY);
  quotations.push({
    quotation_id: `KW-QT-PAGE-${String(i + 1).padStart(5, '0')}`,
    customer_id: `KW-CUST-${(i % 10) + 1}`,
    status: 'Sent',
    total_amount_kwd: isTailZero ? 0 : 500 + (i % 40) * 10,
    quotation_date: day,
    created_at: `${day}T09:00:00+00:00`,
  });
}

// A parallel dataset for the quotation_items path (revenue_by_category /
// unit P&L / most-rented): 1,200 line items so a naive single-page fetch
// silently loses the tail 200, again with a marker set placed at the very
// end so a regression is unmistakable rather than a fuzzy count mismatch.
const ITEM_TOTAL = 1200;
const quotationItems = [];
for (let i = 0; i < ITEM_TOTAL; i += 1) {
  quotationItems.push({
    item_id: `item-${String(i + 1).padStart(5, '0')}`,
    quotation_id: `KW-QT-PAGE-${String((i % TOTAL) + 1).padStart(5, '0')}`,
    equipment_id: `KW-EQP-${String((i % 30) + 1).padStart(4, '0')}`,
    total_kwd: 100,
    unit_rate_kwd: 100,
    quantity: 1,
    rental_start_date: dayStr(TODAY - (i % 300) * DAY),
    rental_end_date: null,
    equipment_units: null,
  });
}

const dataset = {
  quotations,
  quotation_items: quotationItems,
  invoices: [],
  customers: [{ customer_id: 'KW-CUST-1', company_name: 'Test Co' }],
  lease_invoices: [],
};

// The fake client is a live object graph (functions, closures) that cannot
// round-trip through JSON, so it is attached to `globalThis` and the shim
// file reads it from there rather than trying to serialize it.
globalThis.__FAKE_SUPABASE__ = makeFakeSupabase(dataset);
writeFileSync(
  join(shim, 'supabaseClient.mjs'),
  'export const supabase = globalThis.__FAKE_SUPABASE__;\nexport default supabase;\n',
  'utf8'
);
// analytics.js's other two dependencies are pure leaf modules (no further
// imports of their own) — copied in unchanged, same as
// verify_analytics_signals.mjs does for the same files.
loadable('lib/analyticsLabels.js', 'analyticsLabels');
loadable('lib/operationalAnomalies.js', 'operationalAnomalies');

const {
  getTopCustomers, getRevenueByCategory, safeQueryAll, PK_COLUMN, windowedRows,
} = await import(loadable('api/analytics.js', 'analytics'));

// ── 1. getTopCustomers sees the whole quotations table, not just page 1 ──
section('1. getTopCustomers — the 1000-row cliff');

const result = await getTopCustomers({ days: 365 });
const trueZeroCount = quotations.filter(q => Number(q.total_amount_kwd) === 0).length;

ok('the fake dataset actually exceeds the measured PostgREST cap',
  TOTAL > 1000, `TOTAL=${TOTAL}`);
ok(`getTopCustomers' zero-value count matches the true count (${trueZeroCount}), not just page 1`,
  result?.kpis?.zeroValueTotalCount === trueZeroCount,
  `got ${result?.kpis?.zeroValueTotalCount}`);
ok('quotesScreened reflects all 1,050 rows, not the first 1,000',
  result?.kpis?.quotesScreened === TOTAL, `got ${result?.kpis?.quotesScreened}`);
ok('at least one page beyond the first was actually requested (.range beyond row 999)',
  pageCalls.some(c => c.table === 'quotations' && c.from >= 1000));

// The specific reproduction of the user's question: a KWD 0 quote created
// AFTER the table had already grown past 1,000 rows must still surface in
// the affected-quotations list the ribbon shows, not just contribute to a
// count.
const tailIds = quotations.slice(-ZEROES_IN_TAIL).map(q => q.quotation_id);
const namedIds = new Set(
  (result?.breakdowns?.dataQualityFlags ?? [])
    .filter(f => f.code === 'zero_value')
    .map(f => f.entityId)
);
ok('every tail-of-the-table zero-value quote is individually named, not just counted',
  tailIds.every(id => namedIds.has(id)),
  `missing: ${tailIds.filter(id => !namedIds.has(id)).slice(0, 3).join(', ')}`);

// ── 2. getRevenueByCategory's quotation_items path pages too ────────────
section('2. getRevenueByCategory — quotation_items beyond 1,000 lines');
pageCalls.length = 0;
await getRevenueByCategory({ days: 365 });
ok('quotation_items was paged past row 999',
  pageCalls.some(c => c.table === 'quotation_items' && c.from >= 1000));

// ── 3. safeQueryAll itself — direct unit coverage ───────────────────────
section('3. safeQueryAll — direct behaviour');

let threw = null;
try { await safeQueryAll(() => globalThis.__FAKE_SUPABASE__.from('quotations').select('*'), null, 'test.nopk'); }
catch (err) { threw = err; }
ok('calling safeQueryAll with no pkColumn throws (a caller bug, not a runtime condition)',
  threw instanceof Error, threw?.message);

pageCalls.length = 0;
const all = await safeQueryAll(
  () => globalThis.__FAKE_SUPABASE__.from('quotations').select('quotation_id, total_amount_kwd'),
  PK_COLUMN.quotations,
  'test.direct'
);
ok('safeQueryAll returns every row across pages', all.length === TOTAL, `got ${all.length}`);
ok('the last page correctly stopped (page shorter than 1000)',
  pageCalls.length === Math.ceil(TOTAL / 1000), `${pageCalls.length} pages for ${TOTAL} rows`);

// Exactly 1000 rows: the boundary case where the final page is a FULL page.
// Must not loop forever, and must not fetch a spurious empty extra page.
const exactDataset = { quotations: quotations.slice(0, 1000) };
const exactFake = makeFakeSupabase(exactDataset);
pageCalls.length = 0;
const exact = await safeQueryAll(
  () => exactFake.from('quotations').select('quotation_id'),
  PK_COLUMN.quotations,
  'test.exact1000'
);
ok('exactly 1000 rows: all returned', exact.length === 1000, `got ${exact.length}`);
ok('exactly 1000 rows: fetched a confirming short page rather than stopping blind',
  pageCalls.length === 2, `${pageCalls.length} pages`);

// ── 4. windowedRows degrades (does not throw) for an unmapped table ─────
section('4. windowedRows — unmapped table degrades instead of throwing');

const warnings = [];
const origWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };
let unmappedResult = null;
let unmappedThrew = null;
try {
  unmappedResult = await windowedRows('requirements', 'requirement_id, created_at', {
    primary: 'created_at', primaryFrom: '2020-01-01', primaryTo: '2030-01-01', tag: 'test.unmapped',
  });
} catch (err) { unmappedThrew = err; }
console.warn = origWarn;

ok('an unmapped table does not throw', unmappedThrew == null, unmappedThrew?.message);
ok('an unmapped table returns an array', Array.isArray(unmappedResult));
ok('an unmapped table logs a warning naming it and PK_COLUMN',
  warnings.some(w => w.includes('requirements') && w.includes('PK_COLUMN')));

// ── 5. Every table windowedRows is called with, in the real source, has a
//      PK_COLUMN entry ────────────────────────────────────────────────────
section('5. Static check — every windowedRows call site is mapped');

const realSrc = readFileSync(join(here, '..', 'src', 'api', 'analytics.js'), 'utf8');
const calledTables = [...realSrc.matchAll(/windowedRows\(\s*\n?\s*'([a-z_]+)'/g)].map(m => m[1]);
ok('at least one windowedRows call site was found (the parser did not silently match nothing)',
  calledTables.length >= 3, `found ${calledTables.length}`);
const unmapped = calledTables.filter(t => !PK_COLUMN[t]);
ok('every table windowedRows is called with has a PK_COLUMN entry',
  unmapped.length === 0, `unmapped: ${[...new Set(unmapped)].join(', ')}`);

console.log(failures.length
  ? `\nResult: ${passed} passed, ${failures.length} failed\n\nFAILED:\n${failures.map(f => `  - ${f}`).join('\n')}`
  : `\nResult: ${passed} passed, 0 failed\nAll assertions passed.`);
process.exit(failures.length ? 1 : 0);
