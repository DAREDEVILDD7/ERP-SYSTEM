-- ══════════════════════════════════════════════════════════════════════════════
-- Chat Message Notifications
-- Run this in Supabase SQL Editor AFTER enable_notifications.sql has been run.
-- Safe to re-run (drops and recreates the trigger cleanly).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Clean up if re-running ────────────────────────────────────────────────────
DROP TRIGGER  IF EXISTS tg_chat_message_notify ON chat_messages;
DROP FUNCTION IF EXISTS trg_chat_message_notify();

-- ── Trigger function ──────────────────────────────────────────────────────────
-- When a message is inserted, notify:
--   • All users who have previously sent a message in the same thread
--   • The requirement creator
-- Excluding the sender themselves, and only active users.
CREATE FUNCTION trg_chat_message_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender_name TEXT;
  v_req_summary TEXT;
  v_preview     TEXT;
BEGIN
  -- Sender display name
  SELECT name INTO v_sender_name
  FROM users WHERE user_id = NEW.sender_id;

  -- Requirement summary for notification context
  SELECT requirement_summary INTO v_req_summary
  FROM requirements WHERE requirement_id = NEW.related_requirement;

  -- Message preview (capped at 100 chars)
  v_preview := LEFT(COALESCE(NEW.message, ''), 100);

  -- Insert a notification for each eligible participant
  INSERT INTO notifications (user_id, type, title, message, link, metadata)
  SELECT DISTINCT
    u.user_id,
    'chat',
    COALESCE(v_sender_name, 'Someone') || ' · ' || COALESCE(NEW.related_requirement, 'Chat'),
    v_preview,
    '/chat',
    jsonb_build_object(
      'open_id',        NEW.related_requirement,
      'requirement_id', NEW.related_requirement,
      'req_summary',    COALESCE(v_req_summary, '')
    )
  FROM (
    -- Users who have previously sent a message in this thread
    SELECT DISTINCT sender_id AS user_id
    FROM chat_messages
    WHERE related_requirement = NEW.related_requirement

    UNION

    -- Requirement creator (always notified, even if they haven't chatted yet)
    SELECT created_by AS user_id
    FROM requirements
    WHERE requirement_id = NEW.related_requirement
      AND created_by IS NOT NULL
  ) participants
  JOIN users u ON u.user_id = participants.user_id
  WHERE participants.user_id != NEW.sender_id         -- don't notify yourself
    AND COALESCE(u.is_active, TRUE) = TRUE;           -- only active users

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_chat_message_notify] req=% sender=% err=%',
    NEW.related_requirement, NEW.sender_id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ── Attach trigger ────────────────────────────────────────────────────────────
CREATE TRIGGER tg_chat_message_notify
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION trg_chat_message_notify();

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══ Chat Notification Trigger ══';
  IF EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'tg_chat_message_notify'
      AND event_object_table = 'chat_messages'
  ) THEN
    RAISE NOTICE '  ✓ tg_chat_message_notify is live on chat_messages';
  ELSE
    RAISE WARNING '  ✗ Trigger not found — check errors above';
  END IF;
  RAISE NOTICE '══════════════════════════════';
END $$;
