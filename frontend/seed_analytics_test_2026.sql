-- ═════════════════════════════════════════════════════════════════════════
-- Analytics test seed — 2026-07-01 → 2026-08-14
--
-- Source of truth:
--   * docs/database-schema.md (DDL)
--   * supabase_all_tables.xlsx (real row samples)
--   * Enum lists as reported by information_schema:
--       user_role         Admin, Sales Executive, Operations Manager,
--                         Warehouse Operator, Dispatch Coordinator,
--                         Finance Officer, Maintenance Engineer,
--                         Procurement Manager, Manager, Head of IT,
--                         Viewer, Super Admin
--       equipment_status  Available, Reserved, Dispatched, Maintenance,
--                         Retired, Locked
--       requirement_status Pending Review, Operations Review,
--                         Quotation In Progress, Quoted, Approved,
--                         Rejected, Completed, Cancelled
--       quotation_status  Draft, Sent, Approved, Rejected, Expired,
--                         Invoiced, Cancelled
--       dispatch_status   Pending, Assigned, In Transit, Completed,
--                         Cancelled, Returned              (NO 'Dispatched')
--       maintenance_status Open, In Progress, Completed, Cancelled
--       invoice_status    Draft, Sent, Paid, Overdue, Cancelled
--                                                          (NO 'Partial')
--       procurement_type   Purchase, Lease
--       procurement_status Draft, Pending Approval, Approved, PO Issued,
--                         Partially Delivered, Delivered, Cancelled,
--                         Rejected, Received
--       po_status         Draft, Submitted, Acknowledged,
--                         Partially Delivered, Delivered, Closed,
--                         Cancelled
--
-- Trigger side-effects that would corrupt the seed:
--   trg_quotation_approved_dispatch    auto-creates a dispatch on quote
--                                      approval
--   trg_quotation_requirement_status   overwrites requirement.status
--   trg_maintenance_insert / update    flips equipment_units.status to
--                                      'Maintenance'
--   trg_dispatch_status_change         flips equipment_units.status
--   trg_equipment_return_date          overwrites expected_return_date
--   trg_sync_dispatch_counts           overwrites items_dispatched/returned
--   trg_quotation_items_total          recomputes quotations.total
--   trg_procurement_items_total        recomputes procurements.total
--   trg_*_updated_at                   overwrites updated_at on UPDATE
--   tg_*_notify                        emits notification rows (spam)
--
-- Fix: SET LOCAL session_replication_role = replica for the whole
-- transaction, which suppresses ALL user-defined triggers. Every derived
-- column (totals, counters, dates) is therefore supplied explicitly.
-- LOCAL means it resets automatically at COMMIT.
--
-- Rollback: every seeded row carries the marker [JTC-QA-08] in a text
-- field (notes / description / extension_notes / etc.). The DELETE block
-- at the top matches strictly on that marker, so re-running the script
-- re-seeds cleanly and cannot touch production data.
--
-- Wrapped in BEGIN/COMMIT — if any insert fails, the whole seed rolls back.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- Disable ALL user triggers for the length of this transaction.
SET LOCAL session_replication_role = replica;

-- ── Rollback marker deletes (children before parents) ────────────────
DELETE FROM lease_extensions  WHERE extension_notes LIKE '%[JTC-QA-08]%';
DELETE FROM lease_invoices    WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM invoices          WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM maintenance       WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM dispatch_items    WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM dispatches        WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM quotation_items   WHERE description     LIKE '%[JTC-QA-08]%';
DELETE FROM quotations        WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM procurement_items WHERE description     LIKE '%[JTC-QA-08]%';
DELETE FROM procurements      WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM requirement_items WHERE description     LIKE '%[JTC-QA-08]%';
DELETE FROM requirements      WHERE notes           LIKE '%[JTC-QA-08]%';
DELETE FROM equipment_units   WHERE notes           LIKE '%[JTC-QA-08]%';

-- ── Pre-check: at least one Admin / Super Admin exists ──────────────
DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE is_active = true
      AND role::text IN ('Super Admin','Admin','Operations Manager')
  ) THEN
    RAISE EXCEPTION 'Seed aborted: no active Admin/Super Admin/Operations Manager. Create one and re-run.';
  END IF;
END $seed$;

-- ── Temp lookup for sequence-assigned IDs ────────────────────────────
CREATE TEMP TABLE _qa (
  kind text, key text, id text,
  PRIMARY KEY (kind, key)
) ON COMMIT DROP;

-- Actor helper functions. role is a user_role enum, so we cast on
-- comparison. Each falls back to an admin so no seed insert ever gets a
-- NULL FK for a required column.
CREATE OR REPLACE FUNCTION pg_temp.usr(p_role text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text = p_role
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.admin() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text IN ('Super Admin','Admin')
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.sales() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Sales Executive'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.ops() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Operations Manager'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.disp() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Dispatch Coordinator'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.fin() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Finance Officer'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.maint() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Maintenance Engineer'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.proc() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Procurement Manager'), pg_temp.admin())
$$;

