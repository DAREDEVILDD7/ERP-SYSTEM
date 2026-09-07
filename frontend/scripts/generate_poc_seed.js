/* eslint-disable no-console */
// ═════════════════════════════════════════════════════════════════════════
// Emits frontend/seed_poc_operations_2026.sql from scripts/pocDataset.js.
//
//   node scripts/generate_poc_seed.js
//
// The generated file follows the same conventions as the existing seeds in
// frontend/*.sql — see seed_analytics_test_2026.sql for the reasoning:
//
//   * SET LOCAL session_replication_role = replica for the whole
//     transaction, which suppresses every user-defined trigger. This app's
//     triggers auto-create dispatches on quote approval, overwrite
//     requirement status, flip equipment_units.status, recompute totals and
//     emit a notification per row — all of which would corrupt a seed that
//     supplies those values deliberately.
//   * Every row carries the marker in a text column, and the DELETE block
//     at the top matches strictly on it, so the script is re-runnable and
//     cannot touch anything it did not create.
//   * BEGIN/COMMIT, so a single failure rolls the whole thing back.
// ═════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { build, MARKER } = require('./pocDataset');

const OUT = path.join(__dirname, '..', 'seed_poc_operations_2026.sql');

// PostgreSQL literal. Nulls stay NULL; strings are single-quote escaped;
// numbers are emitted bare so numeric columns do not take a text cast.
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Multi-row INSERTs in chunks. One statement per row would produce a 3,000
// statement file that the Supabase SQL editor takes minutes to parse.
function insertBlock(table, rows, columns, chunk = 200) {
  if (!rows.length) return `-- ${table}: nothing to insert\n`;
  let out = '';
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    out += `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
    out += slice
      .map(r => `  (${columns.map(c => lit(r[c])).join(', ')})`)
      .join(',\n');
    out += ';\n';
  }
  return out;
}

function main() {
  const d = build();
  const NL = String.fromCharCode(10);

  const header = `-- ═════════════════════════════════════════════════════════════════════════
-- POC operational seed — ${d.window.from} → ${d.window.to} (${d.window.days} days)
--
-- GENERATED FILE. Do not hand-edit: change scripts/pocDataset.js and re-run
--   node scripts/generate_poc_seed.js
--
-- Purpose: give the Operational Dashboard enough connected history to show
-- real trends and a defensible 30/60/90-day forecast. The chain is generated
-- forwards
--   requirement → quotation → order (approval) → dispatch → delivery → return
-- so every downstream number is genuinely caused by the one above it.
--
-- Rows written:
--   requirements      ${String(d.requirements.length).padStart(5)}
--   quotations        ${String(d.quotations.length).padStart(5)}
--   quotation_items   ${String(d.quotationItems.length).padStart(5)}
--   dispatches        ${String(d.dispatches.length).padStart(5)}
--   invoices          ${String(d.invoices.length).padStart(5)}
--   lease commitments ${String(d.leases.length).padStart(5)}  (UPDATEs to equipment_units)
--
-- Rows carrying intentionally invalid or borderline values, used to exercise
-- the dashboard’s screening (${d.anomalies.length} quotations):
${d.anomalies.map(a => `--   ${a.day}  ${a.quotation_id.padEnd(18)} ${a.kind}`).join('\n')}
--
-- Triggers are suppressed for the transaction (session_replication_role =
-- replica) because this app's triggers would auto-create dispatches on quote
-- approval, rewrite requirement status, flip equipment_units.status,
-- recompute totals and emit a notification per row. Every derived column is
-- therefore supplied explicitly above.
--
-- Rollback / re-run: every row carries ${MARKER} in a text column and the
-- DELETE block below matches strictly on it.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL session_replication_role = replica;

-- ── Rollback: clear seeded lease commitments ─────────────────────────
-- These are UPDATEs, not inserts, so they are reversed by nulling the four
-- lease columns back out. Matched on the marker in the notes column, and
-- the seed only ever writes to units whose notes were empty, so nothing
-- a human wrote can be lost here.
UPDATE equipment_units SET
  lease_monthly_kwd = NULL, lease_start_date = NULL,
  lease_end_date = NULL, lease_returned_at = NULL, notes = NULL
WHERE notes LIKE '%${MARKER}%';

-- ── Rollback marker deletes (children before parents) ────────────────
DELETE FROM invoices        WHERE notes       LIKE '%${MARKER}%';
DELETE FROM dispatch_items  WHERE notes       LIKE '%${MARKER}%';
DELETE FROM dispatches      WHERE notes       LIKE '%${MARKER}%';
DELETE FROM quotation_items WHERE description LIKE '%${MARKER}%';
DELETE FROM quotations      WHERE notes       LIKE '%${MARKER}%';
DELETE FROM requirement_items WHERE description LIKE '%${MARKER}%';
DELETE FROM requirements    WHERE notes       LIKE '%${MARKER}%';

`;

  const body = [
    '-- ── Requirements ────────────────────────────────────────────────────',
    insertBlock('requirements', d.requirements, [
      'requirement_id', 'customer_id', 'created_by', 'assigned_to', 'requested_by',
      'requirement_summary', 'location', 'start_date', 'end_date', 'status',
      'priority', 'notes', 'created_at', 'updated_at',
    ]),
    '',
    '-- ── Quotations ────────────────────────────────────────────────────',
    insertBlock('quotations', d.quotations, [
      'quotation_id', 'requirement_id', 'customer_id', 'prepared_by', 'approved_by',
      'status', 'quotation_date', 'valid_until', 'subtotal_kwd', 'vat_percent',
      'vat_amount_kwd', 'total_amount_kwd', 'notes', 'created_at', 'updated_at',
    ]),
    '',
    '-- ── Quotation items ─────────────────────────────────────────────────',
    insertBlock('quotation_items', d.quotationItems, [
      'quotation_id', 'description', 'quantity', 'unit', 'unit_rate_kwd',
    ]),
    '',
    '-- ── Dispatches (delivery + return dates carried explicitly) ─────────',
    insertBlock('dispatches', d.dispatches, [
      'dispatch_id', 'quotation_id', 'requirement_id', 'equipment_id', 'assigned_by',
      'driver_name', 'vehicle_type', 'vehicle_plate', 'destination', 'status',
      'dispatch_date', 'return_date', 'actual_return_date', 'notes', 'dispatch_type',
      'items_total', 'items_dispatched', 'items_returned', 'created_at', 'updated_at',
    ]),
    '',
    '-- ── Invoices (raised on delivery, so revenue tracks the chain) ──────',
    insertBlock('invoices', d.invoices, [
      'invoice_id', 'quotation_id', 'customer_id', 'created_by', 'issue_date',
      'due_date', 'total_amount_kwd', 'amount_paid_kwd', 'status', 'notes', 'created_at',
    ]),
    '',
    '-- ── Lease commitments (UPDATEs — the fleet already exists) ─────────',
    d.leases.map(l => (
      `UPDATE equipment_units SET lease_monthly_kwd = ${lit(l.lease_monthly_kwd)}, ` +
      `lease_start_date = ${lit(l.lease_start_date)}, lease_end_date = ${lit(l.lease_end_date)}, ` +
      `lease_returned_at = ${lit(l.lease_returned_at)}, notes = ${lit(l.notes)} ` +
      `WHERE equipment_id = ${lit(l.equipment_id)} AND notes IS NULL;`
    )).join(NL) + NL,
    '',
    'COMMIT;',
    '',
    // The lease rows are UPDATEs at the very end of the file. If the paste into
    // the SQL editor is cut short, or an older copy is run, the inserts land and
    // these do not — and the Analytics forward-forecast section then reads KWD 0
    // with no error anywhere, because the fetcher's maths is fine and simply has
    // no rows. This SELECT is the last statement in the file, so the editor shows
    // its result: a zero lease_commitments says the tail never ran.
    '-- Verification — the SQL editor shows this result. Expect 24 lease rows.',
    'SELECT',
    `  (SELECT count(*) FROM quotations      WHERE notes LIKE '%${MARKER}%') AS quotations,`,
    `  (SELECT count(*) FROM dispatches      WHERE notes LIKE '%${MARKER}%') AS dispatches,`,
    `  (SELECT count(*) FROM invoices        WHERE notes LIKE '%${MARKER}%') AS invoices,`,
    `  (SELECT count(*) FROM equipment_units WHERE notes LIKE '%${MARKER}%') AS lease_commitments;`,
    '',
  ].join('\n');

  fs.writeFileSync(OUT, header + body, 'utf8');

  console.log(`Wrote ${OUT}`);
  console.log(`  window        ${d.window.from} → ${d.window.to} (${d.window.days} days)`);
  console.log(`  requirements  ${d.requirements.length}`);
  console.log(`  quotations    ${d.quotations.length}`);
  console.log(`  quote items   ${d.quotationItems.length}`);
  console.log(`  dispatches    ${d.dispatches.length}`);
  console.log(`  invoices      ${d.invoices.length}`);
  console.log(`  anomalies     ${d.anomalies.length}`);
}

main();
