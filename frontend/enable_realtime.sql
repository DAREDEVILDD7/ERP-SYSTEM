-- Enable Supabase Realtime for all tables used by the ERP system.
-- Run this once in the Supabase SQL Editor.
-- Each statement is wrapped in its own exception block so existing entries
-- don't cause the whole batch to fail.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'equipment_units',
    'equipment_types',
    'requirements',
    'quotations',
    'customers',
    'dispatches',
    'dispatch_items',
    'maintenance',
    'invoices',
    'lease_invoices',
    'lease_extensions',
    'procurements',
    'purchase_orders',
    'procurement_items',
    'vendors',
    'users',
    'session_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      RAISE NOTICE 'Added % to supabase_realtime', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped % (already in publication or table not found): %', t, SQLERRM;
    END;
  END LOOP;
END $$;
