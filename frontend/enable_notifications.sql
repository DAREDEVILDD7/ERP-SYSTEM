-- ═══════════════════════════════════════════════════════════════════════════
-- Notification System — Full Reset & Setup
-- Safe to run multiple times. Paste everything into Supabase SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Nuclear cleanup ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tg_requirements_notify    ON requirements;
DROP TRIGGER IF EXISTS tg_quotations_notify      ON quotations;
DROP TRIGGER IF EXISTS tg_dispatches_notify      ON dispatches;
DROP TRIGGER IF EXISTS tg_maintenance_notify     ON maintenance;
DROP TRIGGER IF EXISTS tg_invoices_notify        ON invoices;
DROP TRIGGER IF EXISTS tg_procurements_notify    ON procurements;
DROP TRIGGER IF EXISTS tg_purchase_orders_notify ON purchase_orders;

DROP FUNCTION IF EXISTS trg_requirements_notify();
DROP FUNCTION IF EXISTS trg_quotations_notify();
DROP FUNCTION IF EXISTS trg_dispatches_notify();
DROP FUNCTION IF EXISTS trg_maintenance_notify();
DROP FUNCTION IF EXISTS trg_invoices_notify();
DROP FUNCTION IF EXISTS trg_procurements_notify();
DROP FUNCTION IF EXISTS trg_purchase_orders_notify();

DROP FUNCTION IF EXISTS notify_by_roles(text[],text,text,text,text,jsonb,text);
DROP FUNCTION IF EXISTS notify_by_roles(text[],text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS notify_by_roles(text[],text,text,text,text);
DROP FUNCTION IF EXISTS notify_by_roles(text[],text,text,text);
DROP FUNCTION IF EXISTS notify_user(text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS notify_user(text,text,text,text,text);
DROP FUNCTION IF EXISTS notify_user(text,text,text,text);

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type            TEXT        NOT NULL DEFAULT 'system',
  title           TEXT        NOT NULL,
  message         TEXT        NOT NULL,
  link            TEXT,
  is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread       ON notifications (user_id, is_read) WHERE NOT is_read;

-- ── 2. Permissions & RLS ─────────────────────────────────────────────────────
-- Custom RPC auth — auth.uid() is always NULL. RLS must stay OFF.
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_own"        ON notifications;
DROP POLICY IF EXISTS "notif_all_access" ON notifications;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO anon, authenticated;

-- ── 3. Realtime ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 4. Helper: notify users with given roles (optionally exclude one user) ───
-- p_exclude: user_id to skip (prevents notifying the person who triggered the action)
CREATE FUNCTION notify_by_roles(
  p_roles    TEXT[],
  p_type     TEXT,
  p_title    TEXT,
  p_message  TEXT,
  p_link     TEXT  DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}',
  p_exclude  TEXT  DEFAULT NULL
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT := 0;
BEGIN
  INSERT INTO notifications (user_id, type, title, message, link, metadata)
  SELECT u.user_id, p_type, p_title, p_message, p_link, p_metadata
  FROM   users u
  WHERE  u.role::TEXT = ANY(p_roles)
    AND  COALESCE(u.is_active, TRUE) = TRUE
    AND  (p_exclude IS NULL OR u.user_id::TEXT != p_exclude);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_by_roles] roles=% err=%', p_roles, SQLERRM;
  RETURN 0;
END;
$$;

-- ── 5. Helper: notify a single specific user ──────────────────────────────────
CREATE FUNCTION notify_user(
  p_user_id  TEXT,
  p_type     TEXT,
  p_title    TEXT,
  p_message  TEXT,
  p_link     TEXT  DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL OR trim(p_user_id) = '' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = p_user_id) THEN RETURN; END IF;
  INSERT INTO notifications (user_id, type, title, message, link, metadata)
  VALUES (p_user_id, p_type, p_title, p_message, p_link, p_metadata);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_user] user=% err=%', p_user_id, SQLERRM;
END;
$$;

