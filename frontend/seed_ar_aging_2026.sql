-- ═══════════════════════════════════════════════════════════════════════════
-- A/R Ageing test data — invoices with historically past due dates
-- Marker: [JTC-QA-11]
--
-- Purpose: Populate all four A/R aging buckets (1-30 / 31-60 / 61-90 / 90+
--          days) so analytics getTopCustomers and getFleetActionQueue can
--          show real age_buckets data during QA and POC demos.
--
-- Reference date: 2026-08-19
--   1-30  days overdue → INV-AR-001  due 2026-08-05  14d  KWD 1,800  NBTC
--   31-60 days overdue → INV-AR-002  due 2026-07-10  40d  KWD 2,100  Al-Ghanim
--   61-90 days overdue → INV-AR-003  due 2026-06-10  70d  KWD 5,250  Al-Ghanim
--   90+   days overdue → INV-AR-004  due 2026-04-01 140d  KWD 3,600  KOC
--   90+   days overdue → INV-AR-005  due 2026-03-01 171d  KWD 8,400  KOC
--
-- All invoices: status='Sent', amount_paid_kwd=0 (fully outstanding).
--
-- Schema notes (read database-schema.md before editing):
--   requirements.requirement_summary  — NOT NULL, no "description" column
--   requirements.created_by           — NOT NULL FK to users
--   requirements.requested_by         — NOT NULL text (customer contact, free text)
--   quotations.total_amount_kwd       — the money column (no "total_kwd")
--   quotations.prepared_by            — NOT NULL FK to users
--   invoices.total_amount_kwd         — the money column (no "total_kwd")
--   All PKs are auto-generated text sequences (KW-REQ-YYYY-NNNN etc.)
--   so PKs are omitted from INSERTs and looked up via notes after insert.
--
-- Rollback:
--   DELETE FROM invoices     WHERE notes LIKE '%[JTC-QA-11]%';
--   DELETE FROM quotations   WHERE notes LIKE '%[JTC-QA-11]%';
--   DELETE FROM requirements WHERE notes LIKE '%[JTC-QA-11]%';
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL session_replication_role = replica;

-- ── Rollback deletes (children before parents) ────────────────────────────
DELETE FROM invoices     WHERE notes LIKE '%[JTC-QA-11]%';
DELETE FROM quotations   WHERE notes LIKE '%[JTC-QA-11]%';
DELETE FROM requirements WHERE notes LIKE '%[JTC-QA-11]%';

-- ── Pre-check ─────────────────────────────────────────────────────────────
DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE is_active = true
      AND role::text IN ('Super Admin','Admin','Operations Manager')
  ) THEN
    RAISE EXCEPTION '[JTC-QA-11] Aborted: no active Admin/Super Admin/Operations Manager.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers LIMIT 1) THEN
    RAISE EXCEPTION '[JTC-QA-11] Aborted: customers table is empty — run QA-08/09 first.';
  END IF;
END $seed$;

-- ── Temp ID store (text only — all PKs in this schema are text) ───────────
CREATE TEMP TABLE _qa11 (
  kind text, key text, id text,
  PRIMARY KEY (kind, key)
) ON COMMIT DROP;

-- ── Lookup helpers ────────────────────────────────────────────────────────
-- customer_id is TEXT (KW-CUST-NNNN). Returns text, not uuid.

CREATE OR REPLACE FUNCTION pg_temp.c11_koc() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT customer_id FROM customers
  WHERE company_name ILIKE '%Kuwait Oil%' OR company_name ILIKE 'KOC'
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.c11_algn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT customer_id FROM customers
  WHERE company_name ILIKE '%Ghanim%' OR company_name ILIKE '%ALGN%'
  ORDER BY created_at LIMIT 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.c11_nbtc() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT customer_id FROM customers
  WHERE company_name ILIKE '%NBTC%' OR company_name ILIKE '%National%'
  ORDER BY created_at LIMIT 1
$$;
-- Positional fallback when a named customer is not in the DB
CREATE OR REPLACE FUNCTION pg_temp.c11_any(skip int DEFAULT 0) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT customer_id FROM customers ORDER BY created_at LIMIT 1 OFFSET skip
$$;
CREATE OR REPLACE FUNCTION pg_temp.koc()  RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.c11_koc(),  pg_temp.c11_any(0)) $$;
CREATE OR REPLACE FUNCTION pg_temp.algn() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.c11_algn(), pg_temp.c11_any(1)) $$;
CREATE OR REPLACE FUNCTION pg_temp.nbtc() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(pg_temp.c11_nbtc(), pg_temp.c11_any(2)) $$;

