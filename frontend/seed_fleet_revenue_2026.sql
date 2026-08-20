-- ═══════════════════════════════════════════════════════════════════════════
-- Fleet revenue optimisation seed — 2026-07-01 → 2026-08-16
-- Marker: [JTC-QA-09]
--
-- Six equipment units with deliberately varied utilisation, pricing and
-- collection patterns.  Together they produce five testable insight signals
-- for the planned fleet_revenue_optimization analytics section (§4.15):
--
--   IDLE ALERTS
--     FLEET_A2    — All Terrain Crane 50T, idle 43 d (critical)
--     FLEET_PM    — Prime Mover 25T,       idle 33 d (notable)
--     FLEET_A1    — All Terrain Crane 50T, idle 20 d (marginal)
--
--   DOWNTIME OPPORTUNITY COST
--     FLEET_DOWN  — Boom Truck 100T, in workshop since 2026-08-03 (13 d).
--                   Historical dispatch rate KWD 300/d → KWD 3,900 forgone.
--
--   PEER PRICING GAP  (All Terrain Crane 50T peer group)
--     FLEET_LRATE — KWD 160/d average; FLEET_A1/A2 earn KWD 280/d.
--                   41 % below peer rate — pricing or allocation problem.
--
--   MAINTENANCE BURDEN
--     FLEET_DOWN  — KWD 1,850 maint vs KWD 6,900 revenue (26.8 %).
--
--   POOR COLLECTION RATE
--     FLEET_PCOLL — KWD 7,700 invoiced, KWD 800 collected (10.4 %).
--
-- Conventions (identical to seed_analytics_test_2026.sql / [JTC-QA-08]):
--   • SET LOCAL session_replication_role = replica disables all user triggers
--   • All derived columns (totals, counters) are supplied explicitly
--   • DELETE block at top re-seeds cleanly without touching production rows
--   • Wrapped in BEGIN / COMMIT — any failure rolls the whole seed back
--
-- Rollback: run only the DELETE block inside BEGIN / COMMIT.
-- Matches strictly on [JTC-QA-09] — cannot touch production data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL session_replication_role = replica;

-- ── Rollback marker deletes (children before parents) ─────────────────────
DELETE FROM dispatch_items  WHERE notes        LIKE '%[JTC-QA-09]%';
DELETE FROM invoices        WHERE notes        LIKE '%[JTC-QA-09]%';
DELETE FROM maintenance     WHERE notes        LIKE '%[JTC-QA-09]%';
DELETE FROM dispatches      WHERE notes        LIKE '%[JTC-QA-09]%';
DELETE FROM quotation_items WHERE description  LIKE '%[JTC-QA-09]%';
DELETE FROM quotations      WHERE notes        LIKE '%[JTC-QA-09]%';
DELETE FROM equipment_units WHERE notes        LIKE '%[JTC-QA-09]%';

-- ── Pre-check: at least one active admin / ops manager ────────────────────
DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE is_active = true
      AND role::text IN ('Super Admin','Admin','Operations Manager')
  ) THEN
    RAISE EXCEPTION
      'Seed aborted: no active Admin/Super Admin/Operations Manager. Create one and re-run.';
  END IF;
END $seed$;

-- ── Temp ID store ─────────────────────────────────────────────────────────
CREATE TEMP TABLE _qa (
  kind text, key text, id text,
  PRIMARY KEY (kind, key)
) ON COMMIT DROP;

-- Role helpers
CREATE OR REPLACE FUNCTION pg_temp.usr(p_role text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text = p_role
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.admin() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text IN ('Super Admin','Admin')
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.sales() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Sales Executive'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.ops() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Operations Manager'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.disp() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Dispatch Coordinator'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.fin() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Finance Officer'), pg_temp.admin())
$$;
CREATE OR REPLACE FUNCTION pg_temp.maint() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr('Maintenance Engineer'), pg_temp.admin())
$$;

