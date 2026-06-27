-- ============================================================
-- LEASE MANAGEMENT — SQL Schema Changes
-- Run these in your Supabase SQL editor (in order)
-- ============================================================

-- NOTE: users.user_id is TEXT in this project (Supabase auth UID stored as text),
--       so all FK columns referencing it must also be TEXT.

-- 1. Add lease-return tracking columns to equipment_units
--    (lease_start_date and lease_end_date already exist from the procurement receive flow)
ALTER TABLE equipment_units
  ADD COLUMN IF NOT EXISTS lease_returned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_returned_by   TEXT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS lease_return_notes  TEXT;

-- 2. Lease Extensions — tracks every extension of a lease period
CREATE TABLE IF NOT EXISTS lease_extensions (
  extension_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id      UUID        NOT NULL REFERENCES equipment_units(equipment_id) ON DELETE CASCADE,
  previous_end_date DATE        NOT NULL,
  new_end_date      DATE        NOT NULL,
  monthly_rate_kwd  NUMERIC(10,3),
  extension_notes   TEXT,
  created_by        TEXT        REFERENCES users(user_id),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lease_extensions_equipment
  ON lease_extensions (equipment_id);

-- 3. Lease Invoices — invoices issued for leased equipment rental periods
CREATE TABLE IF NOT EXISTS lease_invoices (
  lease_invoice_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id      UUID        NOT NULL REFERENCES equipment_units(equipment_id) ON DELETE CASCADE,
  period_start      DATE        NOT NULL,
  period_end        DATE        NOT NULL,
  amount_kwd        NUMERIC(10,3) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'Draft'
                    CHECK (status IN ('Draft','Sent','Paid','Cancelled')),
  notes             TEXT,
  created_by        TEXT        REFERENCES users(user_id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  paid_at           TIMESTAMPTZ,
  paid_by           TEXT        REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_lease_invoices_equipment
  ON lease_invoices (equipment_id);
CREATE INDEX IF NOT EXISTS idx_lease_invoices_status
  ON lease_invoices (status);

-- 4. Row-Level Security
ALTER TABLE lease_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_invoices   ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users full access (adjust to your role model as needed)
CREATE POLICY "lease_extensions_all" ON lease_extensions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "lease_invoices_all" ON lease_invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. (Optional) Realtime — enable if you want live updates in the UI
ALTER PUBLICATION supabase_realtime ADD TABLE lease_extensions;
ALTER PUBLICATION supabase_realtime ADD TABLE lease_invoices;