-- ── 6. Trigger: requirements ──────────────────────────────────────────────────
-- Logic:
--   INSERT  → notify Operations Manager + Admin, but NOT the person who created it
--             (if Admin creates, they don't get a redundant self-notification)
--   → Approved   : notify the creator
--   → Rejected   : notify the creator
--   → Needs review: notify Operations Manager
CREATE FUNCTION trg_requirements_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator TEXT;
BEGIN
  v_creator := COALESCE(NEW.created_by::TEXT, '');

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Operations Manager', 'Admin'],
      'requirement',
      'New Requirement Submitted',
      COALESCE(NEW.requirement_summary, 'A new requirement has been submitted.'),
      '/requirements',
      '{}',
      v_creator   -- exclude the creator so they don't notify themselves
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Approved' THEN
      PERFORM notify_user(
        v_creator, 'requirement', 'Requirement Approved',
        'Your requirement "' || COALESCE(NEW.requirement_summary,'') || '" has been approved.',
        '/requirements'
      );
    ELSIF NEW.status = 'Rejected' THEN
      PERFORM notify_user(
        v_creator, 'requirement', 'Requirement Rejected',
        'Your requirement "' || COALESCE(NEW.requirement_summary,'') || '" was not approved.',
        '/requirements'
      );
    ELSIF NEW.status IN ('Operations Review', 'Pending Review') THEN
      PERFORM notify_by_roles(
        ARRAY['Operations Manager'],
        'requirement', 'Requirement Needs Your Review',
        '"' || COALESCE(NEW.requirement_summary,'') || '" is awaiting operations review.',
        '/requirements'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_requirements_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_requirements_notify
  AFTER INSERT OR UPDATE ON requirements
  FOR EACH ROW EXECUTE FUNCTION trg_requirements_notify();

-- ── 7. Trigger: quotations ────────────────────────────────────────────────────
-- Logic:
--   INSERT               → Finance Officer + Admin (excluding creator)
--   → Approved/Accepted  : notify creator, Operations Manager, Dispatch Coordinator, Finance Officer
--                          (quotation approval = equipment is going out, ops + dispatch must act)
--   → Rejected           : notify creator
--   → Sent               : Finance Officer + Admin
CREATE FUNCTION trg_quotations_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_creator TEXT;
BEGIN
  v_creator := COALESCE(NEW.prepared_by::TEXT, '');

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Finance Officer', 'Admin'],
      'quotation', 'New Quotation Created',
      'A new quotation has been created and requires attention.',
      '/quotations', '{}', v_creator
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status IN ('Approved', 'Accepted') THEN
      -- Notify the person who prepared the quotation
      PERFORM notify_user(
        v_creator, 'quotation', 'Quotation Approved',
        'Your quotation has been approved. Equipment dispatch can proceed.',
        '/quotations'
      );
      -- Notify Operations Manager — they need to coordinate the dispatch
      PERFORM notify_by_roles(
        ARRAY['Operations Manager'],
        'quotation', 'Quotation Approved — Dispatch Required',
        'A quotation has been approved. Equipment is ready to be dispatched.',
        '/dispatch'
      );
      -- Notify Dispatch Coordinator — they create the actual dispatch orders
      PERFORM notify_by_roles(
        ARRAY['Dispatch Coordinator'],
        'quotation', 'New Dispatch Order Needed',
        'A quotation has been approved. Please create the dispatch order.',
        '/dispatch'
      );
      -- Notify Finance Officer — may need to raise an invoice
      PERFORM notify_by_roles(
        ARRAY['Finance Officer'],
        'quotation', 'Quotation Approved — Invoice Pending',
        'An approved quotation is ready for invoicing.',
        '/finance'
      );
    ELSIF NEW.status = 'Rejected' THEN
      PERFORM notify_user(
        v_creator, 'quotation', 'Quotation Rejected',
        'Your quotation has been rejected. Please review and revise if needed.',
        '/quotations'
      );
    ELSIF NEW.status = 'Sent' THEN
      PERFORM notify_by_roles(
        ARRAY['Finance Officer', 'Admin'],
        'quotation', 'Quotation Sent to Customer',
        'A quotation has been sent to the customer and is awaiting their response.',
        '/quotations', '{}', v_creator
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_quotations_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_quotations_notify
  AFTER INSERT OR UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION trg_quotations_notify();

-- ── 8. Trigger: dispatches ────────────────────────────────────────────────────
CREATE FUNCTION trg_dispatches_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Dispatch Coordinator', 'Operations Manager'],
      'dispatch', 'New Dispatch Created',
      'A new dispatch order has been created and requires action.',
      '/dispatch'
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'In Transit' THEN
      PERFORM notify_by_roles(
        ARRAY['Operations Manager', 'Admin'],
        'dispatch', 'Dispatch In Transit',
        'A dispatch is now in transit to the destination.',
        '/dispatch'
      );
    ELSIF NEW.status = 'Completed' THEN
      PERFORM notify_by_roles(
        ARRAY['Operations Manager', 'Finance Officer', 'Admin'],
        'dispatch', 'Dispatch Completed',
        'A dispatch has been completed successfully.',
        '/dispatch'
      );
    ELSIF NEW.status = 'Assigned' THEN
      PERFORM notify_by_roles(
        ARRAY['Dispatch Coordinator'],
        'dispatch', 'Dispatch Assigned',
        'A pending dispatch has been assigned and is ready to proceed.',
        '/dispatch'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_dispatches_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_dispatches_notify
  AFTER INSERT OR UPDATE ON dispatches
  FOR EACH ROW EXECUTE FUNCTION trg_dispatches_notify();

-- ── 9. Trigger: maintenance ───────────────────────────────────────────────────
CREATE FUNCTION trg_maintenance_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Maintenance Engineer', 'Operations Manager'],
      'maintenance', 'New Maintenance Job',
      'New job logged: ' || COALESCE(NEW.issue, 'maintenance required'),
      '/maintenance'
    );
    -- Also notify the specifically assigned engineer
    IF NEW.assigned_to IS NOT NULL THEN
      PERFORM notify_user(
        NEW.assigned_to::TEXT, 'maintenance',
        'Maintenance Job Assigned to You',
        'You have been assigned: ' || COALESCE(NEW.issue, 'a maintenance job'),
        '/maintenance'
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Completed' THEN
      PERFORM notify_by_roles(
        ARRAY['Operations Manager', 'Warehouse Operator', 'Admin'],
        'maintenance', 'Maintenance Completed',
        'Job completed: ' || COALESCE(NEW.issue, 'maintenance job'),
        '/maintenance'
      );
    ELSIF NEW.status = 'In Progress' THEN
      PERFORM notify_by_roles(
        ARRAY['Operations Manager'],
        'maintenance', 'Maintenance In Progress',
        'Job in progress: ' || COALESCE(NEW.issue, 'maintenance job'),
        '/maintenance'
      );
    END IF;

    -- If the assigned engineer changes, notify the new assignee
    IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL THEN
      PERFORM notify_user(
        NEW.assigned_to::TEXT, 'maintenance',
        'Maintenance Job Reassigned to You',
        'You have been assigned: ' || COALESCE(NEW.issue, 'a maintenance job'),
        '/maintenance'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_maintenance_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_maintenance_notify
  AFTER INSERT OR UPDATE ON maintenance
  FOR EACH ROW EXECUTE FUNCTION trg_maintenance_notify();

-- ── 10. Trigger: invoices ─────────────────────────────────────────────────────
CREATE FUNCTION trg_invoices_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Finance Officer', 'Admin'],
      'invoice', 'New Invoice Created',
      'A new invoice has been created and requires review.',
      '/finance'
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Paid' THEN
      PERFORM notify_by_roles(
        ARRAY['Finance Officer', 'Admin'],
        'invoice', 'Invoice Paid',
        'An invoice has been marked as paid.',
        '/finance'
      );
    ELSIF NEW.status = 'Overdue' THEN
      PERFORM notify_by_roles(
        ARRAY['Finance Officer', 'Admin'],
        'invoice', 'Invoice Overdue',
        'An invoice is now overdue and requires immediate attention.',
        '/finance'
      );
    ELSIF NEW.status = 'Cancelled' THEN
      PERFORM notify_by_roles(
        ARRAY['Finance Officer', 'Admin'],
        'invoice', 'Invoice Cancelled',
        'An invoice has been cancelled.',
        '/finance'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_invoices_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_invoices_notify
  AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoices_notify();

-- ── 11. Trigger: procurements ─────────────────────────────────────────────────
CREATE FUNCTION trg_procurements_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_requester TEXT;
BEGIN
  v_requester := COALESCE(NEW.requested_by::TEXT, '');

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Procurement Manager', 'Admin'],
      'procurement', 'New Procurement Request',
      'A new procurement request has been submitted and requires review.',
      '/procurement', '{}', v_requester
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Approved' THEN
      PERFORM notify_by_roles(
        ARRAY['Procurement Manager'],
        'procurement', 'Procurement Request Approved',
        'A procurement request has been approved. Proceed with vendor sourcing.',
        '/procurement'
      );
      -- Notify the person who raised it
      IF v_requester != '' THEN
        PERFORM notify_user(
          v_requester, 'procurement', 'Your Procurement Request was Approved',
          'Your procurement request has been approved.',
          '/procurement'
        );
      END IF;
    ELSIF NEW.status = 'Rejected' THEN
      PERFORM notify_by_roles(
        ARRAY['Procurement Manager'],
        'procurement', 'Procurement Request Rejected',
        'A procurement request has been rejected.',
        '/procurement'
      );
      IF v_requester != '' THEN
        PERFORM notify_user(
          v_requester, 'procurement', 'Your Procurement Request was Rejected',
          'Your procurement request was not approved.',
          '/procurement'
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_procurements_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_procurements_notify
  AFTER INSERT OR UPDATE ON procurements
  FOR EACH ROW EXECUTE FUNCTION trg_procurements_notify();

-- ── 12. Trigger: purchase_orders ──────────────────────────────────────────────
CREATE FUNCTION trg_purchase_orders_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_by_roles(
      ARRAY['Procurement Manager', 'Admin'],
      'procurement', 'New Purchase Order',
      'A new purchase order has been created.',
      '/procurement'
    );

  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Delivered' THEN
      PERFORM notify_by_roles(
        ARRAY['Procurement Manager', 'Finance Officer', 'Warehouse Operator'],
        'procurement', 'Purchase Order Delivered',
        'A purchase order has been delivered. Please verify and update inventory.',
        '/procurement'
      );
    ELSIF NEW.status = 'Approved' THEN
      PERFORM notify_by_roles(
        ARRAY['Procurement Manager'],
        'procurement', 'Purchase Order Approved',
        'A purchase order has been approved and is ready to be sent to the vendor.',
        '/procurement'
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_purchase_orders_notify] op=% err=%', TG_OP, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_purchase_orders_notify
  AFTER INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_purchase_orders_notify();

-- ── 13. Self-test & diagnostics ───────────────────────────────────────────────
DO $$
DECLARE
  v_sent INT;
  v_trg  INT := 0;
  v_cnt  INT;
  r      RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ Notification System — Setup Complete ══';

  -- 1. List all registered triggers
  RAISE NOTICE '  Triggers:';
  FOR r IN
    SELECT trigger_name, event_object_table
    FROM information_schema.triggers
    WHERE trigger_schema = 'public' AND trigger_name LIKE 'tg_%_notify'
    ORDER BY event_object_table
  LOOP
    RAISE NOTICE '    ✓ % ON %', r.trigger_name, r.event_object_table;
    v_trg := v_trg + 1;
  END LOOP;
  IF v_trg = 0 THEN
    RAISE WARNING '  ✗ No notification triggers found! Something went wrong above.';
  ELSE
    RAISE NOTICE '  Total triggers registered: %', v_trg;
  END IF;

  -- 2. Show active user counts per role (critical for cross-role notification routing)
  RAISE NOTICE '';
  RAISE NOTICE '  Active users per role:';
  FOR r IN
    SELECT role,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(is_active,TRUE)=TRUE) AS active
    FROM users GROUP BY role ORDER BY role
  LOOP
    RAISE NOTICE '    "%" → total=%, active=%', r.role, r.total, r.active;
  END LOOP;

  -- 3. Test notify_by_roles for EACH key role (no insert, just count matching users)
  RAISE NOTICE '';
  RAISE NOTICE '  Cross-role routing check (would receive notifications):';
  FOR r IN SELECT unnest(ARRAY[
      'Admin','Operations Manager','Finance Officer',
      'Dispatch Coordinator','Procurement Manager',
      'Maintenance Engineer','Warehouse Operator'
    ]) AS role_name
  LOOP
    SELECT COUNT(*) INTO v_cnt
    FROM users
    WHERE role::TEXT = r.role_name AND COALESCE(is_active, TRUE) = TRUE;
    IF v_cnt = 0 THEN
      RAISE WARNING '    ✗ role "%" — 0 active users (notifications will be silently dropped)', r.role_name;
    ELSE
      RAISE NOTICE  '    ✓ role "%" — % active user(s)', r.role_name, v_cnt;
    END IF;
  END LOOP;

  -- 4. Send live test to Admin (verifies full insert pipeline)
  v_sent := notify_by_roles(
    ARRAY['Admin'], 'system',
    'Notification System Active',
    'Setup complete — all triggers are live. You may delete this test notification.'
  );
  RAISE NOTICE '';
  IF v_sent > 0 THEN
    RAISE NOTICE '  ✓ Live test sent to % Admin user(s). Check your bell.', v_sent;
  ELSE
    RAISE WARNING '  ✗ Live test sent to 0 Admin users — role name does not match. See step 2 above.';
  END IF;

  RAISE NOTICE '══════════════════════════════════════════';
END $$;
