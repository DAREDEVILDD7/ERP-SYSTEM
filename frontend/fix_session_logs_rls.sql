-- Fix RLS policies for session_logs table
-- Run this in Supabase SQL Editor

-- Allow authenticated users to insert their own session log entry
CREATE POLICY IF NOT EXISTS "Users can insert own session log"
  ON session_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to update their own session log (for logout timestamp)
CREATE POLICY IF NOT EXISTS "Users can update own session log"
  ON session_logs
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Allow admins/IT to read all session logs (for Audit Logs page)
CREATE POLICY IF NOT EXISTS "Admins can read all session logs"
  ON session_logs
  FOR SELECT
  TO authenticated
  USING (true);
