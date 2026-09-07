-- ═════════════════════════════════════════════════════════════════════════
-- POC lease commitments — standalone
--
-- The lease rows are the last block of seed_poc_operations_2026.sql. If that
-- file was run from an older copy, or the paste into the SQL editor was cut
-- short, the inserts land but these 24 UPDATEs do not — and the Analytics
-- "Forward forecast — booked lease commitments" section reads KWD 0 with no
-- error anywhere, because the fetcher's maths is fine and simply has no rows.
--
-- Safe to run on its own, and safe to re-run: the rollback below clears only
-- rows carrying the marker, and every UPDATE is guarded on notes IS NULL so
-- it can never overwrite a real lease or anything a person typed.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL session_replication_role = replica;

UPDATE equipment_units SET
  lease_monthly_kwd = NULL, lease_start_date = NULL,
  lease_end_date = NULL, lease_returned_at = NULL, notes = NULL
WHERE notes LIKE '%[JTC-POC-09]%';

UPDATE equipment_units SET lease_monthly_kwd = 2400, lease_start_date = '2026-08-05', lease_end_date = '2026-09-10', lease_returned_at = NULL, notes = 'Lease running to 2026-09-10. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0001' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1850, lease_start_date = '2026-06-29', lease_end_date = '2026-09-15', lease_returned_at = NULL, notes = 'Lease running to 2026-09-15. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0002' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 3200, lease_start_date = '2026-05-23', lease_end_date = '2026-09-21', lease_returned_at = NULL, notes = 'Lease running to 2026-09-21. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0003' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1450, lease_start_date = '2026-04-16', lease_end_date = '2026-09-26', lease_returned_at = NULL, notes = 'Lease running to 2026-09-26. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0004' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 2750, lease_start_date = '2026-03-10', lease_end_date = '2026-10-02', lease_returned_at = NULL, notes = 'Lease running to 2026-10-02. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0005' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 950, lease_start_date = '2026-02-01', lease_end_date = '2026-10-03', lease_returned_at = NULL, notes = 'Lease running to 2026-10-03. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0006' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 4100, lease_start_date = '2026-07-24', lease_end_date = '2026-10-10', lease_returned_at = NULL, notes = 'Lease running to 2026-10-10. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0007' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1600, lease_start_date = '2026-06-17', lease_end_date = '2026-10-17', lease_returned_at = NULL, notes = 'Lease running to 2026-10-17. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0008' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 2250, lease_start_date = '2026-05-11', lease_end_date = '2026-10-25', lease_returned_at = NULL, notes = 'Lease running to 2026-10-25. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0009' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1150, lease_start_date = '2026-04-04', lease_end_date = '2026-11-01', lease_returned_at = NULL, notes = 'Lease running to 2026-11-01. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0010' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 3400, lease_start_date = '2026-02-26', lease_end_date = '2026-11-10', lease_returned_at = NULL, notes = 'Lease running to 2026-11-10. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0011' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1900, lease_start_date = '2026-01-20', lease_end_date = '2026-11-17', lease_returned_at = NULL, notes = 'Lease running to 2026-11-17. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0012' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 2600, lease_start_date = '2026-07-12', lease_end_date = '2026-12-01', lease_returned_at = NULL, notes = 'Lease running to 2026-12-01. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0013' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 3900, lease_start_date = '2026-06-05', lease_end_date = '2026-12-31', lease_returned_at = NULL, notes = 'Lease running to 2026-12-31. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0014' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 2050, lease_start_date = '2026-04-29', lease_end_date = '2027-01-27', lease_returned_at = NULL, notes = 'Lease running to 2027-01-27. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0015' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1750, lease_start_date = '2026-03-23', lease_end_date = '2027-02-22', lease_returned_at = NULL, notes = 'Lease running to 2027-02-22. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0016' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 4500, lease_start_date = '2026-02-14', lease_end_date = '2027-03-27', lease_returned_at = NULL, notes = 'Lease running to 2027-03-27. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0018' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 2900, lease_start_date = '2026-01-08', lease_end_date = '2027-05-08', lease_returned_at = NULL, notes = 'Lease running to 2027-05-08. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0019' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1350, lease_start_date = '2026-06-30', lease_end_date = '2027-07-11', lease_returned_at = NULL, notes = 'Lease running to 2027-07-11. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0020' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 3050, lease_start_date = '2026-05-24', lease_end_date = NULL, lease_returned_at = NULL, notes = 'Open-ended lease, rolling monthly. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0021' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1250, lease_start_date = '2026-04-17', lease_end_date = NULL, lease_returned_at = NULL, notes = 'Open-ended lease, rolling monthly. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0022' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 2150, lease_start_date = '2026-03-11', lease_end_date = '2026-08-16', lease_returned_at = NULL, notes = 'Lease term ended 2026-08-16 — unit not yet returned. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0023' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 1700, lease_start_date = '2026-09-24', lease_end_date = '2026-07-26', lease_returned_at = NULL, notes = 'Lease dates require correction. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0024' AND notes IS NULL;
UPDATE equipment_units SET lease_monthly_kwd = 0, lease_start_date = '2026-07-25', lease_end_date = '2026-10-29', lease_returned_at = NULL, notes = 'Rate pending contract signature. [JTC-POC-09]' WHERE equipment_id = 'KW-EQP-0025' AND notes IS NULL;

COMMIT;

-- Verification. Expect: 24 rows applied, 21 of them live and rated today.
SELECT
  count(*)                                                      AS lease_rows_applied,
  count(*) FILTER (WHERE lease_monthly_kwd > 0
                     AND lease_returned_at IS NULL
                     AND (lease_end_date IS NULL
                          OR lease_end_date >= CURRENT_DATE))   AS counting_toward_forecast,
  sum(lease_monthly_kwd)                                        AS committed_kwd_per_month
FROM equipment_units
WHERE notes LIKE '%[JTC-POC-09]%';
