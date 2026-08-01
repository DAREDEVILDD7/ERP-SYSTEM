import { useEffect, useState, useCallback, useMemo } from 'react';
import { getUsers, updateUser } from '../../api/users';
import {
  adminSetUserRole, adminSetUserActive, adminCreateUser,
  adminSetUserModuleOverride, adminClearUserModuleOverride,
  getRolePermissions, getModules, getUserModuleOverrides,
} from '../../api/admin';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import StatusBadge from '../../components/common/StatusBadge';
import { SkeletonTable } from '../../components/common/Skeleton';
import { X, Loader2, RefreshCw, KeyRound, Eye, EyeOff, ChevronDown, ChevronUp, Plus, ShieldCheck, RotateCcw, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

const TABLES = ['users'];
const ROLES = ['Admin','Sales Executive','Operations Manager','Warehouse Operator','Dispatch Coordinator','Finance Officer','Maintenance Engineer','Procurement Manager','Head of IT'];
const DEPTS = ['Admin','Sales','Operations','Warehouse','Dispatch','Finance','Maintenance','Procurement','IT'];
const NEW_USER_EMPTY = { name: '', username: '', email: '', role: 'Sales Executive', department: 'Sales', password: '' };

export default function UserManagement() {
  const { profile, adminResetPassword, isSuperAdmin } = useAuth();
  const { canResetPasswords } = usePermissions();
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

  // create-user state (Super Admin only)
  const [showCreate,    setShowCreate]    = useState(false);
  const [newUser,       setNewUser]       = useState(NEW_USER_EMPTY);
  const [createLoading, setCreateLoading] = useState(false);

  // per-user module override state (Super Admin only). All three arrays are
  // fetched together the moment the edit dialog opens and refreshed on any
  // per-user mutation - never on unrelated dialog re-renders. `busyOverride`
  // guards a single (moduleKey, field) cell against double-clicks.
  const [showOverrides,  setShowOverrides]  = useState(false);
  const [modulesList,    setModulesList]    = useState([]);
  const [rolePermsList,  setRolePermsList]  = useState([]);
  const [userOverrides,  setUserOverrides]  = useState([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [busyOverride,   setBusyOverride]   = useState(null);

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
    setShowOverrides(false);
    setUserOverrides([]);
  };

  // Fetches the three inputs the override UI needs. Called on-demand the
  // first time the section is expanded, and again after any set/clear so
  // the grid re-renders with fresh state. Kept outside `load()` so the
  // whole users table doesn't re-fetch when the Super Admin toggles a
  // single cell.
  const loadOverrideInputs = useCallback(async (targetId) => {
    if (!targetId) return;
    setOverridesLoading(true);
    try {
      const [mods, rp, ov] = await Promise.all([
        getModules(),
        getRolePermissions(),
        getUserModuleOverrides(targetId),
      ]);
      setModulesList(mods);
      setRolePermsList(rp);
      setUserOverrides(ov);
    } catch (err) {
      toast.error(err.message || 'Failed to load user permissions');
    } finally {
      setOverridesLoading(false);
    }
  }, []);

  const openOverrides = () => {
    setShowOverrides(v => {
      const next = !v;
      if (next && selected?.user_id) loadOverrideInputs(selected.user_id);
      return next;
    });
  };

  // Effective (role × user-override) view for the grid rows. Uses the same
  // "override takes precedence over role" evaluation the runtime context
  // uses, so what the Super Admin sees here is what the target user will
  // see live once the change propagates.
  const overrideMap = useMemo(() => {
    const m = new Map();
    userOverrides.forEach(o => m.set(o.module_key, { can_view: o.can_view, can_edit: o.can_edit }));
    return m;
  }, [userOverrides]);

  const rolePermMap = useMemo(() => {
    const m = new Map();
    rolePermsList.forEach(r => m.set(`${r.role}:${r.module_key}`, { can_view: r.can_view, can_edit: r.can_edit }));
    return m;
  }, [rolePermsList]);

  // Both non-Super-Admin write paths guard on both isSuperAdmin AND selected -
  // avoids a stale click after the dialog is closed mid-request from firing
  // an RPC against no user.
  const toggleOverrideCell = async (moduleKey, field) => {
    if (!isSuperAdmin || !selected?.user_id) return;
    const cellKey = `${moduleKey}:${field}`;
    const override = overrideMap.get(moduleKey);
    const role = form.role;
    const rolePerm = rolePermMap.get(`${role}:${moduleKey}`) ?? { can_view: false, can_edit: false };
    const current = override ?? rolePerm;
    const next = { can_view: current.can_view, can_edit: current.can_edit, [field]: !current[field] };
    // view off implies edit off - identical rule to PermissionsManagement's
    // role grid, mirrored here so the two UIs stay consistent.
    if (field === 'can_view' && !next.can_view) next.can_edit = false;

    setBusyOverride(cellKey);
    try {
      await adminSetUserModuleOverride(profile.user_id, selected.user_id, moduleKey, next.can_view, next.can_edit);
      await loadOverrideInputs(selected.user_id);
    } catch (err) {
      toast.error(err.message || 'Failed to update user permission');
    } finally {
      setBusyOverride(null);
    }
  };

  const clearOverride = async (moduleKey) => {
    if (!isSuperAdmin || !selected?.user_id) return;
    const cellKey = `${moduleKey}:clear`;
    setBusyOverride(cellKey);
    try {
      await adminClearUserModuleOverride(profile.user_id, selected.user_id, moduleKey);
      await loadOverrideInputs(selected.user_id);
    } catch (err) {
      toast.error(err.message || 'Failed to clear override');
    } finally {
      setBusyOverride(null);
    }
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
      // Role and active-status are privilege-sensitive - routed through the
      // server-verified RPCs (which re-check the actor's own role fresh from
      // the database) rather than the plain table write below, which has no
      // such check and must never be used for these two fields.
      if (form.role !== selected.role) {
        await adminSetUserRole(profile.user_id, selected.user_id, form.role);
      }
      if (form.is_active !== selected.is_active) {
        await adminSetUserActive(profile.user_id, selected.user_id, form.is_active);
      }
      await updateUser(selected.user_id, { name: form.name, username: form.username, department: form.department });
      toast.success('User updated');
      setSelected(null);
      load();
    } catch (err) { toast.error(err.message || 'Failed to update');
    } finally { setFormLoading(false); }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.email || !newUser.password) {
      toast.error('All fields are required.'); return;
    }
    if (newUser.password.length < 6) {
      toast.error('Password must be at least 6 characters.'); return;
    }
    setCreateLoading(true);
    try {
      await adminCreateUser(profile.user_id, newUser);
      toast.success(`User "${newUser.name}" created`);
      setShowCreate(false);
      setNewUser(NEW_USER_EMPTY);
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to create user.');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          <p className="text-sm text-gray-400">{users.length} users</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 text-sm">
              <Plus size={15} /> New User
            </button>
          )}
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={16} /></button>
        </div>
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
                  <select
                    className="input disabled:opacity-50 disabled:cursor-not-allowed"
                    value={form.role}
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? 'Only Super Admin can change roles' : undefined}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  >
                    {(isSuperAdmin ? ['Super Admin', ...ROLES] : ROLES).map(r => <option key={r}>{r}</option>)}
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
                <input
                  type="checkbox" id="active" checked={form.is_active}
                  disabled={!isSuperAdmin && ['Admin', 'Super Admin'].includes(selected?.role)}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="w-4 h-4 accent-primary-500 disabled:opacity-50"
                />
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

            {/* ── User Permissions (Super Admin only, non-Super-Admin targets) ──
                Per-user override on top of the role permission matrix. Rows
                mirror the modules table; each module shows role default vs
                any active override, plus a "reset to role default" action
                that DELETEs the override row so the user re-inherits from
                their role. Super Admin's access is unconditional, so the
                section is hidden entirely for that target - overrides on
                it would be silently ignored by the runtime, and the RPC
                refuses to write it anyway. */}
            {isSuperAdmin && selected?.role !== 'Super Admin' && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={openOverrides}
                className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-gray-400" />
                  User Permissions
                  <span className="text-[11px] text-gray-400 font-normal">
                    · overrides role for this user only
                  </span>
                </span>
                {showOverrides ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showOverrides && (
                <div className="px-5 pb-5">
                  {overridesLoading ? (
                    <div className="py-6 flex items-center justify-center text-gray-400 text-sm">
                      <Loader2 size={14} className="animate-spin mr-2" /> Loading…
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                        Role permissions apply to every {form.role}. An override
                        here changes access for <span className="font-medium text-gray-600">{selected.name}</span> only —
                        no one else in this role is affected. Clear the override to fall back to the role default.
                      </p>

                      <div className="border border-gray-100 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50/60 text-xs text-gray-500 uppercase">
                              <th className="text-left px-3 py-2 font-semibold">Module</th>
                              <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">Role default</th>
                              <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">Effective</th>
                              <th className="text-right px-3 py-2 font-semibold w-8"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {modulesList.map(m => {
                              const rolePerm = rolePermMap.get(`${form.role}:${m.module_key}`) ?? { can_view: false, can_edit: false };
                              const override = overrideMap.get(m.module_key);
                              const effective = override ?? rolePerm;
                              const isOverridden = !!override;
                              const busy = busyOverride?.startsWith(`${m.module_key}:`);

                              return (
                                <tr key={m.module_key} className="hover:bg-gray-50/60">
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{m.label}</td>
                                  <td className="px-2 py-2">
                                    <div className="flex items-center justify-center gap-1.5 text-gray-400">
                                      <Eye size={13} className={rolePerm.can_view ? 'text-indigo-400' : 'text-gray-200'} />
                                      <Pencil size={13} className={rolePerm.can_edit ? 'text-amber-400' : 'text-gray-200'} />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        title="View access"
                                        disabled={busy}
                                        onClick={() => toggleOverrideCell(m.module_key, 'can_view')}
                                        className={`p-1 rounded disabled:opacity-40 ${effective.can_view ? 'text-indigo-600 bg-indigo-50' : 'text-gray-300'} ${isOverridden ? 'ring-1 ring-indigo-200' : ''}`}
                                      >
                                        <Eye size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        title="Edit access"
                                        disabled={busy || !effective.can_view}
                                        onClick={() => toggleOverrideCell(m.module_key, 'can_edit')}
                                        className={`p-1 rounded disabled:opacity-40 ${effective.can_edit ? 'text-amber-600 bg-amber-50' : 'text-gray-300'} ${isOverridden ? 'ring-1 ring-amber-200' : ''}`}
                                      >
                                        <Pencil size={13} />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {isOverridden ? (
                                      <button
                                        type="button"
                                        title="Reset to role default"
                                        disabled={busy}
                                        onClick={() => clearOverride(m.module_key)}
                                        className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-40"
                                      >
                                        {busyOverride === `${m.module_key}:clear`
                                          ? <Loader2 size={13} className="animate-spin" />
                                          : <RotateCcw size={13} />}
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-gray-300 uppercase tracking-wide">inherit</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        Rings around a toggle indicate an active override.
                        Changes propagate live — this user's browser updates without a logout.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            )}

            {/* ── Reset Password (only shown if this admin has been granted it) ── */}
            {canResetPasswords && (
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
            )}
          </div>
        </div>
      )}

      {/* ── Create User (Super Admin only) ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">New User</h3>
              <button onClick={() => setShowCreate(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleCreateUser} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input className="input" value={newUser.name} onChange={e => setNewUser(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input className="input" value={newUser.username} onChange={e => setNewUser(f => ({ ...f, username: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" className="input" value={newUser.email} onChange={e => setNewUser(f => ({ ...f, email: e.target.value }))} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select className="input" value={newUser.role} onChange={e => setNewUser(f => ({ ...f, role: e.target.value }))}>
                    {['Super Admin', ...ROLES].map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                  <select className="input" value={newUser.department} onChange={e => setNewUser(f => ({ ...f, department: e.target.value }))}>
                    {DEPTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Password</label>
                <input type="password" className="input" placeholder="••••••••" value={newUser.password} onChange={e => setNewUser(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" required />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreate(false); setNewUser(NEW_USER_EMPTY); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createLoading} className="btn-primary flex items-center gap-2">
                  {createLoading && <Loader2 size={14} className="animate-spin" />}
                  {createLoading ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}