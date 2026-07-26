import { useEffect, useState, useCallback } from 'react';
import { getUsers, updateUser } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import StatusBadge from '../../components/common/StatusBadge';
import { SkeletonTable } from '../../components/common/Skeleton';
import { X, Loader2, RefreshCw, KeyRound, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';

const TABLES = ['users'];
const ROLES = ['Admin','Sales Executive','Operations Manager','Warehouse Operator','Dispatch Coordinator','Finance Officer','Maintenance Engineer','Procurement Manager','Head of IT'];
const DEPTS = ['Admin','Sales','Operations','Warehouse','Dispatch','Finance','Maintenance','Procurement','IT'];

export default function UserManagement() {
  const { adminResetPassword } = useAuth();
  const [users,       setUsers]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [form,        setForm]        = useState({});
  const [formLoading, setFormLoading] = useState(false);

  // password reset state
  const [showPwSection, setShowPwSection] = useState(false);
  const [pwForm,        setPwForm]        = useState({ newPassword: '', confirmPassword: '' });
  const [showPw,        setShowPw]        = useState(false);
  const [pwLoading,     setPwLoading]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await getUsers()); }
    catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(TABLES, load);

  const openEdit = (u) => {
    setForm({ name: u.name, role: u.role, department: u.department, username: u.username??'', is_active: u.is_active });
    setSelected(u);
    setShowPwSection(false);
    setPwForm({ newPassword: '', confirmPassword: '' });
    setShowPw(false);
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    if (!pwForm.newPassword || !pwForm.confirmPassword) {
      toast.error('Both password fields are required.'); return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast.error('Passwords do not match.'); return;
    }
    if (pwForm.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters.'); return;
    }
    setPwLoading(true);
    try {
      await adminResetPassword(selected.user_id, pwForm.newPassword);
      toast.success(`Password reset for ${selected.name}`);
      setShowPwSection(false);
      setPwForm({ newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.message || 'Password reset failed.');
    } finally {
      setPwLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      await updateUser(selected.user_id, form);
      toast.success('User updated');
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message || 'Failed to update');
    } finally { setFormLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          <p className="text-sm text-gray-400">{users.length} users</p>
        </div>
        <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16} /></button>
      </div>

      {loading ? <SkeletonTable rows={8} colWidths={[90, 120, 100, 100, 110, 70, 70]} /> : (
        <>
          <div className="card hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left px-5 py-3">User ID</th>
                  <th className="text-left px-5 py-3">Name</th>
                  <th className="text-left px-5 py-3">Username</th>
                  <th className="text-left px-5 py-3">Role</th>
                  <th className="text-left px-5 py-3">Department</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.user_id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{u.user_id}</td>
                    <td className="px-5 py-3 font-medium text-gray-800">{u.name}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{u.username ?? '—'}</td>
                    <td className="px-5 py-3"><span className="badge bg-blue-50 text-blue-700 border border-blue-100">{u.role}</span></td>
                    <td className="px-5 py-3 text-gray-500">{u.department}</td>
                    <td className="px-5 py-3"><StatusBadge status={u.is_active ? 'Available' : 'Retired'} /></td>
                    <td className="px-5 py-3"><button onClick={() => openEdit(u)} className="text-xs text-gray-500 hover:text-gray-700 hover:underline">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {users.map(u => (
              <div key={u.user_id} className="card p-4 flex items-center justify-between" onClick={() => openEdit(u)}>
                <div>
                  <p className="font-medium text-gray-800">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.role} · {u.department}</p>
                  <p className="text-xs text-gray-300 font-mono">{u.username}</p>
                </div>
                <StatusBadge status={u.is_active ? 'Available' : 'Retired'} />
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Edit User</h3>
              <button onClick={() => setSelected(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                  <select className="input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
                    {DEPTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 accent-primary-500" />
                <label htmlFor="active" className="text-sm text-gray-700">Active</label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSelected(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary flex items-center gap-2">
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : 'Update User'}
                </button>
              </div>
            </form>

            {/* ── Reset Password ── */}
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowPwSection(v => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <KeyRound size={14} className="text-gray-400" />
                  Reset Password
                </span>
                {showPwSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showPwSection && (
                <form onSubmit={handlePasswordReset} className="px-5 pb-5 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        className="input pr-10"
                        placeholder="••••••••"
                        value={pwForm.newPassword}
                        onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))}
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                    <input
                      type={showPw ? 'text' : 'password'}
                      className="input"
                      placeholder="••••••••"
                      value={pwForm.confirmPassword}
                      onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pwLoading}
                    className="w-full btn-primary flex items-center justify-center gap-2 text-sm"
                  >
                    {pwLoading && <Loader2 size={14} className="animate-spin" />}
                    {pwLoading ? 'Resetting…' : 'Set New Password'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}