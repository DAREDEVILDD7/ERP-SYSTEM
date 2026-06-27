import { supabase } from '../lib/supabaseClient';

export async function startSessionLog(profile) {
  const { data, error } = await supabase
    .from('session_logs')
    .insert({
      user_id:    profile.user_id,
      username:   profile.username,
      name:       profile.name       ?? null,
      role:       profile.role       ?? null,
      department: profile.department ?? null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    .select('session_log_id')
    .single();
  if (error) {
    console.warn('[SessionLog] start failed:', error.message);
    return null;
  }
  return data.session_log_id;
}

export async function endSessionLog(sessionLogId) {
  if (!sessionLogId) return;
  const { error } = await supabase
    .from('session_logs')
    .update({ logged_out_at: new Date().toISOString() })
    .eq('session_log_id', sessionLogId)
    .is('logged_out_at', null);
  if (error) console.warn('[SessionLog] end failed:', error.message);
}

export async function getSessionLogs(filters = {}) {
  let query = supabase
    .from('session_logs')
    .select('*')
    .order('logged_in_at', { ascending: false })
    .limit(500);

  if (filters.user_id) query = query.eq('user_id', filters.user_id);
  if (filters.role)    query = query.eq('role', filters.role);
  if (filters.from)    query = query.gte('logged_in_at', filters.from);
  if (filters.to)      query = query.lte('logged_in_at', filters.to);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
