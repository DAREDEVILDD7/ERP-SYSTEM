-- ═══════════════════════════════════════════════════════════════════════════
-- Activity top-up seed — 2026-08-13 → 2026-08-18
-- Marker: [JTC-QA-10]
--
-- Extends QA-08 (seed_analytics_test_2026.sql) and QA-09
-- (seed_fleet_revenue_2026.sql) with five days of fresh activity.
--
-- What this adds:
--   3 requirements   (Aug 13–16)
--   3 quotations     (Aug 14–17, KWD 16,120 combined)
--   4 quotation items
--   4 dispatches     (Aug 13–18; 3 Assigned, 1 Returned)
--   4 dispatch items
--   3 maintenance    (Aug 14–16; 2 Completed, 1 Open)
--   3 invoices       (Aug 15–17; 2 Sent, 1 Draft)
--
-- QA-09 idle/grounded signals as of 2026-08-18 (no QA-09 rows touched):
--   FLEET_A2   QA-ATC-F02  last return 2026-07-03 → 46 d idle  (critical)
--   FLEET_PM   QA-PM-F01   last return 2026-07-13 → 36 d idle  (notable)
--   FLEET_A1   QA-ATC-F01  last return 2026-07-27 → 22 d idle  (marginal)
--   FLEET_DOWN QA-BT-F01   Maintenance since 2026-08-03 → 15 d grounded
--   FLEET_PCOLL QA-FT-F01  last return 2026-08-11 → 7 d idle + KWD 6,900 outstanding
--   FLEET_LRATE QA-ATC-LOW last return 2026-08-07 → 11 d idle (< 14 d threshold)
--
-- Function names carry the _10 suffix so they do not collide with the
-- pg_temp.admin() / sales() / ... helpers from QA-08 / QA-09 if those
-- transactions ran in the same session.
--
-- Rollback: run only the DELETE block inside BEGIN / COMMIT.
-- Matches strictly on [JTC-QA-10]; cannot touch QA-08, QA-09, or production.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL session_replication_role = replica;

-- ── Rollback deletes (children before parents) ────────────────────────────
DELETE FROM invoices        WHERE notes       LIKE '%[JTC-QA-10]%';
DELETE FROM dispatch_items  WHERE notes       LIKE '%[JTC-QA-10]%';
DELETE FROM maintenance     WHERE notes       LIKE '%[JTC-QA-10]%';
DELETE FROM dispatches      WHERE notes       LIKE '%[JTC-QA-10]%';
DELETE FROM quotation_items WHERE description LIKE '%[JTC-QA-10]%';
DELETE FROM quotations      WHERE notes       LIKE '%[JTC-QA-10]%';
DELETE FROM requirements    WHERE notes       LIKE '%[JTC-QA-10]%';

-- ── Pre-check ─────────────────────────────────────────────────────────────
DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE is_active = true
      AND role::text IN ('Super Admin','Admin','Operations Manager')
  ) THEN
    RAISE EXCEPTION
      'Seed aborted: no active Admin/Super Admin/Operations Manager.';
  END IF;
END $seed$;

-- ── Temp ID store ─────────────────────────────────────────────────────────
CREATE TEMP TABLE _qa10 (
  kind text, key text, id text,
  PRIMARY KEY (kind, key)
) ON COMMIT DROP;

-- Role helpers — _10 suffix avoids collision with QA-08/09 pg_temp functions
CREATE OR REPLACE FUNCTION pg_temp.usr10(p_role text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text = p_role
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.admin10() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text IN ('Super Admin','Admin')
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.sales10() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr10('Sales Executive'), pg_temp.admin10())
$$;
CREATE OR REPLACE FUNCTION pg_temp.ops10() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr10('Operations Manager'), pg_temp.admin10())
$$;
CREATE OR REPLACE FUNCTION pg_temp.disp10() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr10('Dispatch Coordinator'), pg_temp.admin10())
$$;
CREATE OR REPLACE FUNCTION pg_temp.fin10() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr10('Finance Officer'), pg_temp.admin10())
$$;
CREATE OR REPLACE FUNCTION pg_temp.maint10() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.usr10('Maintenance Engineer'), pg_temp.admin10())
$$;