-- Admin user for created_by / prepared_by (FK to users, NOT NULL)
CREATE OR REPLACE FUNCTION pg_temp.admin11() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT user_id FROM users
  WHERE is_active = true AND role::text IN ('Super Admin','Admin')
  ORDER BY created_at LIMIT 1
$$;

-- ── Requirements ──────────────────────────────────────────────────────────
-- PKs omitted → auto-generated as KW-REQ-2026-NNNN by the sequence default.
-- required columns: customer_id, created_by, requested_by, requirement_summary
-- requested_by is free text (customer contact name), not a FK.

INSERT INTO requirements (
  customer_id, created_by, requested_by,
  requirement_summary, status, notes, created_at
)
VALUES
  (pg_temp.koc(), pg_temp.admin11(), 'KOC Procurement',
   'Crawler crane mobilisation — Q1 2026',
   'Pending Review',
   '[JTC-QA-11] KOC Q1 requirement', '2026-01-10'),

  (pg_temp.algn(), pg_temp.admin11(), 'Al-Ghanim Projects',
   'Heavy equipment hire — Feb to Jun 2026',
   'Pending Review',
   '[JTC-QA-11] Al-Ghanim mid-year requirement', '2026-02-01'),

  (pg_temp.nbtc(), pg_temp.admin11(), 'NBTC Operations',
   'Fleet support services — Jul 2026',
   'Pending Review',
   '[JTC-QA-11] NBTC Jul requirement', '2026-07-01');

-- Capture auto-generated requirement_ids
INSERT INTO _qa11 (kind, key, id)
  SELECT 'req', 'KOC_Q1',   requirement_id
    FROM requirements WHERE notes LIKE '%[JTC-QA-11]% KOC Q1%'
  UNION ALL
  SELECT 'req', 'ALGN_MID', requirement_id
    FROM requirements WHERE notes LIKE '%[JTC-QA-11]% Al-Ghanim%'
  UNION ALL
  SELECT 'req', 'NBTC_JUL', requirement_id
    FROM requirements WHERE notes LIKE '%[JTC-QA-11]% NBTC Jul%';

-- ── Quotations ────────────────────────────────────────────────────────────
-- PKs omitted → auto-generated as KW-QT-2026-NNNN.
-- required columns: customer_id, prepared_by
-- money column is total_amount_kwd (subtotal_kwd = same, VAT = 0)

INSERT INTO quotations (
  requirement_id, customer_id, prepared_by,
  status, subtotal_kwd, total_amount_kwd,
  notes, created_at
)
VALUES
  ((SELECT id FROM _qa11 WHERE kind='req' AND key='KOC_Q1'),
   pg_temp.koc(), pg_temp.admin11(),
   'Approved', 8400.000, 8400.000,
   '[JTC-QA-11] KOC Q1 Phase-1 quotation', '2026-01-20'),

  ((SELECT id FROM _qa11 WHERE kind='req' AND key='KOC_Q1'),
   pg_temp.koc(), pg_temp.admin11(),
   'Approved', 3600.000, 3600.000,
   '[JTC-QA-11] KOC Q1 Phase-2 quotation', '2026-02-10'),

  ((SELECT id FROM _qa11 WHERE kind='req' AND key='ALGN_MID'),
   pg_temp.algn(), pg_temp.admin11(),
   'Approved', 5250.000, 5250.000,
   '[JTC-QA-11] Al-Ghanim Phase-1 quotation', '2026-04-10'),

  ((SELECT id FROM _qa11 WHERE kind='req' AND key='ALGN_MID'),
   pg_temp.algn(), pg_temp.admin11(),
   'Approved', 2100.000, 2100.000,
   '[JTC-QA-11] Al-Ghanim Phase-2 quotation', '2026-05-20'),

  ((SELECT id FROM _qa11 WHERE kind='req' AND key='NBTC_JUL'),
   pg_temp.nbtc(), pg_temp.admin11(),
   'Approved', 1800.000, 1800.000,
   '[JTC-QA-11] NBTC Jul quotation', '2026-07-06');