-- ID lookup helpers
CREATE OR REPLACE FUNCTION pg_temp.eid(k text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind = 'equ' AND key = k
$$;
CREATE OR REPLACE FUNCTION pg_temp.qid(k text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind = 'quo' AND key = k
$$;
CREATE OR REPLACE FUNCTION pg_temp.did(k text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa WHERE kind = 'dsp' AND key = k
$$;

-- Extracts the key word from '[JTC-QA-09] KEY'
CREATE OR REPLACE FUNCTION pg_temp.kfrom(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part(p, ' ', 2)
$$;

-- ═════════════════════════════════════════════════════════════════════
-- 1. Equipment units (6)
--
-- Three All Terrain Cranes in the same type-peer group so the pricing
-- gap between FLEET_A1/A2 (KWD 280/d) and FLEET_LRATE (KWD 160/d)
-- is detectable by the analytics query.
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, type_name, serial, cap, status, loc, rate) AS (VALUES
  ('FLEET_A1',    'All Terrain Crane', 'QA-ATC-F01', '50 Ton',  'Available'::equipment_status,   'Yard',           280::numeric),
  ('FLEET_A2',    'All Terrain Crane', 'QA-ATC-F02', '50 Ton',  'Available'::equipment_status,   'Yard',           280::numeric),
  ('FLEET_LRATE', 'All Terrain Crane', 'QA-ATC-LOW', '50 Ton',  'Available'::equipment_status,   'Yard',           160::numeric),
  ('FLEET_PM',    'Prime Mover',       'QA-PM-F01',  '25 Ton',  'Available'::equipment_status,   'Shuwaikh Yard',  200::numeric),
  ('FLEET_DOWN',  'Boom Truck',        'QA-BT-F01',  '100 Ton', 'Maintenance'::equipment_status, 'Workshop',       300::numeric),
  ('FLEET_PCOLL', 'Flatbed Trailer',   'QA-FT-F01',  '25 Ton',  'Available'::equipment_status,   'Ahmadi Depot',   220::numeric)
),
ins AS (
  INSERT INTO equipment_units
    (type_id, serial_number, capacity, status, location,
     daily_rate_kwd, procurement_type, notes, created_at, updated_at)
  SELECT
    (SELECT type_id FROM equipment_types WHERE name = s.type_name LIMIT 1),
    s.serial, s.cap, s.status, s.loc, s.rate,
    'Purchase',
    '[JTC-QA-09] ' || s.k,
    '2026-01-15 09:00:00+00',
    '2026-01-15 09:00:00+00'
  FROM src s
  RETURNING equipment_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'equ', pg_temp.kfrom(notes), equipment_id FROM ins;

-- ═════════════════════════════════════════════════════════════════════
-- 2. Quotations (10) — one per rental period, all status = Invoiced.
-- Totals supplied explicitly (trg_quotation_items_total is off).
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, cust, qdate, total) AS (VALUES
  -- FLEET_A1: two rentals at KWD 280/d
  ('Q_FA1_1',  'KW-CUST-0006', '2026-07-04'::date,  3360.000::numeric),  -- 12 d × 280
  ('Q_FA1_2',  'KW-CUST-0007', '2026-07-21'::date,  1680.000::numeric),  --  6 d × 280
  -- FLEET_A2: one short rental, then 43 d idle
  ('Q_FA2_1',  'KW-CUST-0008', '2026-06-30'::date,   840.000::numeric),  --  3 d × 280
  -- FLEET_LRATE: two rentals at KWD 160/d (41 % below peer)
  ('Q_FLRT1',  'KW-CUST-0010', '2026-07-01'::date,  2240.000::numeric),  -- 14 d × 160
  ('Q_FLRT2',  'KW-CUST-0020', '2026-07-31'::date,  1120.000::numeric),  --  7 d × 160
  -- FLEET_PM: one rental at KWD 200/d, then 33 d idle
  ('Q_FPM',    'KW-CUST-0009', '2026-06-30'::date,  2600.000::numeric),  -- 13 d × 200
  -- FLEET_DOWN: two rentals at KWD 300/d, then workshop
  ('Q_FDWN1',  'KW-CUST-0015', '2026-06-30'::date,  3300.000::numeric),  -- 11 d × 300
  ('Q_FDWN2',  'KW-CUST-0006', '2026-07-20'::date,  3600.000::numeric),  -- 12 d × 300
  -- FLEET_PCOLL: two rentals at KWD 220/d, invoices largely uncollected
  ('Q_FPCO1',  'KW-CUST-0012', '2026-07-02'::date,  3520.000::numeric),  -- 16 d × 220
  ('Q_FPCO2',  'KW-CUST-0021', '2026-07-23'::date,  4180.000::numeric)   -- 19 d × 220
),
ins AS (
  INSERT INTO quotations
    (customer_id, prepared_by, approved_by, status, quotation_date, valid_until,
     subtotal_kwd, vat_percent, vat_amount_kwd, total_amount_kwd,
     terms_conditions, notes, created_at, updated_at)
  SELECT
    cust, pg_temp.sales(), pg_temp.admin(),
    'Invoiced'::quotation_status,
    qdate, qdate + INTERVAL '30 days',
    total, 0, 0, total,
    'Payment within 30 days. Equipment subject to availability.',
    '[JTC-QA-09] ' || k,
    qdate::timestamptz + INTERVAL '9h',
    qdate::timestamptz + INTERVAL '9h'
  FROM src
  RETURNING quotation_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'quo', pg_temp.kfrom(notes), quotation_id FROM ins;

-- ═════════════════════════════════════════════════════════════════════
-- 3. Quotation items — one line per rental.
-- total_kwd is a computed DEFAULT (quantity * unit_rate_kwd), omitted.
-- equipment_id here is what links revenue to a specific unit in the
-- analytics query; it must match the dispatch's equipment_id.
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO quotation_items
  (quotation_id, equipment_id, description, quantity, unit,
   unit_rate_kwd, rental_start_date, rental_end_date,
   discount_percent, discount_amount, created_at)
VALUES
  -- FLEET_A1 rental 1: 12 d × 280 = 3,360
  (pg_temp.qid('Q_FA1_1'), pg_temp.eid('FLEET_A1'),
   '[JTC-QA-09] All Terrain Crane 50T — Rental',
   12, 'Days', 280, '2026-07-05', '2026-07-16', 0, 0, '2026-07-04 09:00:00+00'),
  -- FLEET_A1 rental 2: 6 d × 280 = 1,680
  (pg_temp.qid('Q_FA1_2'), pg_temp.eid('FLEET_A1'),
   '[JTC-QA-09] All Terrain Crane 50T — Rental',
   6, 'Days', 280, '2026-07-22', '2026-07-27', 0, 0, '2026-07-21 09:00:00+00'),
  -- FLEET_A2: 3 d × 280 = 840
  (pg_temp.qid('Q_FA2_1'), pg_temp.eid('FLEET_A2'),
   '[JTC-QA-09] All Terrain Crane 50T — Rental',
   3, 'Days', 280, '2026-07-01', '2026-07-03', 0, 0, '2026-06-30 09:00:00+00'),
  -- FLEET_LRATE rental 1: 14 d × 160 = 2,240
  (pg_temp.qid('Q_FLRT1'), pg_temp.eid('FLEET_LRATE'),
   '[JTC-QA-09] All Terrain Crane 50T — Rental',
   14, 'Days', 160, '2026-07-02', '2026-07-15', 0, 0, '2026-07-01 09:00:00+00'),
  -- FLEET_LRATE rental 2: 7 d × 160 = 1,120
  (pg_temp.qid('Q_FLRT2'), pg_temp.eid('FLEET_LRATE'),
   '[JTC-QA-09] All Terrain Crane 50T — Rental',
   7, 'Days', 160, '2026-08-01', '2026-08-07', 0, 0, '2026-07-31 09:00:00+00'),
  -- FLEET_PM: 13 d × 200 = 2,600
  (pg_temp.qid('Q_FPM'),   pg_temp.eid('FLEET_PM'),
   '[JTC-QA-09] Prime Mover 25T — Rental',
   13, 'Days', 200, '2026-07-01', '2026-07-13', 0, 0, '2026-06-30 09:00:00+00'),
  -- FLEET_DOWN rental 1: 11 d × 300 = 3,300
  (pg_temp.qid('Q_FDWN1'), pg_temp.eid('FLEET_DOWN'),
   '[JTC-QA-09] Boom Truck 100T — Rental',
   11, 'Days', 300, '2026-07-01', '2026-07-11', 0, 0, '2026-06-30 09:00:00+00'),
  -- FLEET_DOWN rental 2: 12 d × 300 = 3,600
  (pg_temp.qid('Q_FDWN2'), pg_temp.eid('FLEET_DOWN'),
   '[JTC-QA-09] Boom Truck 100T — Rental',
   12, 'Days', 300, '2026-07-21', '2026-08-01', 0, 0, '2026-07-20 09:00:00+00'),
  -- FLEET_PCOLL rental 1: 16 d × 220 = 3,520
  (pg_temp.qid('Q_FPCO1'), pg_temp.eid('FLEET_PCOLL'),
   '[JTC-QA-09] Flatbed Trailer 25T — Rental',
   16, 'Days', 220, '2026-07-03', '2026-07-18', 0, 0, '2026-07-02 09:00:00+00'),
  -- FLEET_PCOLL rental 2: 19 d × 220 = 4,180
  (pg_temp.qid('Q_FPCO2'), pg_temp.eid('FLEET_PCOLL'),
   '[JTC-QA-09] Flatbed Trailer 25T — Rental',
   19, 'Days', 220, '2026-07-24', '2026-08-11', 0, 0, '2026-07-23 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 4. Dispatches (10) — all Returned.
--
-- Idle-since dates (as of 2026-08-16):
--   FLEET_A2   last returned 2026-07-03 → 43 d idle
--   FLEET_PM   last returned 2026-07-13 → 33 d idle
--   FLEET_A1   last returned 2026-07-27 → 20 d idle
--   FLEET_DOWN last returned 2026-08-01 → entered workshop 2026-08-03
--   FLEET_LRATE last returned 2026-08-07 →  9 d idle (peer gap is the signal)
--   FLEET_PCOLL last returned 2026-08-11 →  5 d idle (collection is the signal)
--
-- items_total / items_dispatched / items_returned supplied explicitly
-- (trg_sync_dispatch_counts is off).
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, quo_k, equip, dest, ddate, rdate, adate) AS (VALUES
  ('D_F01', 'Q_FA1_1',  pg_temp.eid('FLEET_A1'),    'Ahmadi',          '2026-07-05'::date,'2026-07-16'::date,'2026-07-16'::date),
  ('D_F02', 'Q_FA1_2',  pg_temp.eid('FLEET_A1'),    'Shuaiba',         '2026-07-22'::date,'2026-07-27'::date,'2026-07-27'::date),
  ('D_F03', 'Q_FA2_1',  pg_temp.eid('FLEET_A2'),    'Mina Abdullah',   '2026-07-01'::date,'2026-07-03'::date,'2026-07-03'::date),
  ('D_F04', 'Q_FLRT1',  pg_temp.eid('FLEET_LRATE'), 'Shuwaikh Port',   '2026-07-02'::date,'2026-07-15'::date,'2026-07-15'::date),
  ('D_F05', 'Q_FLRT2',  pg_temp.eid('FLEET_LRATE'), 'Mina Al Zour',    '2026-08-01'::date,'2026-08-07'::date,'2026-08-07'::date),
  ('D_F06', 'Q_FPM',    pg_temp.eid('FLEET_PM'),    'Jahra',           '2026-07-01'::date,'2026-07-13'::date,'2026-07-13'::date),
  ('D_F07', 'Q_FDWN1',  pg_temp.eid('FLEET_DOWN'),  'Ahmadi',          '2026-07-01'::date,'2026-07-11'::date,'2026-07-11'::date),
  ('D_F08', 'Q_FDWN2',  pg_temp.eid('FLEET_DOWN'),  'Shuaiba',         '2026-07-21'::date,'2026-08-01'::date,'2026-08-01'::date),
  ('D_F09', 'Q_FPCO1',  pg_temp.eid('FLEET_PCOLL'), 'Sabah Al Ahmad',  '2026-07-03'::date,'2026-07-18'::date,'2026-07-18'::date),
  ('D_F10', 'Q_FPCO2',  pg_temp.eid('FLEET_PCOLL'), 'Ahmadi Yard',     '2026-07-24'::date,'2026-08-11'::date,'2026-08-11'::date)
),
ins AS (
  INSERT INTO dispatches
    (quotation_id, requirement_id, equipment_id, assigned_by,
     destination, status, dispatch_date, return_date, actual_return_date,
     notes, created_at, updated_at,
     dispatch_type, items_total, items_dispatched, items_returned)
  SELECT
    pg_temp.qid(quo_k), NULL, equip, pg_temp.disp(),
    dest, 'Returned'::dispatch_status, ddate, rdate, adate,
    '[JTC-QA-09] ' || k,
    ddate::timestamptz + INTERVAL '9h',
    ddate::timestamptz + INTERVAL '9h',
    'Full', 1, 1, 1
  FROM src
  RETURNING dispatch_id, notes
)
INSERT INTO _qa (kind, key, id)
SELECT 'dsp', pg_temp.kfrom(notes), dispatch_id FROM ins;

-- Dispatch items (one per dispatch — mirrors real fleet pattern)
INSERT INTO dispatch_items
  (dispatch_id, equipment_id, dispatch_status, notes, created_at)
SELECT
  d.dispatch_id,
  d.equipment_id,
  'Returned',
  '[JTC-QA-09] ' || pg_temp.kfrom(d.notes),
  d.created_at
FROM dispatches d
WHERE d.notes LIKE '%[JTC-QA-09]%';

-- ═════════════════════════════════════════════════════════════════════
-- 5. Maintenance (3)
--
--   M_F01  FLEET_DOWN  Jul 13-14  Completed  KWD   650  (between rentals)
--   M_F02  FLEET_DOWN  Aug  3     In Progress KWD 1,200  (currently grounded)
--          13 d in workshop × KWD 300/d = KWD 3,900 opportunity cost
--   M_F03  FLEET_A2    Jul  5-7   Completed  KWD   180  (preventive PM;
--          unit goes back to Available but is never dispatched again → idle)
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO maintenance
  (equipment_id, reported_by, assigned_to,
   issue, issue_type,
   service_date, start_date, completion_date,
   cost_kwd, status, notes, created_at, updated_at)
VALUES
  (pg_temp.eid('FLEET_DOWN'), pg_temp.ops(), pg_temp.maint(),
   'Hydraulic line failure — pump seal and line replacement',
   'Mechanical',
   '2026-07-13', '2026-07-13', '2026-07-14',
   650, 'Completed'::maintenance_status,
   '[JTC-QA-09] M_F01',
   '2026-07-13 09:00:00+00', '2026-07-14 09:00:00+00'),

  -- Open job — FLEET_DOWN is currently grounded on this job.
  -- completion_date is NULL intentionally.
  (pg_temp.eid('FLEET_DOWN'), pg_temp.ops(), pg_temp.maint(),
   'Boom extension cylinder crack — structural weld and pressure test required',
   'Structural',
   '2026-08-03', '2026-08-03', NULL,
   1200, 'In Progress'::maintenance_status,
   '[JTC-QA-09] M_F02',
   '2026-08-03 09:00:00+00', '2026-08-03 09:00:00+00'),

  (pg_temp.eid('FLEET_A2'), pg_temp.ops(), pg_temp.maint(),
   'Routine 500-hour preventive service — filters, fluids, checks',
   'Other',
   '2026-07-05', '2026-07-05', '2026-07-07',
   180, 'Completed'::maintenance_status,
   '[JTC-QA-09] M_F03',
   '2026-07-05 09:00:00+00', '2026-07-07 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 6. Invoices (10)
--
-- Every unit except FLEET_PCOLL has fully paid invoices so the
-- collection-rate gap reads without noise.
--
-- FLEET_PCOLL: KWD 3,520 (INV_FPCO1) fully unpaid (Sent, amount_paid 0)
--              KWD 4,180 (INV_FPCO2) KWD 800 partial (Sent)
--              Total collected: KWD 800 / KWD 7,700 = 10.4 %
--
-- invoice_status enum has no 'Partial' — partial-paid state is
-- status = 'Sent' with amount_paid_kwd > 0 and < total_amount_kwd.
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO invoices
  (quotation_id, customer_id, created_by,
   total_amount_kwd, amount_paid_kwd,
   status, issue_date, due_date, payment_date, payment_method,
   notes, created_at, updated_at)
VALUES
  -- FLEET_A1
  (pg_temp.qid('Q_FA1_1'), 'KW-CUST-0006', pg_temp.fin(),
   3360, 3360, 'Paid'::invoice_status,
   '2026-07-06','2026-08-05','2026-07-22','Bank Transfer',
   '[JTC-QA-09] INV_FA1_1',
   '2026-07-06 09:00:00+00','2026-07-22 09:00:00+00'),

  (pg_temp.qid('Q_FA1_2'), 'KW-CUST-0007', pg_temp.fin(),
   1680, 1680, 'Paid'::invoice_status,
   '2026-07-23','2026-08-22','2026-08-04','Bank Transfer',
   '[JTC-QA-09] INV_FA1_2',
   '2026-07-23 09:00:00+00','2026-08-04 09:00:00+00'),

  -- FLEET_A2
  (pg_temp.qid('Q_FA2_1'), 'KW-CUST-0008', pg_temp.fin(),
   840, 840, 'Paid'::invoice_status,
   '2026-07-04','2026-08-03','2026-07-18','Bank Transfer',
   '[JTC-QA-09] INV_FA2_1',
   '2026-07-04 09:00:00+00','2026-07-18 09:00:00+00'),

  -- FLEET_LRATE
  (pg_temp.qid('Q_FLRT1'), 'KW-CUST-0010', pg_temp.fin(),
   2240, 2240, 'Paid'::invoice_status,
   '2026-07-03','2026-08-02','2026-07-20','Bank Transfer',
   '[JTC-QA-09] INV_FLRT1',
   '2026-07-03 09:00:00+00','2026-07-20 09:00:00+00'),

  (pg_temp.qid('Q_FLRT2'), 'KW-CUST-0020', pg_temp.fin(),
   1120, 1120, 'Paid'::invoice_status,
   '2026-08-01','2026-08-31','2026-08-13','Bank Transfer',
   '[JTC-QA-09] INV_FLRT2',
   '2026-08-01 09:00:00+00','2026-08-13 09:00:00+00'),

  -- FLEET_PM
  (pg_temp.qid('Q_FPM'),   'KW-CUST-0009', pg_temp.fin(),
   2600, 2600, 'Paid'::invoice_status,
   '2026-07-02','2026-08-01','2026-07-16','Bank Transfer',
   '[JTC-QA-09] INV_FPM',
   '2026-07-02 09:00:00+00','2026-07-16 09:00:00+00'),

  -- FLEET_DOWN (both rentals fully paid — the lost revenue is in M_F02)
  (pg_temp.qid('Q_FDWN1'), 'KW-CUST-0015', pg_temp.fin(),
   3300, 3300, 'Paid'::invoice_status,
   '2026-07-02','2026-08-01','2026-07-24','Bank Transfer',
   '[JTC-QA-09] INV_FDWN1',
   '2026-07-02 09:00:00+00','2026-07-24 09:00:00+00'),

  (pg_temp.qid('Q_FDWN2'), 'KW-CUST-0006', pg_temp.fin(),
   3600, 3600, 'Paid'::invoice_status,
   '2026-07-22','2026-08-21','2026-08-10','Bank Transfer',
   '[JTC-QA-09] INV_FDWN2',
   '2026-07-22 09:00:00+00','2026-08-10 09:00:00+00'),

  -- FLEET_PCOLL — poor collection
  (pg_temp.qid('Q_FPCO1'), 'KW-CUST-0012', pg_temp.fin(),
   3520, 0, 'Sent'::invoice_status,
   '2026-07-04','2026-08-03', NULL, NULL,
   '[JTC-QA-09] INV_FPCO1',
   '2026-07-04 09:00:00+00','2026-07-04 09:00:00+00'),

  (pg_temp.qid('Q_FPCO2'), 'KW-CUST-0021', pg_temp.fin(),
   4180, 800, 'Sent'::invoice_status,
   '2026-07-25','2026-08-24', NULL, 'Bank Transfer',
   '[JTC-QA-09] INV_FPCO2',
   '2026-07-25 09:00:00+00','2026-07-25 09:00:00+00');

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- Post-commit sanity queries (run separately in Supabase SQL editor):
--
--   SELECT count(*) FROM equipment_units WHERE notes LIKE '%[JTC-QA-09]%'; -- 6
--   SELECT count(*) FROM quotations      WHERE notes LIKE '%[JTC-QA-09]%'; -- 10
--   SELECT count(*) FROM quotation_items WHERE description LIKE '%[JTC-QA-09]%'; -- 10
--   SELECT count(*) FROM dispatches      WHERE notes LIKE '%[JTC-QA-09]%'; -- 10
--   SELECT count(*) FROM dispatch_items  WHERE notes LIKE '%[JTC-QA-09]%'; -- 10
--   SELECT count(*) FROM maintenance     WHERE notes LIKE '%[JTC-QA-09]%'; -- 3
--   SELECT count(*) FROM invoices        WHERE notes LIKE '%[JTC-QA-09]%'; -- 10
--
-- Signal verification queries:
--
--   -- Idle units (days since last return, descending)
--   SELECT eu.serial_number, eu.notes,
--          CURRENT_DATE - MAX(d.actual_return_date) AS idle_days
--   FROM equipment_units eu
--   JOIN dispatches d ON d.equipment_id = eu.equipment_id
--   WHERE eu.notes LIKE '%[JTC-QA-09]%'
--     AND d.actual_return_date IS NOT NULL
--   GROUP BY eu.equipment_id, eu.serial_number, eu.notes
--   ORDER BY idle_days DESC;
--   -- Expected: FLEET_A2 43d, FLEET_PM 33d, FLEET_A1 20d
--
--   -- Revenue per dispatch day by unit (peer group visible)
--   SELECT eu.serial_number, eu.notes,
--          SUM(qi.total_kwd) AS total_revenue,
--          SUM(qi.quantity)  AS total_days,
--          ROUND(SUM(qi.total_kwd) / NULLIF(SUM(qi.quantity), 0), 2) AS kwd_per_day
--   FROM equipment_units eu
--   JOIN dispatches d ON d.equipment_id = eu.equipment_id
--   JOIN quotation_items qi ON qi.quotation_id = d.quotation_id
--                           AND qi.equipment_id = eu.equipment_id
--   WHERE eu.notes LIKE '%[JTC-QA-09]%'
--   GROUP BY eu.equipment_id, eu.serial_number, eu.notes
--   ORDER BY kwd_per_day DESC;
--   -- Expected: FLEET_A1/A2/FLEET_DOWN at KWD 280-300; FLEET_LRATE at KWD 160
--
--   -- Collection rate per unit
--   SELECT eu.serial_number,
--          SUM(inv.total_amount_kwd)  AS billed,
--          SUM(inv.amount_paid_kwd)   AS collected,
--          ROUND(SUM(inv.amount_paid_kwd) * 100.0
--                / NULLIF(SUM(inv.total_amount_kwd), 0), 1) AS pct
--   FROM equipment_units eu
--   JOIN dispatches d ON d.equipment_id = eu.equipment_id
--   JOIN invoices inv ON inv.quotation_id = d.quotation_id
--   WHERE eu.notes LIKE '%[JTC-QA-09]%'
--   GROUP BY eu.equipment_id, eu.serial_number
--   ORDER BY pct;
--   -- Expected: FLEET_PCOLL 10.4%, all others 100%
--
-- To roll back: run only the DELETE block at the top of this file
-- inside BEGIN / COMMIT.  It matches strictly on [JTC-QA-09].
-- ═════════════════════════════════════════════════════════════════════════
