import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { getUsers } from '../../api/users';
import {
  getRolePermissions, getModules, getUserPermissionOverrides,
  adminSetRolePermission, adminSetModuleEnabled, adminGrantUserPermission,
} from '../../api/admin';
import { ROLES } from '../../lib/rolePermissions';
import { SkeletonTable } from '../../components/common/Skeleton';
import { Shield, ShieldCheck, Eye, Pencil, ToggleLeft, ToggleRight, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

const TABLES = ['role_permissions', 'modules', 'user_permission_overrides', 'users'];
const EDITABLE_ROLES = Object.values(ROLES).filter(r => r !== ROLES.SUPER_ADMIN);

export default function PermissionsManagement() {
  const { profile, isSuperAdmin } = useAuth();
  const { reloadPermissions } = usePermissions();

  const [rolePerms, setRolePerms] = useState([]);
  const [modules,   setModules]   = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [admins,    setAdmins]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [busyKey,   setBusyKey]   = useState(null); // guards a single cell against double-clicks

  const load = useCallback(async () => {
    try {
      const [rp, mods, ov, users] = await Promise.all([
        getRolePermissions(), getModules(), getUserPermissionOverrides(), getUsers(),
      ]);
      setRolePerms(rp);
      setModules(mods);
      setOverrides(ov);
      setAdmins(users.filter(u => u.role === ROLES.ADMIN));
    } catch (err) {
      toast.error(err.message || 'Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(TABLES, load);

  const permMap = useMemo(() => {
    const m = new Map();
    rolePerms.forEach(r => m.set(`${r.role}:${r.module_key}`, r));
    return m;
  }, [rolePerms]);

  const overrideMap = useMemo(() => {
    const m = new Map();
    overrides.forEach(o => m.set(`${o.user_id}:${o.permission_key}`, o.granted));
    return m;
  }, [overrides]);

  const toggleCell = async (role, moduleKey, field) => {
    const key = `${role}:${moduleKey}`;
    const current = permMap.get(key) ?? { can_view: false, can_edit: false };
    const next = { can_view: current.can_view, can_edit: current.can_edit, [field]: !current[field] };
    // view off implies edit off — an edit right without view access is meaningless
    if (field === 'can_view' && !next.can_view) next.can_edit = false;

    setBusyKey(key);
    try {
      await adminSetRolePermission(profile.user_id, role, moduleKey, next.can_view, next.can_edit);
      await load();
      reloadPermissions();
    } catch (err) {
      toast.error(err.message || 'Failed to update permission');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleModule = async (moduleKey, isEnabled) => {
    setBusyKey(`mod:${moduleKey}`);
    try {
      await adminSetModuleEnabled(profile.user_id, moduleKey, !isEnabled);
      await load();
      reloadPermissions();
    } catch (err) {
      toast.error(err.message || 'Failed to update module');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleResetGrant = async (targetId, granted) => {
    setBusyKey(`grant:${targetId}`);
    try {
      await adminGrantUserPermission(profile.user_id, targetId, 'password_reset', !granted);
      await load();
      toast.success(!granted ? 'Password-reset permission granted' : 'Password-reset permission revoked');
    } catch (err) {
      toast.error(err.message || 'Failed to update grant');
    } finally {
      setBusyKey(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield size={44} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">Super Admin access required</p>
          <p className="text-gray-400 text-sm mt-1">Only the Super Admin can manage roles and permissions.</p>
        </div>
      </div>
    );
  }

  if (loading) return <SkeletonTable rows={8} colWidths={[140, 100, 100, 100, 100, 100]} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={20} className="text-indigo-500" /> Roles &amp; Permissions
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Changes apply instantly across every active session — no logout required.
        </p>
      </div>

      {/* Modules */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Modules</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {modules.map(m => (
            <button
              key={m.module_key}
              disabled={busyKey === `mod:${m.module_key}`}
              onClick={() => toggleModule(m.module_key, m.is_enabled)}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50 ${
                m.is_enabled ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-gray-100 bg-gray-50 text-gray-400'
              }`}
            >
              <span className="truncate">{m.label}</span>
              {m.is_enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            </button>
          ))}
        </div>
      </div>

      {/* Role × module grid */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                {modules.map(m => (
                  <th key={m.module_key} className="text-center px-2 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {EDITABLE_ROLES.map(role => (
                <tr key={role} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{role}</td>
                  {modules.map(m => {
                    const key = `${role}:${m.module_key}`;
                    const row = permMap.get(key) ?? { can_view: false, can_edit: false };
                    const busy = busyKey === key;
                    return (
                      <td key={m.module_key} className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            title="View access"
                            disabled={busy}
                            onClick={() => toggleCell(role, m.module_key, 'can_view')}
                            className={`p-1 rounded disabled:opacity-40 ${row.can_view ? 'text-indigo-600 bg-indigo-50' : 'text-gray-300'}`}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            title="Edit access"
                            disabled={busy || !row.can_view}
                            onClick={() => toggleCell(role, m.module_key, 'can_edit')}
                            className={`p-1 rounded disabled:opacity-40 ${row.can_edit ? 'text-amber-600 bg-amber-50' : 'text-gray-300'}`}
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Password-reset grants */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
          <KeyRound size={15} className="text-gray-400" /> Password reset permission
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Off by default for every Admin. Grant it individually to let a specific Admin process password-reset requests.
        </p>
        {admins.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No Admin-role users yet.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {admins.map(a => {
              const granted = overrideMap.get(`${a.user_id}:password_reset`) ?? false;
              const busy = busyKey === `grant:${a.user_id}`;
              return (
                <li key={a.user_id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                    <p className="text-xs text-gray-400">@{a.username}</p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => toggleResetGrant(a.user_id, granted)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium disabled:opacity-50 ${
                      granted ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {granted ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    {granted ? 'Granted' : 'Not granted'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