CREATE OR REPLACE FUNCTION pg_temp.qid(k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind='quo' AND key=k
$$;
CREATE OR REPLACE FUNCTION pg_temp.rid(k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind='req' AND key=k
$$;
CREATE OR REPLACE FUNCTION pg_temp.pid(k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind='prc' AND key=k
$$;
CREATE OR REPLACE FUNCTION pg_temp.did(k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind='dsp' AND key=k
$$;
CREATE OR REPLACE FUNCTION pg_temp.eid(k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind='equ' AND key=k
$$;

-- Helper to parse the marker'd key out of a notes/description field.
CREATE OR REPLACE FUNCTION pg_temp.kfrom(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part(p, ' ', 2)
$$;

-- ═════════════════════════════════════════════════════════════════════
-- 1. New equipment_units for renewal-risk (F1) + idle-stale (F5)
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, type_name, serial, cap, status, loc, rate, ptype, lstart, lend, monthly) AS (VALUES
  -- Three active leases ending within 30 days of 2026-08-14 (F1)
  ('LEASE_A',   'Boom Lift',        'QA-BL-A01',  '50 Ton',  'Dispatched'::equipment_status, 'Ahmadi Depot',        150::numeric, 'Lease', '2026-05-22'::date, '2026-08-22'::date, 2200::numeric),
  ('LEASE_B',   'Utility Crane',    'QA-UC-B01',  '50 Ton',  'Dispatched'::equipment_status, 'Shuaiba Yard',        400::numeric, 'Lease', '2026-06-25'::date, '2026-08-25'::date, 3800::numeric),
  ('LEASE_C',   'Diesel Generator', 'QA-DG-C01',  '100 KVA', 'Dispatched'::equipment_status, 'Sabah Al Ahmad Port', 250::numeric, 'Lease', '2026-06-30'::date, '2026-08-29'::date, 1900::numeric),
  -- Chronically-idle Available unit (updated_at forced below) (F5)
  ('IDLE_STALE','Crawler Crane',    'QA-CC-STALE','100 Ton', 'Available'::equipment_status,  'Yard',                200::numeric, 'Purchase', NULL::date,       NULL::date,        NULL::numeric)
),
ins AS (
  INSERT INTO equipment_units (type_id, serial_number, capacity, status, location,
      daily_rate_kwd, procurement_type, lease_start_date, lease_end_date,
      lease_monthly_kwd, notes, created_at, updated_at)
  SELECT
    (SELECT type_id FROM equipment_types WHERE name = s.type_name LIMIT 1),
    s.serial, s.cap, s.status, s.loc, s.rate, s.ptype, s.lstart, s.lend, s.monthly,
    '[JTC-QA-08] ' || s.k,
    COALESCE(s.lstart::timestamptz, '2026-07-01 09:00:00+00'),
    COALESCE(s.lstart::timestamptz, '2026-07-01 09:00:00+00')
  FROM src s
  RETURNING equipment_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'equ', pg_temp.kfrom(notes), equipment_id FROM ins;

-- Force updated_at back on IDLE_STALE so it reads as 74 days idle by
-- 2026-08-14. (Trigger is already off via session_replication_role.)
UPDATE equipment_units
   SET updated_at = '2026-06-01 09:00:00+00'
 WHERE equipment_id = pg_temp.eid('IDLE_STALE');

-- ═════════════════════════════════════════════════════════════════════
-- 2. Requirements (11 new — real customers reused)
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, cust, requester, summary, loc, start, endd, status, prio, created) AS (VALUES
  ('R_KOC_JUL',   'KW-CUST-0006', 'Hassan Shaikh',    'Two All Terrain Cranes for turnaround',  'Ahmadi',        '2026-07-05'::date,'2026-07-25'::date,'Completed'::requirement_status,       'High',   '2026-07-01 08:00:00+00'::timestamptz),
  ('R_KNPC_JUL',  'KW-CUST-0007', 'Hassan Joseph',    'Flatbed trailers for pipe transport',    'Mina Abdullah', '2026-07-06'::date,'2026-07-18'::date,'Completed'::requirement_status,       'Normal', '2026-07-02 08:00:00+00'::timestamptz),
  ('R_PETRO_JUL', 'KW-CUST-0008', 'Tariq Al Dosari',  'Container trailers for scope revision',  'Shuaiba',       '2026-07-08'::date,'2026-07-30'::date,'Completed'::requirement_status,       'Normal', '2026-07-03 08:00:00+00'::timestamptz),
  ('R_HYUN_JUL',  'KW-CUST-0009', 'Mahmoud Hassan',   'Lowbed trailer for equipment move',      'Mina Al Zour',  '2026-07-10'::date,'2026-07-14'::date,'Completed'::requirement_status,       'Normal', '2026-07-05 08:00:00+00'::timestamptz),
  ('R_NBTC_JUL',  'KW-CUST-0010', 'Ali Al Mutairi',   'Prime mover plus drivers for shipment',  'Shuaiba',       '2026-07-15'::date,'2026-08-05'::date,'Approved'::requirement_status,        'High',   '2026-07-12 08:00:00+00'::timestamptz),
  ('R_JTC_JUL',   'KW-CUST-0016', 'Tim',              'Boom Truck fleet ramp',                  'Ahmadi Yard',   '2026-07-20'::date,'2026-08-10'::date,'Completed'::requirement_status,       'High',   '2026-07-17 08:00:00+00'::timestamptz),
  ('R_KHAR_AUG',  'KW-CUST-0015', 'Rashid Siddiqui',  'Crawler cranes for refinery scope',      'Ahmadi',        '2026-08-01'::date,'2026-08-25'::date,'Approved'::requirement_status,        'High',   '2026-07-28 08:00:00+00'::timestamptz),
  ('R_AGIL_AUG',  'KW-CUST-0012', 'Faisal Al Enezi',  'Container trailer for port move',        'Shuwaikh Port', '2026-08-04'::date,'2026-08-10'::date,'Approved'::requirement_status,        'Normal', '2026-08-01 08:00:00+00'::timestamptz),
  ('R_ALGN_AUG',  'KW-CUST-0021', 'Lenvin',           'Tower crane plus boom lifts for site',   'Ahmadi',        '2026-08-05'::date,'2026-08-14'::date,'Approved'::requirement_status,        'High',   '2026-08-02 08:00:00+00'::timestamptz),
  ('R_ALGN_AUG2', 'KW-CUST-0021', 'Lenvin',           'Follow-up fleet expansion',              'Ahmadi',        '2026-08-08'::date,'2026-08-14'::date,'Approved'::requirement_status,        'Normal', '2026-08-06 08:00:00+00'::timestamptz),
  ('R_MPW_AUG',   'KW-CUST-0020', 'Sheikh Fahad',     'Road roller plus heavy trailer for works','Jahra',        '2026-08-10'::date,'2026-08-14'::date,'Operations Review'::requirement_status,'Normal','2026-08-08 08:00:00+00'::timestamptz)
),
ins AS (
  INSERT INTO requirements (customer_id, created_by, requested_by, requirement_summary,
      location, start_date, end_date, status, priority, notes, created_at, updated_at)
  SELECT cust, pg_temp.sales(), requester, summary, loc, start, endd, status, prio,
    '[JTC-QA-08] ' || k, created, created
  FROM src
  RETURNING requirement_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'req', pg_temp.kfrom(notes), requirement_id FROM ins;

-- ═════════════════════════════════════════════════════════════════════
-- 3. Quotations (20)
-- Totals supplied explicitly because trg_quotation_items_total is off.
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, cust, req_key, status, qdate, total, approved) AS (VALUES
  -- KOC July heavy → Aug silent (F2 decline)
  ('Q_KOC_1',   'KW-CUST-0006', 'R_KOC_JUL',  'Approved'::quotation_status, '2026-07-04'::date, 12500.000::numeric, true),
  ('Q_KOC_2',   'KW-CUST-0006', NULL::text,    'Invoiced'::quotation_status, '2026-07-12'::date,  4200.000::numeric, true),
  ('Q_KOC_3',   'KW-CUST-0006', NULL,          'Approved'::quotation_status, '2026-07-22'::date,  3600.000::numeric, true),
  -- KNPC steady both months
  ('Q_KNPC_1',  'KW-CUST-0007', 'R_KNPC_JUL', 'Approved'::quotation_status, '2026-07-06'::date,  2800.000::numeric, true),
  ('Q_KNPC_2',  'KW-CUST-0007', NULL,          'Approved'::quotation_status, '2026-08-05'::date,  3100.000::numeric, true),
  -- Petrofac (medium)
  ('Q_PETRO_1', 'KW-CUST-0008', 'R_PETRO_JUL','Approved'::quotation_status, '2026-07-08'::date,  4750.000::numeric, true),
  ('Q_PETRO_2', 'KW-CUST-0008', NULL,          'Approved'::quotation_status, '2026-08-06'::date,  2400.000::numeric, true),
  -- Hyundai (single job)
  ('Q_HYUN_1',  'KW-CUST-0009', 'R_HYUN_JUL', 'Approved'::quotation_status, '2026-07-10'::date,  6500.000::numeric, true),
  -- NBTC repeat quotes low conversion (F9-like pattern for NBTC too)
  ('Q_NBTC_1',  'KW-CUST-0010', 'R_NBTC_JUL', 'Draft'::quotation_status,    '2026-07-14'::date,  5800.000::numeric, false),
  ('Q_NBTC_2',  'KW-CUST-0010', 'R_NBTC_JUL', 'Sent'::quotation_status,     '2026-07-16'::date,  5900.000::numeric, false),
  ('Q_NBTC_3',  'KW-CUST-0010', 'R_NBTC_JUL', 'Rejected'::quotation_status, '2026-07-19'::date,  6100.000::numeric, false),
  ('Q_NBTC_4',  'KW-CUST-0010', 'R_NBTC_JUL', 'Approved'::quotation_status, '2026-07-25'::date,  5200.000::numeric, true),
  ('Q_NBTC_5',  'KW-CUST-0010', NULL,          'Sent'::quotation_status,     '2026-08-08'::date,  5400.000::numeric, false),
  -- JTC Boom Truck ramp (drives dispatch spike F15)
  ('Q_JTC_1',   'KW-CUST-0016', 'R_JTC_JUL',  'Approved'::quotation_status, '2026-07-19'::date,  7200.000::numeric, true),
  -- Kharafi August
  ('Q_KHAR_1',  'KW-CUST-0015', 'R_KHAR_AUG', 'Approved'::quotation_status, '2026-08-01'::date,  8400.000::numeric, true),
  -- Agility August
  ('Q_AGIL_1',  'KW-CUST-0012', 'R_AGIL_AUG', 'Approved'::quotation_status, '2026-08-04'::date,  1900.000::numeric, true),
  -- Alghanim August (fastest-growing customer F9)
  ('Q_ALGN_1',  'KW-CUST-0021', 'R_ALGN_AUG', 'Approved'::quotation_status, '2026-08-05'::date,  4600.000::numeric, true),
  ('Q_ALGN_2',  'KW-CUST-0021', 'R_ALGN_AUG2','Approved'::quotation_status, '2026-08-09'::date,  3800.000::numeric, true),
  ('Q_ALGN_3',  'KW-CUST-0021', NULL,          'Approved'::quotation_status, '2026-08-12'::date,  2900.000::numeric, true),
  -- MPW draft (unwon)
  ('Q_MPW_1',   'KW-CUST-0020', 'R_MPW_AUG',  'Draft'::quotation_status,    '2026-08-10'::date,  1400.000::numeric, false)
),
ins AS (
  INSERT INTO quotations (requirement_id, customer_id, prepared_by, approved_by, status,
      quotation_date, valid_until, subtotal_kwd, vat_percent, vat_amount_kwd, total_amount_kwd,
      terms_conditions, notes, created_at, updated_at)
  SELECT
    CASE WHEN req_key IS NULL THEN NULL ELSE pg_temp.rid(req_key) END,
    cust, pg_temp.sales(),
    CASE WHEN approved THEN pg_temp.admin() ELSE NULL END,
    status, qdate, qdate + INTERVAL '30 days',
    total, 0, 0, total,
    'Payment within 30 days. Equipment subject to availability.',
    '[JTC-QA-08] ' || k,
    qdate::timestamptz + INTERVAL '9h', qdate::timestamptz + INTERVAL '9h'
  FROM src
  RETURNING quotation_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'quo', pg_temp.kfrom(notes), quotation_id FROM ins;

-- ═════════════════════════════════════════════════════════════════════
-- 4. Quotation items (drive Unit P&L F24 + Revenue-by-category F18)
-- total_kwd column has a DEFAULT of (quantity * unit_rate_kwd) so we
-- rely on it — no manual computation needed.
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO quotation_items (quotation_id, equipment_id, description, quantity, unit,
    unit_rate_kwd, rental_start_date, rental_end_date, discount_percent, discount_amount, created_at)
VALUES
  -- Q_KOC_1: 2x ATC 50 Ton over 20 days + fee = 300*20 + 300*20 + 500 = 12,500
  (pg_temp.qid('Q_KOC_1'),'KW-EQP-0001','[JTC-QA-08] All Terrain Crane 50 Ton - Rental', 20,'Days', 300,'2026-07-05','2026-07-25',0,0,'2026-07-04 09:00:00+00'),
  (pg_temp.qid('Q_KOC_1'),'KW-EQP-0004','[JTC-QA-08] All Terrain Crane 50 Ton - Rental', 20,'Days', 300,'2026-07-05','2026-07-25',0,0,'2026-07-04 09:00:00+00'),
  (pg_temp.qid('Q_KOC_1'), NULL,        '[JTC-QA-08] Mobilization and Driver Allowance',  1,'Lumpsum',500, NULL,NULL,0,0,'2026-07-04 09:00:00+00'),
  -- Q_KOC_2: 4200 = 300 * 14
  (pg_temp.qid('Q_KOC_2'),'KW-EQP-0013','[JTC-QA-08] Boom Truck 100 Ton - Rental',       14,'Days', 300,'2026-07-12','2026-07-25',0,0,'2026-07-12 09:00:00+00'),
  -- Q_KOC_3: 3600 = 300 * 12
  (pg_temp.qid('Q_KOC_3'),'KW-EQP-0005','[JTC-QA-08] Crawler Crane 200 Ton - Rental',    12,'Days', 300,'2026-07-22','2026-08-02',0,0,'2026-07-22 09:00:00+00'),
  -- Q_KNPC_1: 2800 ≈ 233 * 12
  (pg_temp.qid('Q_KNPC_1'),'KW-EQP-0026','[JTC-QA-08] Flatbed Trailer 25 Ton - Rental',  12,'Days', 233.333,'2026-07-06','2026-07-18',0,0,'2026-07-06 09:00:00+00'),
  -- Q_KNPC_2: 3100 = 310 * 10
  (pg_temp.qid('Q_KNPC_2'),'KW-EQP-0023','[JTC-QA-08] Lowbed Trailer 100 Ton - Rental',  10,'Days', 310,'2026-08-05','2026-08-14',0,0,'2026-08-05 09:00:00+00'),
  -- Q_PETRO_1: 4750 ≈ 215.91 * 22
  (pg_temp.qid('Q_PETRO_1'),'KW-EQP-0030','[JTC-QA-08] Container Trailer 100 Ton - Rental',22,'Days',215.909,'2026-07-08','2026-07-29',0,0,'2026-07-08 09:00:00+00'),
  -- Q_PETRO_2: 2400 = 300 * 8
  (pg_temp.qid('Q_PETRO_2'),'KW-EQP-0029','[JTC-QA-08] Container Trailer 50 Ton - Rental', 8,'Days', 300,'2026-08-06','2026-08-13',0,0,'2026-08-06 09:00:00+00'),
  -- Q_HYUN_1: 6500 = 1300 * 5
  (pg_temp.qid('Q_HYUN_1'),'KW-EQP-0024','[JTC-QA-08] Lowbed Trailer 50 Ton - Rental',    5,'Days',1300,'2026-07-10','2026-07-14',0,0,'2026-07-10 09:00:00+00'),
  -- NBTC repeat quotes
  (pg_temp.qid('Q_NBTC_1'),'KW-EQP-0022','[JTC-QA-08] Prime Mover 10 Ton - Rental',      20,'Days', 290,'2026-07-15','2026-08-05',0,0,'2026-07-14 09:00:00+00'),
  (pg_temp.qid('Q_NBTC_2'),'KW-EQP-0022','[JTC-QA-08] Prime Mover 10 Ton - Rental (rev)',20,'Days', 295,'2026-07-15','2026-08-05',0,0,'2026-07-16 09:00:00+00'),
  (pg_temp.qid('Q_NBTC_3'),'KW-EQP-0021','[JTC-QA-08] Prime Mover 25 Ton - Rental (rev)',20,'Days', 305,'2026-07-15','2026-08-05',0,0,'2026-07-19 09:00:00+00'),
  (pg_temp.qid('Q_NBTC_4'),'KW-EQP-0021','[JTC-QA-08] Prime Mover 25 Ton - Rental',      20,'Days', 260,'2026-07-15','2026-08-05',0,0,'2026-07-25 09:00:00+00'),
  (pg_temp.qid('Q_NBTC_5'),'KW-EQP-0022','[JTC-QA-08] Prime Mover 10 Ton follow-up',     10,'Days', 540,'2026-08-08','2026-08-14',0,0,'2026-08-08 09:00:00+00'),
  -- Q_JTC_1: 7200 = (100 + 100 + 127.27) * 22 ish. Use 3 units.
  (pg_temp.qid('Q_JTC_1'),'KW-EQP-0013','[JTC-QA-08] Boom Truck 100 Ton - Rental',       22,'Days', 100,'2026-07-20','2026-08-10',0,0,'2026-07-19 09:00:00+00'),
  (pg_temp.qid('Q_JTC_1'),'KW-EQP-0014','[JTC-QA-08] Boom Truck 25 Ton - Rental',        22,'Days', 100,'2026-07-20','2026-08-10',0,0,'2026-07-19 09:00:00+00'),
  (pg_temp.qid('Q_JTC_1'),'KW-EQP-0015','[JTC-QA-08] Boom Truck 200 Ton - Rental',       22,'Days', 127.273,'2026-07-20','2026-08-10',0,0,'2026-07-19 09:00:00+00'),
  -- Kharafi: 8400 = (168 + 168) * 25
  (pg_temp.qid('Q_KHAR_1'),'KW-EQP-0006','[JTC-QA-08] Crawler Crane 50 Ton - Rental',    25,'Days', 168,'2026-08-01','2026-08-14',0,0,'2026-08-01 09:00:00+00'),
  (pg_temp.qid('Q_KHAR_1'),'KW-EQP-0096','[JTC-QA-08] Crawler Crane 50 Ton - Rental',    25,'Days', 168,'2026-08-01','2026-08-14',0,0,'2026-08-01 09:00:00+00'),
  -- Agility: 1900 = 316.667 * 6
  (pg_temp.qid('Q_AGIL_1'),'KW-EQP-0029','[JTC-QA-08] Container Trailer 50 Ton - Rental', 6,'Days', 316.667,'2026-08-04','2026-08-09',0,0,'2026-08-04 09:00:00+00'),
  -- Q_ALGN_1: 4600 = 400*10 + 60*10
  (pg_temp.qid('Q_ALGN_1'),pg_temp.eid('LEASE_B'),'[JTC-QA-08] Utility Crane 50 Ton - Rental',10,'Days',400,'2026-08-05','2026-08-14',0,0,'2026-08-05 09:00:00+00'),
  (pg_temp.qid('Q_ALGN_1'),pg_temp.eid('LEASE_A'),'[JTC-QA-08] Boom Lift - Rental',           10,'Days', 60,'2026-08-05','2026-08-14',0,0,'2026-08-05 09:00:00+00'),
  -- Q_ALGN_2: 3800 ≈ 542.857 * 7
  (pg_temp.qid('Q_ALGN_2'),'KW-EQP-0093','[JTC-QA-08] Tower Crane 100 Ton - Rental',      7,'Days', 542.857,'2026-08-09','2026-08-14',0,0,'2026-08-09 09:00:00+00'),
  -- Q_ALGN_3: 2900 ≈ 966.667 * 3
  (pg_temp.qid('Q_ALGN_3'),pg_temp.eid('LEASE_C'),'[JTC-QA-08] Diesel Generator 100 KVA - Rental',3,'Days',966.667,'2026-08-12','2026-08-14',0,0,'2026-08-12 09:00:00+00'),
  -- MPW draft: 1400 = 350 * 4
  (pg_temp.qid('Q_MPW_1'),'KW-EQP-0091','[JTC-QA-08] Road Roller - Rental',               4,'Days', 350,'2026-08-10','2026-08-14',0,0,'2026-08-10 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 5. Dispatches (30 — spike 20-25 Jul (F15), overdues (F8), Aug ramp)
-- items_total / items_dispatched / items_returned supplied because
-- trg_sync_dispatch_counts is off.
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, quo, req_k, equip, dest, status, ddate, rdate, adate) AS (VALUES
  ('D_01', 'Q_KOC_1',  'R_KOC_JUL',  'KW-EQP-0001', 'Ahmadi',              'Returned'::dispatch_status,   '2026-07-05'::date,'2026-07-25'::date,'2026-07-25'::date),
  ('D_02', 'Q_KOC_1',  'R_KOC_JUL',  'KW-EQP-0004', 'Ahmadi',              'Returned'::dispatch_status,   '2026-07-05'::date,'2026-07-25'::date,'2026-07-25'::date),
  -- Overdue F8 #1: Pending, no return, dispatch date > 30d before today
  ('D_03', NULL::text, NULL::text,   'KW-EQP-0031', 'Shuaiba Yard',        'Pending'::dispatch_status,    '2026-07-05'::date,NULL::date,        NULL::date),
  ('D_04', 'Q_KNPC_1', 'R_KNPC_JUL', 'KW-EQP-0026', 'Mina Abdullah',       'Returned'::dispatch_status,   '2026-07-06'::date,'2026-07-18'::date,'2026-07-18'::date),
  ('D_05', 'Q_PETRO_1','R_PETRO_JUL','KW-EQP-0030', 'Shuaiba',             'Returned'::dispatch_status,   '2026-07-08'::date,'2026-07-29'::date,'2026-07-29'::date),
  ('D_06', 'Q_HYUN_1', 'R_HYUN_JUL', 'KW-EQP-0024', 'Mina Al Zour',        'Returned'::dispatch_status,   '2026-07-10'::date,'2026-07-14'::date,'2026-07-14'::date),
  ('D_07', 'Q_KOC_2',  NULL,         'KW-EQP-0013', 'Ahmadi',              'Returned'::dispatch_status,   '2026-07-12'::date,'2026-07-25'::date,'2026-07-25'::date),
  -- Overdue F8 #2: In Transit, no return, dispatch date > 30d ago
  ('D_08', NULL,       NULL,         'KW-EQP-0032', 'Ahmadi Depot',        'In Transit'::dispatch_status, '2026-07-12'::date,NULL::date,        NULL::date),
  ('D_09', 'Q_NBTC_4', 'R_NBTC_JUL', 'KW-EQP-0021', 'Shuaiba',             'Returned'::dispatch_status,   '2026-07-15'::date,'2026-08-05'::date,'2026-08-05'::date),
  ('D_10', 'Q_KOC_3',  NULL,         'KW-EQP-0005', 'Ahmadi',              'Returned'::dispatch_status,   '2026-07-22'::date,'2026-08-02'::date,'2026-08-02'::date),
  -- SPIKE 20-25 Jul (F15)
  ('D_11', 'Q_JTC_1',  'R_JTC_JUL',  'KW-EQP-0013', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-20'::date,'2026-08-10'::date,'2026-08-10'::date),
  ('D_12', 'Q_JTC_1',  'R_JTC_JUL',  'KW-EQP-0014', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-20'::date,'2026-08-10'::date,'2026-08-10'::date),
  ('D_13', 'Q_JTC_1',  'R_JTC_JUL',  'KW-EQP-0015', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-21'::date,'2026-08-10'::date,'2026-08-10'::date),
  ('D_14', NULL,       NULL,         'KW-EQP-0071', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-21'::date,'2026-07-28'::date,'2026-07-28'::date),
  ('D_15', NULL,       NULL,         'KW-EQP-0072', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-22'::date,'2026-07-30'::date,'2026-07-30'::date),
  ('D_16', NULL,       NULL,         'KW-EQP-0064', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-23'::date,'2026-08-01'::date,'2026-08-01'::date),
  ('D_17', NULL,       NULL,         'KW-EQP-0065', 'Ahmadi Yard',         'Returned'::dispatch_status,   '2026-07-23'::date,'2026-08-01'::date,'2026-08-01'::date),
  ('D_18', NULL,       NULL,         'KW-EQP-0018', 'Sabah Al Ahmad Port', 'Returned'::dispatch_status,   '2026-07-24'::date,'2026-07-30'::date,'2026-07-30'::date),
  ('D_19', NULL,       NULL,         'KW-EQP-0069', 'Ahmadi',              'Returned'::dispatch_status,   '2026-07-25'::date,'2026-08-01'::date,'2026-08-01'::date),
  ('D_20', NULL,       NULL,         'KW-EQP-0070', 'Ahmadi',              'Returned'::dispatch_status,   '2026-07-25'::date,'2026-08-01'::date,'2026-08-01'::date),
  -- August baseline (Assigned = out but not returned)
  ('D_21', 'Q_KHAR_1', 'R_KHAR_AUG', 'KW-EQP-0006', 'Ahmadi',              'Assigned'::dispatch_status,   '2026-08-01'::date,'2026-08-14'::date,NULL::date),
  ('D_22', 'Q_KHAR_1', 'R_KHAR_AUG', 'KW-EQP-0096', 'Ahmadi',              'Assigned'::dispatch_status,   '2026-08-01'::date,'2026-08-14'::date,NULL::date),
  ('D_23', 'Q_AGIL_1', 'R_AGIL_AUG', 'KW-EQP-0029', 'Shuwaikh Port',       'Returned'::dispatch_status,   '2026-08-04'::date,'2026-08-09'::date,'2026-08-09'::date),
  ('D_24', 'Q_ALGN_1', 'R_ALGN_AUG', pg_temp.eid('LEASE_B'),'Ahmadi',      'Assigned'::dispatch_status,   '2026-08-05'::date,'2026-08-14'::date,NULL::date),
  ('D_25', 'Q_ALGN_1', 'R_ALGN_AUG', pg_temp.eid('LEASE_A'),'Ahmadi',      'Assigned'::dispatch_status,   '2026-08-05'::date,'2026-08-14'::date,NULL::date),
  ('D_26', 'Q_KNPC_2', NULL,         'KW-EQP-0023', 'Mina Abdullah',       'Assigned'::dispatch_status,   '2026-08-05'::date,'2026-08-14'::date,NULL::date),
  ('D_27', 'Q_PETRO_2',NULL,         'KW-EQP-0029', 'Shuaiba',             'Assigned'::dispatch_status,   '2026-08-06'::date,'2026-08-13'::date,NULL::date),
  ('D_28', 'Q_ALGN_2', 'R_ALGN_AUG2','KW-EQP-0093', 'Ahmadi',              'Assigned'::dispatch_status,   '2026-08-09'::date,'2026-08-14'::date,NULL::date),
  ('D_29', 'Q_ALGN_3', NULL,         pg_temp.eid('LEASE_C'),'Ahmadi',      'Assigned'::dispatch_status,   '2026-08-12'::date,'2026-08-14'::date,NULL::date),
  ('D_30', NULL,       NULL,         'KW-EQP-0007', 'Mina Abdullah',       'Pending'::dispatch_status,    '2026-08-13'::date,NULL::date,        NULL::date)
),
ins AS (
  INSERT INTO dispatches (quotation_id, requirement_id, equipment_id, assigned_by,
      destination, status, dispatch_date, return_date, actual_return_date,
      notes, created_at, updated_at, dispatch_type, items_total, items_dispatched, items_returned)
  SELECT
    CASE WHEN quo IS NULL THEN NULL ELSE pg_temp.qid(quo) END,
    CASE WHEN req_k IS NULL THEN NULL ELSE pg_temp.rid(req_k) END,
    equip, pg_temp.disp(), dest, status, ddate, rdate, adate,
    '[JTC-QA-08] ' || k,
    ddate::timestamptz + INTERVAL '9h', ddate::timestamptz + INTERVAL '9h',
    'Full', 1,
    CASE WHEN status IN ('Assigned','In Transit','Returned','Completed') THEN 1 ELSE 0 END,
    CASE WHEN status IN ('Returned','Completed') THEN 1 ELSE 0 END
  FROM src
  RETURNING dispatch_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'dsp', pg_temp.kfrom(notes), dispatch_id FROM ins;

-- Dispatch items (single item per dispatch mirrors real pattern)
INSERT INTO dispatch_items (dispatch_id, equipment_id, dispatch_status, notes, created_at)
SELECT d.dispatch_id, d.equipment_id,
  CASE d.status::text
    WHEN 'Returned'   THEN 'Returned'
    WHEN 'Completed'  THEN 'Returned'
    WHEN 'Assigned'   THEN 'Dispatched'
    WHEN 'In Transit' THEN 'Dispatched'
    ELSE 'Pending'
  END,
  '[JTC-QA-08] ' || pg_temp.kfrom(d.notes),
  d.created_at
FROM dispatches d
WHERE d.notes LIKE '%[JTC-QA-08]%';

-- ═════════════════════════════════════════════════════════════════════
-- 6. Maintenance (14 — F14 repeat-offender, F4 cost outlier, F7 drag)
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO maintenance (equipment_id, reported_by, assigned_to, issue, issue_type,
    service_date, start_date, completion_date, cost_kwd, status, notes, created_at, updated_at)
VALUES
  -- Repeat-offender F14: KW-EQP-0009 (Forklift FLT-004)
  ('KW-EQP-0009', pg_temp.ops(), pg_temp.maint(), 'Cooling system flush and coolant top-up',           'Mechanical','2026-07-04','2026-07-04','2026-07-05', 480, 'Completed'::maintenance_status,   '[JTC-QA-08] Repeat #1',       '2026-07-04 09:00:00+00','2026-07-05 09:00:00+00'),
  ('KW-EQP-0009', pg_temp.ops(), pg_temp.maint(), 'Brake pad replacement and hydraulic line check',   'Mechanical','2026-07-18','2026-07-18','2026-07-20', 620, 'Completed'::maintenance_status,   '[JTC-QA-08] Repeat #2',       '2026-07-18 09:00:00+00','2026-07-20 09:00:00+00'),
  ('KW-EQP-0009', pg_temp.ops(), pg_temp.maint(), 'Front tyre replacement pair',                       'Tyre',      '2026-08-01','2026-08-01','2026-08-02', 410, 'Completed'::maintenance_status,   '[JTC-QA-08] Repeat #3',       '2026-08-01 09:00:00+00','2026-08-02 09:00:00+00'),
  ('KW-EQP-0009', pg_temp.ops(), pg_temp.maint(), 'Recurring hydraulic pressure loss',                 'Mechanical','2026-08-12','2026-08-12', NULL,       350, 'In Progress'::maintenance_status, '[JTC-QA-08] Repeat #4 (open)','2026-08-12 09:00:00+00','2026-08-12 09:00:00+00'),
  -- Cost outlier F4
  ('KW-EQP-0028', pg_temp.ops(), pg_temp.maint(), 'Full engine overhaul - block, pistons, bearings',   'Mechanical','2026-07-23','2026-07-23','2026-08-06',4500, 'Completed'::maintenance_status,   '[JTC-QA-08] Cost outlier',    '2026-07-23 09:00:00+00','2026-08-06 09:00:00+00'),
  -- Workshop drag F7 (Aug cluster)
  ('KW-EQP-0006', pg_temp.ops(), pg_temp.maint(), 'Track tension adjustment and pin wear check',       'Mechanical','2026-08-07','2026-08-07','2026-08-08', 320, 'Completed'::maintenance_status,   '[JTC-QA-08] Aug drag',        '2026-08-07 09:00:00+00','2026-08-08 09:00:00+00'),
  ('KW-EQP-0036', pg_temp.ops(), pg_temp.maint(), 'Fuel injection recalibration',                       'Mechanical','2026-08-09','2026-08-09','2026-08-11', 540, 'Completed'::maintenance_status,   '[JTC-QA-08] Aug drag',        '2026-08-09 09:00:00+00','2026-08-11 09:00:00+00'),
  ('KW-EQP-0003', pg_temp.ops(), pg_temp.maint(), 'Hydraulic leak re-inspection after previous fix',   'Mechanical','2026-08-11','2026-08-11', NULL,       280, 'In Progress'::maintenance_status, '[JTC-QA-08] Aug drag',        '2026-08-11 09:00:00+00','2026-08-11 09:00:00+00'),
  -- Baseline maintenance
  ('KW-EQP-0001', pg_temp.ops(), pg_temp.maint(), 'Routine 500-hour preventive service',                'Other',     '2026-07-11','2026-07-11','2026-07-11', 180, 'Completed'::maintenance_status,   '[JTC-QA-08] Baseline PM',     '2026-07-11 09:00:00+00','2026-07-11 09:00:00+00'),
  ('KW-EQP-0013', pg_temp.ops(), pg_temp.maint(), 'Boom sheave lubrication service',                    'Other',     '2026-07-14','2026-07-14','2026-07-14', 150, 'Completed'::maintenance_status,   '[JTC-QA-08] Baseline PM',     '2026-07-14 09:00:00+00','2026-07-14 09:00:00+00'),
  ('KW-EQP-0026', pg_temp.ops(), pg_temp.maint(), 'Trailer brake service and light check',              'Mechanical','2026-07-27','2026-07-27','2026-07-28', 260, 'Completed'::maintenance_status,   '[JTC-QA-08] Baseline',        '2026-07-27 09:00:00+00','2026-07-28 09:00:00+00'),
  ('KW-EQP-0035', pg_temp.ops(), pg_temp.maint(), 'Alternator replacement',                             'Mechanical','2026-08-03','2026-08-03','2026-08-04', 340, 'Completed'::maintenance_status,   '[JTC-QA-08] Baseline',        '2026-08-03 09:00:00+00','2026-08-04 09:00:00+00'),
  ('KW-EQP-0031', pg_temp.ops(), pg_temp.maint(), 'Refrigeration unit compressor service',              'Mechanical','2026-08-08','2026-08-08','2026-08-10', 470, 'Completed'::maintenance_status,   '[JTC-QA-08] Baseline',        '2026-08-08 09:00:00+00','2026-08-10 09:00:00+00'),
  ('KW-EQP-0079', pg_temp.ops(), pg_temp.maint(), 'Intermittent starting fault - diagnostics needed',   'Other',     '2026-08-13','2026-08-13', NULL,         0, 'Open'::maintenance_status,        '[JTC-QA-08] Diagnostics',     '2026-08-13 09:00:00+00','2026-08-13 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 7. Invoices (15 — F2 decline, F3 A/R, F6 concentration, F10 revenue up)
-- invoice_status enum has NO 'Partial' — partial-paid = status Sent with
-- amount_paid_kwd < total_amount_kwd. Overdue = past due-date & unpaid.
-- Every invoice references a quotation (invoices.quotation_id NOT NULL).
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO invoices (quotation_id, customer_id, created_by, total_amount_kwd,
    amount_paid_kwd, status, issue_date, due_date, payment_date, payment_method,
    notes, created_at, updated_at)
VALUES
  -- KOC July heavy (paid) → drives concentration F6 + reads as decline vs Aug F2
  (pg_temp.qid('Q_KOC_1'), 'KW-CUST-0006', pg_temp.fin(), 12500, 12500, 'Paid'::invoice_status,    '2026-07-06','2026-08-05','2026-07-20','Bank Transfer','[JTC-QA-08] KOC Jul heavy','2026-07-06 09:00:00+00','2026-07-20 09:00:00+00'),
  (pg_temp.qid('Q_KOC_2'), 'KW-CUST-0006', pg_temp.fin(),  4200,  4200, 'Paid'::invoice_status,    '2026-07-14','2026-08-13','2026-07-28','Bank Transfer','[JTC-QA-08] KOC Jul',      '2026-07-14 09:00:00+00','2026-07-28 09:00:00+00'),
  (pg_temp.qid('Q_KOC_3'), 'KW-CUST-0006', pg_temp.fin(),  3600,  3600, 'Paid'::invoice_status,    '2026-07-25','2026-08-14','2026-08-06','Bank Transfer','[JTC-QA-08] KOC Jul',      '2026-07-25 09:00:00+00','2026-08-06 09:00:00+00'),
  -- KNPC steady, Aug unpaid → A/R (F3)
  (pg_temp.qid('Q_KNPC_1'),'KW-CUST-0007', pg_temp.fin(),  2800,  2800, 'Paid'::invoice_status,    '2026-07-08','2026-08-07','2026-07-25','Bank Transfer','[JTC-QA-08] KNPC Jul',     '2026-07-08 09:00:00+00','2026-07-25 09:00:00+00'),
  (pg_temp.qid('Q_KNPC_2'),'KW-CUST-0007', pg_temp.fin(),  3100,     0, 'Sent'::invoice_status,    '2026-08-08','2026-09-07',NULL,        NULL,           '[JTC-QA-08] KNPC Aug unpaid','2026-08-08 09:00:00+00','2026-08-08 09:00:00+00'),
  -- Petrofac partial (Sent + amount_paid > 0 but < total → partial-paid state)
  (pg_temp.qid('Q_PETRO_1'),'KW-CUST-0008',pg_temp.fin(),  4750,  4750, 'Paid'::invoice_status,    '2026-07-10','2026-08-09','2026-07-30','Cheque',       '[JTC-QA-08] Petrofac Jul',  '2026-07-10 09:00:00+00','2026-07-30 09:00:00+00'),
  (pg_temp.qid('Q_PETRO_2'),'KW-CUST-0008',pg_temp.fin(),  2400,  1200, 'Sent'::invoice_status,    '2026-08-06','2026-09-05',NULL,        'Bank Transfer','[JTC-QA-08] Petrofac Aug partial','2026-08-06 09:00:00+00','2026-08-06 09:00:00+00'),
  -- Hyundai (paid in Jul)
  (pg_temp.qid('Q_HYUN_1'),'KW-CUST-0009', pg_temp.fin(),  6500,  6500, 'Paid'::invoice_status,    '2026-07-15','2026-08-14','2026-07-31','Bank Transfer','[JTC-QA-08] Hyundai Jul',   '2026-07-15 09:00:00+00','2026-07-31 09:00:00+00'),
  -- NBTC (only the accepted Q4 invoiced)
  (pg_temp.qid('Q_NBTC_4'),'KW-CUST-0010', pg_temp.fin(),  5200,  5200, 'Paid'::invoice_status,    '2026-07-26','2026-08-25','2026-08-08','Bank Transfer','[JTC-QA-08] NBTC Jul',      '2026-07-26 09:00:00+00','2026-08-08 09:00:00+00'),
  -- JTC ramp (partial-paid Aug)
  (pg_temp.qid('Q_JTC_1'), 'KW-CUST-0016', pg_temp.fin(),  7200,  3600, 'Sent'::invoice_status,    '2026-08-11','2026-09-10',NULL,        'Bank Transfer','[JTC-QA-08] JTC Aug partial','2026-08-11 09:00:00+00','2026-08-11 09:00:00+00'),
  -- Kharafi (unpaid, Sent)
  (pg_temp.qid('Q_KHAR_1'),'KW-CUST-0015', pg_temp.fin(),  8400,     0, 'Sent'::invoice_status,    '2026-08-02','2026-09-01',NULL,        NULL,           '[JTC-QA-08] Kharafi Aug unpaid','2026-08-02 09:00:00+00','2026-08-02 09:00:00+00'),
  -- Agility paid
  (pg_temp.qid('Q_AGIL_1'),'KW-CUST-0012', pg_temp.fin(),  1900,  1900, 'Paid'::invoice_status,    '2026-08-06','2026-09-05','2026-08-13','Bank Transfer','[JTC-QA-08] Agility Aug',    '2026-08-06 09:00:00+00','2026-08-13 09:00:00+00'),
  -- Alghanim growth (F9)
  (pg_temp.qid('Q_ALGN_1'),'KW-CUST-0021', pg_temp.fin(),  4600,     0, 'Sent'::invoice_status,    '2026-08-06','2026-09-05',NULL,        NULL,           '[JTC-QA-08] Alghanim Aug growth','2026-08-06 09:00:00+00','2026-08-06 09:00:00+00'),
  (pg_temp.qid('Q_ALGN_2'),'KW-CUST-0021', pg_temp.fin(),  3800,     0, 'Sent'::invoice_status,    '2026-08-10','2026-09-09',NULL,        NULL,           '[JTC-QA-08] Alghanim Aug growth','2026-08-10 09:00:00+00','2026-08-10 09:00:00+00'),
  (pg_temp.qid('Q_ALGN_3'),'KW-CUST-0021', pg_temp.fin(),  2900,  2900, 'Paid'::invoice_status,    '2026-08-13','2026-09-12','2026-08-14','Bank Transfer','[JTC-QA-08] Alghanim Aug growth','2026-08-13 09:00:00+00','2026-08-14 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 8. Lease invoices (feed lease-revenue + forecast card F25)
-- lease_invoices.status is a plain check-constrained VARCHAR:
--   Draft, Sent, Paid, Cancelled  (NOT Overdue)
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO lease_invoices (equipment_id, period_start, period_end, amount_kwd,
    status, notes, created_by, created_at, paid_at, paid_by)
VALUES
  (pg_temp.eid('LEASE_A'),'2026-07-01','2026-07-31',2200,'Paid','[JTC-QA-08] LEASE_A Jul', pg_temp.fin(),'2026-07-01 09:00:00+00','2026-07-15 09:00:00+00', pg_temp.fin()),
  (pg_temp.eid('LEASE_A'),'2026-08-01','2026-08-22',1580,'Sent','[JTC-QA-08] LEASE_A Aug', pg_temp.fin(),'2026-08-01 09:00:00+00', NULL, NULL),
  (pg_temp.eid('LEASE_B'),'2026-07-01','2026-07-31',3800,'Paid','[JTC-QA-08] LEASE_B Jul', pg_temp.fin(),'2026-07-01 09:00:00+00','2026-07-18 09:00:00+00', pg_temp.fin()),
  (pg_temp.eid('LEASE_B'),'2026-08-01','2026-08-25',3060,'Sent','[JTC-QA-08] LEASE_B Aug', pg_temp.fin(),'2026-08-01 09:00:00+00', NULL, NULL),
  (pg_temp.eid('LEASE_C'),'2026-07-01','2026-07-31',1900,'Paid','[JTC-QA-08] LEASE_C Jul', pg_temp.fin(),'2026-07-01 09:00:00+00','2026-07-14 09:00:00+00', pg_temp.fin()),
  (pg_temp.eid('LEASE_C'),'2026-08-01','2026-08-29',1780,'Sent','[JTC-QA-08] LEASE_C Aug', pg_temp.fin(),'2026-08-01 09:00:00+00', NULL, NULL);

-- ═════════════════════════════════════════════════════════════════════
-- 9. Lease extensions (renewal-history proxy for forecast reliability)
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO lease_extensions (equipment_id, previous_end_date, new_end_date,
    monthly_rate_kwd, extension_notes, created_by, created_at)
VALUES
  (pg_temp.eid('LEASE_A'), '2026-07-22', '2026-08-22', 2200, '[JTC-QA-08] One-month renewal', pg_temp.fin(), '2026-07-15 09:00:00+00'),
  (pg_temp.eid('LEASE_B'), '2026-07-25', '2026-08-25', 3800, '[JTC-QA-08] One-month renewal', pg_temp.fin(), '2026-07-20 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 10. Procurements (5 — one BIG spike F12 + baseline)
-- procurement_status uses 'Received' (in-fleet) enum value.
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, title, kind, vendor, status, total, req_by_date, created) AS (VALUES
  ('P_SPIKE',   '2 x Boom Truck 100 Ton',        'Purchase'::procurement_type,'KW-VND-0004','Received'::procurement_status,12000::numeric, '2026-07-25'::date,'2026-07-15 09:00:00+00'::timestamptz),
  ('P_PARTS',   'Hydraulic hoses and fittings',  'Purchase'::procurement_type,'KW-VND-0003','Received'::procurement_status,  850::numeric, '2026-07-15'::date,'2026-07-10 09:00:00+00'::timestamptz),
  ('P_TYRES',   'Fleet tyre bulk restock',       'Purchase'::procurement_type,'KW-VND-0005','Received'::procurement_status, 2100::numeric, '2026-08-06'::date,'2026-08-01 09:00:00+00'::timestamptz),
  ('P_LEASE_A', 'Boom Lift lease pool',          'Lease'::procurement_type,   'KW-VND-0005','Received'::procurement_status, 2200::numeric, '2026-07-01'::date,'2026-07-01 09:00:00+00'::timestamptz),
  ('P_LEASE_B', 'Utility Crane lease',           'Lease'::procurement_type,   'KW-VND-0003','Received'::procurement_status, 3800::numeric, '2026-07-05'::date,'2026-07-05 09:00:00+00'::timestamptz)
),
ins AS (
  INSERT INTO procurements (title, description, type, vendor_id, requested_by, approved_by,
      status, priority, required_by_date, total_amount_kwd, terms_conditions, notes,
      created_at, updated_at)
  SELECT title, title, kind, vendor, pg_temp.proc(), pg_temp.admin(),
    status, 'Normal', req_by_date, total,
    'Standard procurement terms apply.',
    '[JTC-QA-08] ' || k,
    created, created
  FROM src
  RETURNING procurement_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'prc', pg_temp.kfrom(notes), procurement_id FROM ins;

INSERT INTO procurement_items (procurement_id, equipment_type_id, description, quantity,
    unit, unit_price_kwd, procurement_type, received_qty, received_date, fleet_location,
    capacity, created_at)
VALUES
  (pg_temp.pid('P_SPIKE'),
    (SELECT type_id FROM equipment_types WHERE name='Boom Truck' LIMIT 1),
    '[JTC-QA-08] Boom Truck 100 Ton', 2,'Unit',6000,'Purchase',2,'2026-07-22','Yard','100 Ton','2026-07-15 09:00:00+00'),
  (pg_temp.pid('P_PARTS'), NULL,
    '[JTC-QA-08] Hydraulic hoses', 20,'Unit',42.5,'Purchase',20,'2026-07-14','Workshop','N/A','2026-07-10 09:00:00+00'),
  (pg_temp.pid('P_TYRES'), NULL,
    '[JTC-QA-08] Fleet tyres', 30,'Unit',70,'Purchase',30,'2026-08-05','Yard','N/A','2026-08-01 09:00:00+00'),
  (pg_temp.pid('P_LEASE_A'),
    (SELECT type_id FROM equipment_types WHERE name='Boom Lift' LIMIT 1),
    '[JTC-QA-08] Boom Lift 50 Ton monthly lease',1,'Unit',2200,'Lease',1,'2026-07-01','Ahmadi Depot','50 Ton','2026-07-01 09:00:00+00'),
  (pg_temp.pid('P_LEASE_B'),
    (SELECT type_id FROM equipment_types WHERE name='Utility Crane' LIMIT 1),
    '[JTC-QA-08] Utility Crane 50 Ton monthly lease',1,'Unit',3800,'Lease',1,'2026-07-05','Shuaiba Yard','50 Ton','2026-07-05 09:00:00+00');

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- Post-commit sanity queries (run separately):
--
--   SELECT count(*) FROM requirements    WHERE notes           LIKE '%[JTC-QA-08]%';   -- 11
--   SELECT count(*) FROM quotations      WHERE notes           LIKE '%[JTC-QA-08]%';   -- 20
--   SELECT count(*) FROM quotation_items WHERE description     LIKE '%[JTC-QA-08]%';   -- 26
--   SELECT count(*) FROM dispatches      WHERE notes           LIKE '%[JTC-QA-08]%';   -- 30
--   SELECT count(*) FROM dispatch_items  WHERE notes           LIKE '%[JTC-QA-08]%';   -- 30
--   SELECT count(*) FROM maintenance     WHERE notes           LIKE '%[JTC-QA-08]%';   -- 14
--   SELECT count(*) FROM invoices        WHERE notes           LIKE '%[JTC-QA-08]%';   -- 15
--   SELECT count(*) FROM lease_invoices  WHERE notes           LIKE '%[JTC-QA-08]%';   -- 6
--   SELECT count(*) FROM lease_extensions WHERE extension_notes LIKE '%[JTC-QA-08]%';  -- 2
--   SELECT count(*) FROM procurements    WHERE notes           LIKE '%[JTC-QA-08]%';   -- 5
--   SELECT count(*) FROM procurement_items WHERE description   LIKE '%[JTC-QA-08]%';   -- 5
--   SELECT count(*) FROM equipment_units WHERE notes           LIKE '%[JTC-QA-08]%';   -- 4
--
-- To roll back: run only the DELETE block at the top of this file inside
-- BEGIN/COMMIT. It matches strictly on the [JTC-QA-08] marker and does not
-- touch any production data.
-- ═════════════════════════════════════════════════════════════════════════