-- ID lookup helpers
CREATE OR REPLACE FUNCTION pg_temp.qid10(k text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa10 WHERE kind = 'quo' AND key = k
$$;
CREATE OR REPLACE FUNCTION pg_temp.rid10(k text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT id FROM _qa10 WHERE kind = 'req' AND key = k
$$;

-- Extracts the key word from '[JTC-QA-10] KEY'
CREATE OR REPLACE FUNCTION pg_temp.kfrom10(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT split_part(p, ' ', 2)
$$;

-- ═════════════════════════════════════════════════════════════════════
-- 1. Requirements (3) — Aug 13–16
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, cust, requester, summary, loc, start_d, end_d, status, prio, created) AS (VALUES
  ('R_KOC_AUG2', 'KW-CUST-0006', 'Hassan Shaikh',
   'Crawler cranes for plant turnaround phase 2',
   'Ahmadi',
   '2026-08-18'::date, '2026-09-05'::date,
   'Approved'::requirement_status, 'High',
   '2026-08-13 08:00:00+00'::timestamptz),

  ('R_MPW_AUG2', 'KW-CUST-0020', 'Sheikh Fahad',
   'Heavy trailers for phase 2 road resurfacing works',
   'Jahra',
   '2026-08-19'::date, '2026-09-03'::date,
   'Operations Review'::requirement_status, 'Normal',
   '2026-08-14 08:00:00+00'::timestamptz),

  ('R_NBTC_AUG', 'KW-CUST-0010', 'Ali Al Mutairi',
   'Prime mover fleet renewal — same specification as Jul contract',
   'Shuaiba',
   '2026-08-20'::date, '2026-09-03'::date,
   'Approved'::requirement_status, 'Normal',
   '2026-08-16 08:00:00+00'::timestamptz)
),
ins AS (
  INSERT INTO requirements
    (customer_id, created_by, requested_by, requirement_summary,
     location, start_date, end_date, status, priority,
     notes, created_at, updated_at)
  SELECT cust, pg_temp.sales10(), requester, summary,
    loc, start_d, end_d, status, prio,
    '[JTC-QA-10] ' || k, created, created
  FROM src
  RETURNING requirement_id, notes
)
INSERT INTO _qa10 (kind, key, id)
SELECT 'req', pg_temp.kfrom10(notes), requirement_id FROM ins;

-- ═════════════════════════════════════════════════════════════════════
-- 2. Quotations (3) — Aug 14–17
-- Totals supplied explicitly (trg_quotation_items_total is off).
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, cust, req_key, status, qdate, total, approved) AS (VALUES
  -- KOC phase-2 cranes: 2 × 18 d × KWD 280 = 10,080
  ('Q_KOC_AUG2', 'KW-CUST-0006', 'R_KOC_AUG2',
   'Approved'::quotation_status, '2026-08-14'::date, 10080.000::numeric, true),

  -- Alghanim follow-on quick rental: Tower Crane 8 d × 300 = 2,400
  ('Q_ALGN_4', 'KW-CUST-0021', NULL::text,
   'Approved'::quotation_status, '2026-08-15'::date, 2400.000::numeric, true),

  -- NBTC prime mover renewal: 14 d × 260 = 3,640
  ('Q_NBTC_AUG', 'KW-CUST-0010', 'R_NBTC_AUG',
   'Sent'::quotation_status, '2026-08-17'::date, 3640.000::numeric, false)
),
ins AS (
  INSERT INTO quotations
    (requirement_id, customer_id, prepared_by, approved_by, status,
     quotation_date, valid_until,
     subtotal_kwd, vat_percent, vat_amount_kwd, total_amount_kwd,
     terms_conditions, notes, created_at, updated_at)
  SELECT
    CASE WHEN req_key IS NULL THEN NULL ELSE pg_temp.rid10(req_key) END,
    cust, pg_temp.sales10(),
    CASE WHEN approved THEN pg_temp.admin10() ELSE NULL END,
    status, qdate, qdate + INTERVAL '30 days',
    total, 0, 0, total,
    'Payment within 30 days. Equipment subject to availability.',
    '[JTC-QA-10] ' || k,
    qdate::timestamptz + INTERVAL '9h',
    qdate::timestamptz + INTERVAL '9h'
  FROM src
  RETURNING quotation_id, notes
)
INSERT INTO _qa10 (kind, key, id)
SELECT 'quo', pg_temp.kfrom10(notes), quotation_id FROM ins;

-- ═════════════════════════════════════════════════════════════════════
-- 3. Quotation items (4)
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO quotation_items
  (quotation_id, equipment_id, description, quantity, unit,
   unit_rate_kwd, rental_start_date, rental_end_date,
   discount_percent, discount_amount, created_at)
VALUES
  -- Q_KOC_AUG2: Crawler Crane 50T line 1 — 18 d × 280 = 5,040
  (pg_temp.qid10('Q_KOC_AUG2'), 'KW-EQP-0006',
   '[JTC-QA-10] Crawler Crane 50 Ton — Rental',
   18, 'Days', 280, '2026-08-18', '2026-09-05',
   0, 0, '2026-08-14 09:00:00+00'),

  -- Q_KOC_AUG2: Crawler Crane 50T line 2 — 18 d × 280 = 5,040
  (pg_temp.qid10('Q_KOC_AUG2'), 'KW-EQP-0096',
   '[JTC-QA-10] Crawler Crane 50 Ton — Rental',
   18, 'Days', 280, '2026-08-18', '2026-09-05',
   0, 0, '2026-08-14 09:00:00+00'),

  -- Q_ALGN_4: Tower Crane 100T — 8 d × 300 = 2,400
  (pg_temp.qid10('Q_ALGN_4'), 'KW-EQP-0093',
   '[JTC-QA-10] Tower Crane 100 Ton — Rental',
   8, 'Days', 300, '2026-08-16', '2026-08-23',
   0, 0, '2026-08-15 09:00:00+00'),

  -- Q_NBTC_AUG: Prime Mover 25T — 14 d × 260 = 3,640
  (pg_temp.qid10('Q_NBTC_AUG'), 'KW-EQP-0021',
   '[JTC-QA-10] Prime Mover 25 Ton — Renewal Rental',
   14, 'Days', 260, '2026-08-20', '2026-09-03',
   0, 0, '2026-08-17 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 4. Dispatches (4) + dispatch items
--
--   D10_A / D10_B  KOC phase-2 cranes dispatched Aug 18 → return Sep 5
--   D10_C          Alghanim Tower Crane dispatched Aug 16 → return Aug 23
--   D10_D          Ad-hoc unit returned Aug 15 (short turnaround job)
--
-- items_total / items_dispatched / items_returned supplied explicitly
-- (trg_sync_dispatch_counts is off).
-- ═════════════════════════════════════════════════════════════════════
WITH src (k, quo_k, req_k, equip, dest, status, ddate, rdate, adate) AS (VALUES
  ('D10_A', 'Q_KOC_AUG2', 'R_KOC_AUG2', 'KW-EQP-0006', 'Ahmadi',
   'Assigned'::dispatch_status,
   '2026-08-18'::date, '2026-09-05'::date, NULL::date),

  ('D10_B', 'Q_KOC_AUG2', 'R_KOC_AUG2', 'KW-EQP-0096', 'Ahmadi',
   'Assigned'::dispatch_status,
   '2026-08-18'::date, '2026-09-05'::date, NULL::date),

  ('D10_C', 'Q_ALGN_4', NULL::text, 'KW-EQP-0093', 'Ahmadi',
   'Assigned'::dispatch_status,
   '2026-08-16'::date, '2026-08-23'::date, NULL::date),

  -- Ad-hoc unit out Aug 13, back Aug 15 — boosts Aug dispatch count
  ('D10_D', NULL::text, NULL::text, 'KW-EQP-0091', 'Jahra',
   'Returned'::dispatch_status,
   '2026-08-13'::date, '2026-08-15'::date, '2026-08-15'::date)
),
ins AS (
  INSERT INTO dispatches
    (quotation_id, requirement_id, equipment_id, assigned_by,
     destination, status, dispatch_date, return_date, actual_return_date,
     notes, created_at, updated_at,
     dispatch_type, items_total, items_dispatched, items_returned)
  SELECT
    CASE WHEN quo_k IS NULL THEN NULL ELSE pg_temp.qid10(quo_k) END,
    CASE WHEN req_k IS NULL THEN NULL ELSE pg_temp.rid10(req_k) END,
    equip, pg_temp.disp10(),
    dest, status, ddate, rdate, adate,
    '[JTC-QA-10] ' || k,
    ddate::timestamptz + INTERVAL '9h',
    ddate::timestamptz + INTERVAL '9h',
    'Full', 1,
    CASE WHEN status IN ('Assigned','In Transit','Returned','Completed') THEN 1 ELSE 0 END,
    CASE WHEN status IN ('Returned','Completed') THEN 1 ELSE 0 END
  FROM src
  RETURNING dispatch_id, notes, equipment_id, status, created_at
)
INSERT INTO _qa10 (kind, key, id)
SELECT 'dsp', pg_temp.kfrom10(notes), dispatch_id FROM ins;

INSERT INTO dispatch_items
  (dispatch_id, equipment_id, dispatch_status, notes, created_at)
SELECT
  d.dispatch_id,
  d.equipment_id,
  CASE d.status::text
    WHEN 'Returned'   THEN 'Returned'
    WHEN 'Completed'  THEN 'Returned'
    WHEN 'Assigned'   THEN 'Dispatched'
    WHEN 'In Transit' THEN 'Dispatched'
    ELSE 'Pending'
  END,
  '[JTC-QA-10] ' || pg_temp.kfrom10(d.notes),
  d.created_at
FROM dispatches d
WHERE d.notes LIKE '%[JTC-QA-10]%';

-- ═════════════════════════════════════════════════════════════════════
-- 5. Maintenance (3) — Aug 14–16
--
--   M10_A  KW-EQP-0009  Completed — hydraulic pressure resolved
--          (continues the repeat-offender pattern from QA-08 Repeat #1-4)
--   M10_B  KW-EQP-0043  Open      — new oil leak, adds to open-job count
--   M10_C  KW-EQP-0022  Completed — scheduled preventive service
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO maintenance
  (equipment_id, reported_by, assigned_to,
   issue, issue_type,
   service_date, start_date, completion_date,
   cost_kwd, status, notes, created_at, updated_at)
VALUES
  -- Repeat offender KW-EQP-0009: fifth job this window
  ('KW-EQP-0009', pg_temp.ops10(), pg_temp.maint10(),
   'Hydraulic pressure loss — pressure relief valve replaced, system re-bled',
   'Mechanical',
   '2026-08-14', '2026-08-14', '2026-08-14',
   420, 'Completed'::maintenance_status,
   '[JTC-QA-10] M10_A',
   '2026-08-14 09:00:00+00', '2026-08-14 09:00:00+00'),

  -- New open job on KW-EQP-0043
  ('KW-EQP-0043', pg_temp.ops10(), pg_temp.maint10(),
   'Oil leak at boom base — suspected seal failure, assessment in progress',
   'Mechanical',
   '2026-08-16', '2026-08-16', NULL,
   0, 'Open'::maintenance_status,
   '[JTC-QA-10] M10_B',
   '2026-08-16 09:00:00+00', '2026-08-16 09:00:00+00'),

  -- Routine PM on KW-EQP-0022
  ('KW-EQP-0022', pg_temp.ops10(), pg_temp.maint10(),
   'Scheduled 250-hour service — filters, lubricants, tyre pressures checked',
   'Other',
   '2026-08-15', '2026-08-15', '2026-08-15',
   220, 'Completed'::maintenance_status,
   '[JTC-QA-10] M10_C',
   '2026-08-15 09:00:00+00', '2026-08-15 09:00:00+00');

-- ═════════════════════════════════════════════════════════════════════
-- 6. Invoices (3) — Aug 15–17
--
--   INV_KOC_AUG2   KWD 10,080  Sent (unpaid)  — large new receivable
--   INV_ALGN_4     KWD  2,400  Sent (unpaid)  — Alghanim 4th invoice
--   INV_NBTC_AUG   KWD  3,640  Draft          — quote not yet approved
--
-- The two Sent invoices land in the collection section of fleet_action_queue
-- for customer KW-CUST-0006 and KW-CUST-0021 respectively.
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO invoices
  (quotation_id, customer_id, created_by,
   total_amount_kwd, amount_paid_kwd,
   status, issue_date, due_date, payment_date, payment_method,
   notes, created_at, updated_at)
VALUES
  -- KOC phase-2: large Sent invoice, KWD 10,080 outstanding
  (pg_temp.qid10('Q_KOC_AUG2'), 'KW-CUST-0006', pg_temp.fin10(),
   10080, 0, 'Sent'::invoice_status,
   '2026-08-15', '2026-09-14', NULL, NULL,
   '[JTC-QA-10] INV_KOC_AUG2',
   '2026-08-15 09:00:00+00', '2026-08-15 09:00:00+00'),

  -- Alghanim 4th job: Sent, unpaid
  (pg_temp.qid10('Q_ALGN_4'), 'KW-CUST-0021', pg_temp.fin10(),
   2400, 0, 'Sent'::invoice_status,
   '2026-08-16', '2026-09-15', NULL, NULL,
   '[JTC-QA-10] INV_ALGN_4',
   '2026-08-16 09:00:00+00', '2026-08-16 09:00:00+00'),

  -- NBTC renewal: Draft — not yet a receivable
  (pg_temp.qid10('Q_NBTC_AUG'), 'KW-CUST-0010', pg_temp.fin10(),
   3640, 0, 'Draft'::invoice_status,
   '2026-08-17', '2026-09-16', NULL, NULL,
   '[JTC-QA-10] INV_NBTC_AUG',
   '2026-08-17 09:00:00+00', '2026-08-17 09:00:00+00');

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- Post-commit sanity queries (run separately in Supabase SQL editor):
--
--   SELECT count(*) FROM requirements   WHERE notes       LIKE '%[JTC-QA-10]%'; -- 3
--   SELECT count(*) FROM quotations     WHERE notes       LIKE '%[JTC-QA-10]%'; -- 3
--   SELECT count(*) FROM quotation_items WHERE description LIKE '%[JTC-QA-10]%'; -- 4
--   SELECT count(*) FROM dispatches     WHERE notes       LIKE '%[JTC-QA-10]%'; -- 4
--   SELECT count(*) FROM dispatch_items WHERE notes       LIKE '%[JTC-QA-10]%'; -- 4
--   SELECT count(*) FROM maintenance    WHERE notes       LIKE '%[JTC-QA-10]%'; -- 3
--   SELECT count(*) FROM invoices       WHERE notes       LIKE '%[JTC-QA-10]%'; -- 3
--
-- Signal verification:
--
--   -- New Sent invoices from this seed (should add to collection alerts)
--   SELECT customer_id, total_amount_kwd, amount_paid_kwd, status
--   FROM invoices WHERE notes LIKE '%[JTC-QA-10]%' AND status = 'Sent';
--   -- Expected: KW-CUST-0006 KWD 10,080 | KW-CUST-0021 KWD 2,400
--
--   -- Aug 13–18 dispatch activity
--   SELECT status, dispatch_date, destination
--   FROM dispatches WHERE notes LIKE '%[JTC-QA-10]%'
--   ORDER BY dispatch_date;
--   -- Expected: D10_D Returned Aug 13, D10_C Assigned Aug 16, D10_A/B Assigned Aug 18
--
--   -- Repeat-offender maintenance count for KW-EQP-0009 (QA-08 + QA-10)
--   SELECT count(*), sum(cost_kwd)
--   FROM maintenance
--   WHERE equipment_id = 'KW-EQP-0009'
--     AND notes LIKE '%[JTC-QA-0%';
--   -- Expected: 5 jobs, KWD 2,300 total (480+620+410+350+420)
--
-- To roll back: run only the DELETE block at the top inside BEGIN / COMMIT.
-- ═════════════════════════════════════════════════════════════════════════