-- Capture auto-generated quotation_ids
INSERT INTO _qa11 (kind, key, id)
  SELECT 'quot', 'KOC_P1',   quotation_id
    FROM quotations WHERE notes LIKE '%[JTC-QA-11]% KOC Q1 Phase-1%'
  UNION ALL
  SELECT 'quot', 'KOC_P2',   quotation_id
    FROM quotations WHERE notes LIKE '%[JTC-QA-11]% KOC Q1 Phase-2%'
  UNION ALL
  SELECT 'quot', 'ALGN_P1',  quotation_id
    FROM quotations WHERE notes LIKE '%[JTC-QA-11]% Al-Ghanim Phase-1%'
  UNION ALL
  SELECT 'quot', 'ALGN_P2',  quotation_id
    FROM quotations WHERE notes LIKE '%[JTC-QA-11]% Al-Ghanim Phase-2%'
  UNION ALL
  SELECT 'quot', 'NBTC_JUL', quotation_id
    FROM quotations WHERE notes LIKE '%[JTC-QA-11]% NBTC Jul%';

-- ── Invoices ──────────────────────────────────────────────────────────────
-- PKs omitted → auto-generated as KW-INV-2026-NNNN.
-- money column is total_amount_kwd (no "total_kwd" column).
-- All status='Sent', amount_paid_kwd=0 → fully outstanding.
-- due_dates are set in the past so each falls into a different aging bucket.

INSERT INTO invoices (
  quotation_id, customer_id, created_by,
  status, total_amount_kwd, amount_paid_kwd,
  issue_date, due_date, notes
)
VALUES
  -- 1-30 bucket: NBTC, due 2026-08-05 (14 d overdue as of 2026-08-19)
  ((SELECT id FROM _qa11 WHERE kind='quot' AND key='NBTC_JUL'),
   pg_temp.nbtc(), pg_temp.admin11(),
   'Sent', 1800.000, 0.000,
   '2026-07-06', '2026-08-05',
   '[JTC-QA-11] 1-30 bucket · NBTC Jul services'),

  -- 31-60 bucket: Al-Ghanim Phase-2, due 2026-07-10 (40 d overdue)
  ((SELECT id FROM _qa11 WHERE kind='quot' AND key='ALGN_P2'),
   pg_temp.algn(), pg_temp.admin11(),
   'Sent', 2100.000, 0.000,
   '2026-06-10', '2026-07-10',
   '[JTC-QA-11] 31-60 bucket · Al-Ghanim Phase-2'),

  -- 61-90 bucket: Al-Ghanim Phase-1, due 2026-06-10 (70 d overdue)
  ((SELECT id FROM _qa11 WHERE kind='quot' AND key='ALGN_P1'),
   pg_temp.algn(), pg_temp.admin11(),
   'Sent', 5250.000, 0.000,
   '2026-05-10', '2026-06-10',
   '[JTC-QA-11] 61-90 bucket · Al-Ghanim Phase-1'),

  -- 90+ bucket: KOC Phase-2, due 2026-04-01 (140 d overdue)
  ((SELECT id FROM _qa11 WHERE kind='quot' AND key='KOC_P2'),
   pg_temp.koc(), pg_temp.admin11(),
   'Sent', 3600.000, 0.000,
   '2026-03-02', '2026-04-01',
   '[JTC-QA-11] 90+ bucket · KOC Phase-2'),

  -- 90+ bucket (oldest): KOC Phase-1, due 2026-03-01 (171 d overdue)
  ((SELECT id FROM _qa11 WHERE kind='quot' AND key='KOC_P1'),
   pg_temp.koc(), pg_temp.admin11(),
   'Sent', 8400.000, 0.000,
   '2026-01-30', '2026-03-01',
   '[JTC-QA-11] 90+ bucket (oldest) · KOC Phase-1');

-- ── Verify ────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  req_count  int;
  quot_count int;
  inv_count  int;
BEGIN
  SELECT COUNT(*) INTO req_count  FROM requirements WHERE notes LIKE '%[JTC-QA-11]%';
  SELECT COUNT(*) INTO quot_count FROM quotations   WHERE notes LIKE '%[JTC-QA-11]%';
  SELECT COUNT(*) INTO inv_count  FROM invoices     WHERE notes LIKE '%[JTC-QA-11]%';

  IF req_count < 3 OR quot_count < 5 OR inv_count < 5 THEN
    RAISE WARNING '[JTC-QA-11] Incomplete: % req, % quot, % inv (expected 3/5/5).',
      req_count, quot_count, inv_count;
  ELSE
    RAISE NOTICE '[JTC-QA-11] OK: % req, % quot, % inv.', req_count, quot_count, inv_count;
    RAISE NOTICE 'A/R buckets: 1-30d KWD 1,800 | 31-60d KWD 2,100 | 61-90d KWD 5,250 | 90+ KWD 12,000';
  END IF;
END $verify$;

COMMIT;
