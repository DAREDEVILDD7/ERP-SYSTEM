import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // This app does not use Supabase Auth at all — sign-in is the `verify_login`
  // RPC and the session lives in sessionStorage (see context/AuthContext).
  // There is no `supabase.auth.*` call anywhere in src. The GoTrue client is
  // still constructed by createClient, but leaving these on had it run a
  // token-refresh timer for a session that never exists, re-parse the URL for
  // an auth callback on every load, and touch localStorage on boot. Turning
  // them off removes that background work without changing any code path.
  // If Supabase Auth is ever actually adopted, turn all three back on.
  auth: {
    autoRefreshToken:    false,
    persistSession:      false,
    detectSessionInUrl:  false,
    storageKey:          'kw-ops-auth',
    storage:             window.localStorage,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
  global: {
    headers: { 'x-application-name': 'kw-ops-erp' },
  },
});

export default supabase;