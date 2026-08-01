import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  KeyRound, RefreshCw, Shield, Loader2, X, Eye, EyeOff,
  CheckCircle2, XCircle, Clock, Play, AlertCircle,
} from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { SkeletonTable } from '../../components/common/Skeleton';
import {
  adminListPasswordResetRequests,
  adminStartPasswordResetRequest,
  adminCompletePasswordResetRequest,
  adminRejectPasswordResetRequest,
} from '../../api/passwordResetRequests';

const TABLES = ['password_reset_requests'];

const STATUS_CFG = {
  'Pending':     { cls: 'bg-amber-100 text-amber-700',   icon: Clock,        label: 'Pending' },
  'In Progress': { cls: 'bg-blue-100 text-blue-700',     icon: Play,         label: 'In Progress' },
  'Completed':   { cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Completed' },
  'Rejected':    { cls: 'bg-rose-100 text-rose-700',     icon: XCircle,      label: 'Rejected' },
};

function fmtTime(iso) {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd MMM yyyy, HH:mm'); }
  catch { return iso; }
}

function timeAgo(iso) {
  if (!iso) return '';
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return ''; }
}

// ── Reset-password panel (uses existing adminResetPassword RPC) ──────────────
function ResetPasswordPanel({ request, onReset, onCancel, busy }) {
  const [pw, setPw]           = useState('');
  const [pw2, setPw2]         = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [error, setError]     = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!pw || !pw2) { setError('Both password fields are required.'); return; }
    if (pw !== pw2)  { setError('Passwords do not match.'); return; }
    if (pw.length < 6) { setError('Password must be at least 6 characters.'); return; }
    try {
      await onReset(pw);
      setPw(''); setPw2('');
    } catch (err) {
      setError(err.message || 'Reset failed.');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-gray-100 pt-4 mt-2">
      <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
        <KeyRound size={14} className="text-jtc" />
        Set new password for <span className="font-mono">{request.requesting_user}</span>
      </p>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'}
            className="input pr-10 text-sm"
            placeholder="••••••••"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Confirm Password</label>
        <input
          type={showPw ? 'text' : 'password'}
          className="input text-sm"
          placeholder="••••••••"
          value={pw2}
          onChange={e => setPw2(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={busy}
          className="btn-secondary text-sm flex-1">Cancel</button>
        <button type="submit" disabled={busy}
          className="btn-primary text-sm flex-1 flex items-center justify-center gap-2 bg-jtc hover:bg-jtc-dark">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? 'Resetting…' : 'Reset & Complete'}
        </button>
      </div>
    </form>
  );
}

