import { supabase } from '../lib/supabaseClient';

// ── PUBLIC (login page) ─────────────────────────────────────────────────────
// Fire-and-forget. Server always succeeds silently — the caller must never
// branch on the result (see security requirements in handoff.md).
export async function submitPasswordResetRequest(username) {
  // Client-side sanitisation is a UX helper only; the server enforces the
  // real rules. Strip anything a printable-ascii username would never contain.
  const raw = String(username == null ? '' : username);
  let clean = '';
  for (let i = 0; i < raw.length && clean.length < 100; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) clean += raw[i];
  }
  clean = clean.trim();
  if (!clean) return; // same generic outcome as any other invalid input

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;

  try {
    await supabase.rpc('submit_password_reset_request', {
      p_username:   clean,
      p_source_ip:  null,   // populated by an edge proxy in future if needed
      p_user_agent: ua,
    });
  } catch (_) {
    // Swallow — success/failure must be indistinguishable to the caller.
  }
}

// ── ADMIN ───────────────────────────────────────────────────────────────────
export async function adminListPasswordResetRequests(adminUserId, includeResolved = false) {
  const { data, error } = await supabase.rpc('admin_list_password_reset_requests', {
    p_admin_user_id:    adminUserId,
    p_include_resolved: includeResolved,
  });
  if (error) throw new Error(error.message || 'Failed to load password reset requests.');
  return data == null ? [] : data;
}


export async function adminStartPasswordResetRequest(adminUserId, requestId) {
  const { error } = await supabase.rpc('admin_start_password_reset_request', {
    p_admin_user_id: adminUserId,
    p_request_id:    requestId,
  });
  if (error) throw new Error(error.message || 'Failed to update password reset request.');
}

export async function adminCompletePasswordResetRequest(adminUserId, requestId) {
  const { error } = await supabase.rpc('admin_complete_password_reset_request', {
    p_admin_user_id: adminUserId,
    p_request_id:    requestId,
  });
  if (error) throw new Error(error.message || 'Failed to complete password reset request.');
}

export async function adminRejectPasswordResetRequest(adminUserId, requestId, reason) {
  const { error } = await supabase.rpc('admin_reject_password_reset_request', {
    p_admin_user_id: adminUserId,
    p_request_id:    requestId,
    p_reason:        reason == null ? null : reason,
  });
  if (error) throw new Error(error.message || 'Failed to reject password reset request.');
}
