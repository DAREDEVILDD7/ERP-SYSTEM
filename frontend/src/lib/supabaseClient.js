import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// This module is imported (via AuthContext) before React mounts, so a throw
// here is a blank page with no ErrorBoundary to catch it. `createClient` would
// throw anyway, but only "supabaseUrl is required." — which does not tell a
// deployer the one thing they need to know: CRA inlines REACT_APP_* at BUILD
// time, so setting them in Vercel afterwards does nothing until a redeploy.
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl && 'REACT_APP_SUPABASE_URL',
    !supabaseAnonKey && 'REACT_APP_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(' and ');
  throw new Error(
    `Supabase configuration missing: ${missing} was not set at build time. ` +
    'Locally, add it to frontend/.env. On Vercel, add it under Settings → ' +
    'Environment Variables AND trigger a new deploy — Create React App bakes ' +
    'these into the bundle when it builds, so an existing deployment will not ' +
    'pick them up.'
  );
}

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