// ── Reject dialog ───────────────────────────────────────────────────────────
function RejectDialog({ onSubmit, onClose, busy }) {
  const [reason, setReason] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    await onSubmit(reason.trim() || null);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle size={18} className="text-rose-500" />
            <h2 className="font-semibold text-gray-900">Reject Request</h2>
          </div>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-gray-400">(optional, max 500 chars)</span>
            </label>
            <textarea
              className="input text-sm min-h-[80px]"
              value={reason}
              onChange={e => setReason(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder="Explain why this request is being rejected…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy}
              className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy}
              className="btn-primary text-sm flex items-center gap-2 bg-rose-500 hover:bg-rose-600">
              {busy && <Loader2 size={14} className="animate-spin" />}
              Reject Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Details modal ───────────────────────────────────────────────────────────
function RequestDetailModal({ request, onClose, onRefresh }) {
  const { profile, adminResetPassword } = useAuth();
  const [action, setAction]     = useState(null); // 'start' | 'reset' | 'reject' | 'complete'
  const [showReject, setShowReject] = useState(false);
  const [showResetPanel, setShowResetPanel] = useState(false);
  const isResolved = request.status === 'Completed' || request.status === 'Rejected';

  const runStart = async () => {
    setAction('start');
    try {
      await adminStartPasswordResetRequest(profile.user_id, request.request_id);
      toast.success('Marked as In Progress');
      onRefresh();
    } catch (err) {
      toast.error(err.message || 'Failed to update request.');
    } finally {
      setAction(null);
    }
  };

  const runResetAndComplete = async (newPassword) => {
    setAction('reset');
    try {
      await adminResetPassword(request.user_id, newPassword);
      await adminCompletePasswordResetRequest(profile.user_id, request.request_id);
      toast.success('Password reset and request marked completed.');
      setShowResetPanel(false);
      onRefresh();
      onClose();
    } catch (err) {
      // Bubble up so ResetPasswordPanel can render the error inline.
      throw err;
    } finally {
      setAction(null);
    }
  };

  const runReject = async (reason) => {
    setAction('reject');
    try {
      await adminRejectPasswordResetRequest(profile.user_id, request.request_id, reason);
      toast.success('Request rejected.');
      setShowReject(false);
      onRefresh();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to reject request.');
      setAction(null);
    }
  };

  const scfg = STATUS_CFG[request.status] || STATUS_CFG['Pending'];
  const StatusIcon = scfg.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-jtc" />
            <h3 className="font-semibold text-gray-900">Password Reset Request</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{request.requesting_name}</p>
              <p className="text-xs text-gray-500 font-mono">@{request.requesting_user}</p>
              <p className="text-xs text-gray-400 mt-1">{request.requesting_role}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${scfg.cls}`}>
              <StatusIcon size={12} />
              {scfg.label}
            </span>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-xs bg-gray-50/70 rounded-xl p-3">
            <div>
              <p className="text-gray-400">Requested</p>
              <p className="text-gray-800 font-medium mt-0.5">{fmtTime(request.created_at)}</p>
              <p className="text-gray-400 text-[10px] mt-0.5">{timeAgo(request.created_at)}</p>
            </div>
            <div>
              <p className="text-gray-400">Request ID</p>
              <p className="text-gray-700 font-mono text-[10px] mt-0.5 break-all">{request.request_id}</p>
            </div>
            {request.processed_by_name && (
              <div>
                <p className="text-gray-400">Processed by</p>
                <p className="text-gray-800 font-medium mt-0.5">{request.processed_by_name}</p>
              </div>
            )}
            {request.processed_at && (
              <div>
                <p className="text-gray-400">Processed at</p>
                <p className="text-gray-800 font-medium mt-0.5">{fmtTime(request.processed_at)}</p>
              </div>
            )}
            {request.reject_reason && (
              <div className="col-span-2">
                <p className="text-gray-400">Reject reason</p>
                <p className="text-gray-700 mt-0.5">{request.reject_reason}</p>
              </div>
            )}
          </div>

          {/* Guidance */}
          {!isResolved && !showResetPanel && (
            <div className="text-xs text-gray-500 bg-blue-50/50 border border-blue-100 rounded-xl p-3 leading-relaxed">
              Use the actions below to reset this user's password. Completing a
              reset marks this request as <span className="font-semibold">Completed</span> and removes
              it from the pending queue.
            </div>
          )}

          {/* Action buttons */}
          {!isResolved && !showResetPanel && (
            <div className="flex flex-wrap gap-2 pt-1">
              {request.status === 'Pending' && (
                <button
                  onClick={runStart}
                  disabled={action !== null}
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  {action === 'start' && <Loader2 size={13} className="animate-spin" />}
                  <Play size={13} /> Mark In Progress
                </button>
              )}
              <button
                onClick={() => setShowResetPanel(true)}
                disabled={action !== null}
                className="btn-primary text-sm flex items-center gap-2 bg-jtc hover:bg-jtc-dark"
              >
                <KeyRound size={13} /> Reset Password & Complete
              </button>
              <button
                onClick={() => setShowReject(true)}
                disabled={action !== null}
                className="btn-secondary text-sm flex items-center gap-2 text-rose-600 hover:bg-rose-50"
              >
                <XCircle size={13} /> Reject
              </button>
            </div>
          )}

          {showResetPanel && (
            <ResetPasswordPanel
              request={request}
              onReset={runResetAndComplete}
              onCancel={() => setShowResetPanel(false)}
              busy={action === 'reset'}
            />
          )}
        </div>
      </div>

      {showReject && (
        <RejectDialog
          onSubmit={runReject}
          onClose={() => setShowReject(false)}
          busy={action === 'reject'}
        />
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function PasswordResetRequests() {
  const { profile } = useAuth();
  const { canResetPasswords } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();

  const [rows,            setRows]            = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [selectedId,      setSelectedId]      = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!profile?.user_id || !canResetPasswords) return;
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const data = await adminListPasswordResetRequests(profile.user_id, includeResolved);
      setRows(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load password reset requests.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.user_id, canResetPasswords, includeResolved]);

  useEffect(() => { load(); }, [load]);
  const realtimeLoad = useCallback(() => load(true), [load]);
  useRealtimeRefresh(TABLES, realtimeLoad);

  // Open a specific request when navigated with { state: { openId } }
  useEffect(() => {
    const openId = location.state?.openId;
    if (openId && rows.some(r => r.request_id === openId)) {
      setSelectedId(openId);
      // Clear routing state so a browser back/forward doesn't reopen it
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, rows, navigate]);

  const selected = useMemo(
    () => rows.find(r => r.request_id === selectedId) || null,
    [rows, selectedId],
  );

  const pendingCount = useMemo(
    () => rows.filter(r => r.status === 'Pending' || r.status === 'In Progress').length,
    [rows],
  );

  if (!canResetPasswords) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield size={44} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">Permission required</p>
          <p className="text-gray-400 text-sm mt-1">
            You have not been granted permission to process password reset requests.
            Ask your Super Admin to grant it from Roles &amp; Permissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <KeyRound size={18} className="text-jtc" />
            Password Reset Requests
          </h1>
          <p className="text-sm text-gray-400">
            {pendingCount} open{pendingCount === 1 ? '' : ''} · {rows.length} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-500 select-none">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={e => setIncludeResolved(e.target.checked)}
              className="w-4 h-4 accent-jtc"
            />
            Include resolved
          </label>
          <button
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="btn-secondary p-2"
            title="Refresh"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <SkeletonTable rows={6} colWidths={[140, 120, 110, 130, 100, 90]} />
      ) : rows.length === 0 ? (
        <div className="card p-12 text-center">
          <AlertCircle size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No password reset requests</p>
          <p className="text-gray-400 text-sm mt-1">
            {includeResolved ? 'No history to display yet.' : 'The queue is empty.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">User</th>
                  <th className="text-left px-5 py-3">Role</th>
                  <th className="text-left px-5 py-3">Requested</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Processed By</th>
                  <th className="text-left px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => {
                  const scfg = STATUS_CFG[r.status] || STATUS_CFG['Pending'];
                  const StatusIcon = scfg.icon;
                  return (
                    <tr key={r.request_id} className="hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{r.requesting_name}</p>
                        <p className="text-xs text-gray-400 font-mono">@{r.requesting_user}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{r.requesting_role}</td>
                      <td className="px-5 py-3">
                        <p className="text-xs text-gray-700 font-mono">{fmtTime(r.created_at)}</p>
                        <p className="text-[10px] text-gray-400">{timeAgo(r.created_at)}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${scfg.cls}`}>
                          <StatusIcon size={11} />
                          {scfg.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-500">
                        {r.processed_by_name || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => setSelectedId(r.request_id)}
                          className="text-xs text-primary-500 hover:underline"
                        >
                          {r.status === 'Pending' || r.status === 'In Progress' ? 'Open' : 'View'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map(r => {
              const scfg = STATUS_CFG[r.status] || STATUS_CFG['Pending'];
              const StatusIcon = scfg.icon;
              return (
                <div
                  key={r.request_id}
                  className="card p-4 flex items-start justify-between gap-3"
                  onClick={() => setSelectedId(r.request_id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 truncate">{r.requesting_name}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">@{r.requesting_user}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(r.created_at)}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${scfg.cls}`}>
                    <StatusIcon size={11} />
                    {scfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail modal */}
      {selected && (
        <RequestDetailModal
          request={selected}
          onClose={() => setSelectedId(null)}
          onRefresh={() => load(true)}
        />
      )}
    </div>
  );
}
