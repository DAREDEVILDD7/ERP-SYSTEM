import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { supabase } from '../../lib/supabaseClient';
import { getUsers } from '../../api/users';
import { getSessionLogs } from '../../api/sessionLogs';
import { adminListPasswordResetRequests } from '../../api/passwordResetRequests';
import {
  getModules, getAdminAuditLog, getRolePermissions, getUserPermissionOverrides,
  adminSetModuleEnabled,
} from '../../api/admin';
import { SkeletonDashboard } from '../common/Skeleton';
import {
  ShieldCheck, Users, KeyRound, ToggleRight, ToggleLeft, RefreshCw, Activity,
  ScrollText, ShieldAlert, Tags, CheckSquare, HeartPulse, UserCog, ClipboardList,
  LayoutGrid, Settings, ChevronRight,
} from 'lucide-react';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, formatDistanceToNow } from 'date-fns';
import { Bar3D, NEO_TOOLTIP_STYLE } from './DashUtils';
import toast from 'react-hot-toast';

const TABLES = ['users', 'role_permissions', 'modules', 'user_permission_overrides', 'audit_logs'];
const MAINTENANCE_KEY = 'system_maintenance';

const ACTION_LABELS = {
  ROLE_CHANGE:        'Role changed',
  USER_ACTIVATED:     'User activated',
  USER_DEACTIVATED:   'User deactivated',
  USER_CREATED:       'User created',
  PASSWORD_RESET:     'Password reset',
  PERMISSION_CHANGE:  'Permission updated',
  MODULE_TOGGLE:      'Module toggled',
  PERMISSION_GRANT:   'Permission grant changed',
};

// Best-effort pending-approval count across a few operational tables. Each
// query is independent and never throws past this point - a missing status
// value or an unreachable table degrades the count, it never breaks the
// dashboard (reflected instead in the System Health tile below).
async function countPendingApprovals() {
  let count = 0;
  let ok = true;
  const tryCount = async (table, statuses) => {
    try {
      const { count: c, error } = await supabase
        .from(table).select('*', { count: 'exact', head: true }).in('status', statuses);
      if (error) throw error;
      count += c ?? 0;
    } catch {
      ok = false;
    }
  };
  await Promise.all([
    tryCount('requirements', ['Pending Review', 'Operations Review']),
    tryCount('quotations', ['Sent']),
  ]);
  return { count, ok };
}

export default function SuperAdminDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [maintBusy,  setMaintBusy]  = useState(false);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    let degraded = false;
    const safe = (p, fallback) => p.catch(() => { degraded = true; return fallback; });

    try {
      const [users, sessions, modules, actions, rolePerms, overrides, pendingResets, pendingApprovals] = await Promise.all([
        getUsers(),
        safe(getSessionLogs({}), []),
        safe(getModules(), []),
        safe(getAdminAuditLog(10), []),
        safe(getRolePermissions(), []),
        safe(getUserPermissionOverrides(), []),
        safe(adminListPasswordResetRequests(profile.user_id, false), []),
        countPendingApprovals(),
      ]);
      if (!pendingApprovals.ok) degraded = true;

      const byRole = {};
      users.forEach(u => { byRole[u.role] = (byRole[u.role] ?? 0) + 1; });
      const roleChart = Object.entries(byRole).map(([role, count]) => ({ role, count }));

      const activeNow = sessions.filter(
        s => !s.logged_out_at && (Date.now() - new Date(s.logged_in_at).getTime()) < 8 * 3_600_000,
      ).length;

      const maintenanceMod = modules.find(m => m.module_key === MAINTENANCE_KEY);

      setData({
        totalUsers:    users.length,
        activeUsers:   users.filter(u => u.is_active !== false).length,
        superAdmins:   users.filter(u => u.role === 'Super Admin').length,
        rolesCount:    Object.keys(byRole).length,
        activeNow,
        modulesTotal:  modules.length,
        modulesOn:     modules.filter(m => m.is_enabled).length,
        modules,
        maintenanceOn: maintenanceMod?.is_enabled ?? false,
        rolePermsCount: rolePerms.length,
        overridesCount: overrides.filter(o => o.granted).length,
        pendingResets:  pendingResets.filter(r => r.status === 'Pending' || r.status === 'In Progress').length,
        pendingApprovals: pendingApprovals.count,
        roleChart,
        recentActions: actions,
        healthy: !degraded,
      });
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.user_id]);

  useEffect(() => { load(); }, [load]);
  const realtimeLoad = useCallback(() => load(true), [load]);
  useRealtimeRefresh(TABLES, realtimeLoad);

  const toggleMaintenance = async () => {
    if (!data) return;
    setMaintBusy(true);
    try {
      await adminSetModuleEnabled(profile.user_id, MAINTENANCE_KEY, !data.maintenanceOn);
      toast.success(data.maintenanceOn ? 'Maintenance mode disabled' : 'Maintenance mode enabled — other users are now locked out');
      await load(true);
    } catch (err) {
      toast.error(err.message || 'Failed to update maintenance mode');
    } finally {
      setMaintBusy(false);
    }
  };

  if (loading) return <SkeletonDashboard statCount={4} />;

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-500">{error}</p>
        <button onClick={() => load()} className="btn-secondary mt-4 text-sm">Retry</button>
      </div>
    );
  }

  const stats = [
    { label: 'Total Users',      value: data.totalUsers,  sub: `${data.activeUsers} active`, icon: Users,       cls: 'bg-indigo-50 text-indigo-500' },
    { label: 'User Roles',       value: data.rolesCount,  sub: `${data.superAdmins} Super Admin`, icon: Tags,   cls: 'bg-blue-50 text-blue-500' },
    { label: 'Pending Resets',   value: data.pendingResets, sub: 'password requests',        icon: KeyRound,    cls: 'bg-rose-50 text-rose-500' },
    { label: 'Pending Approvals', value: data.pendingApprovals, sub: 'awaiting review',       icon: CheckSquare, cls: 'bg-orange-50 text-orange-500' },
    { label: 'Active Sessions',  value: data.activeNow,   sub: 'signed in now',              icon: Activity,    cls: 'bg-emerald-50 text-emerald-500' },
    { label: 'System Health',    value: data.healthy ? 'Operational' : 'Degraded', sub: data.healthy ? 'all systems normal' : 'a data source failed to load', icon: HeartPulse, cls: data.healthy ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500' },
    { label: 'Modules Enabled',  value: `${data.modulesOn}/${data.modulesTotal}`, sub: 'system-wide', icon: ToggleRight, cls: 'bg-amber-50 text-amber-500' },
    { label: 'Permission Grants', value: data.overridesCount, sub: `${data.rolePermsCount} role rules`, icon: ShieldCheck, cls: 'bg-purple-50 text-purple-500' },
  ];

  const quickLinks = [
    { label: 'User Management',      icon: UserCog,       action: () => navigate('/users') },
    { label: 'Role & Permission Mgmt', icon: ShieldCheck, action: () => navigate('/permissions') },
    { label: 'Module Management',    icon: LayoutGrid,    action: () => navigate('/permissions') },
    { label: 'Password Reset Requests', icon: KeyRound,   action: () => navigate('/password-reset-requests') },
    { label: 'Audit Logs',           icon: ScrollText,    action: () => navigate('/audit-logs') },
    { label: 'System Settings',      icon: Settings,      action: () => toast('System settings — coming soon', { icon: 'ℹ️' }) },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {profile?.name?.split(' ')[0]}</h1>
          <p className="text-sm text-gray-400 mt-0.5">System Administration — users, roles, permissions and modules</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {data.maintenanceOn && (
        <div className="card p-4 border border-amber-200 bg-amber-50 flex items-center gap-3">
          <ShieldAlert size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>Maintenance mode is active</strong> — every non-Super-Admin user is currently locked out of the ERP.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(({ label, value, sub, icon: Icon, cls }) => (
          <div key={label} className="card p-4">
            <div className={`w-9 h-9 rounded-xl ${cls} flex items-center justify-center`}>
              <Icon size={16} />
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-3">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label} · {sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Users by role</h2>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={data.roleChart} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="role" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={NEO_TOOLTIP_STYLE} />
                <Bar dataKey="count" shape={<Bar3D fill="#818cf8" />} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <ScrollText size={15} className="text-gray-400" /> Recent admin actions
          </h2>
          {data.recentActions.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No admin actions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {data.recentActions.map(a => (
                <li key={a.log_id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <KeyRound size={13} className="text-gray-300 shrink-0" />
                    <span className="text-gray-700 truncate">
                      {ACTION_LABELS[a.action] ?? a.action} · {a.table_name}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0" title={format(new Date(a.created_at), 'dd MMM yyyy, HH:mm')}>
                    {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Module status */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <LayoutGrid size={15} className="text-gray-400" /> Module status
        </h2>
        <div className="flex flex-wrap gap-2">
          {data.modules.map(m => (
            <span
              key={m.module_key}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                m.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {m.is_enabled ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* Quick access */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <ClipboardList size={15} className="text-gray-400" /> Quick access
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {quickLinks.map(({ label, icon: Icon, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Icon size={15} className="text-gray-400 shrink-0" />
                <span className="truncate">{label}</span>
              </span>
              <ChevronRight size={14} className="text-gray-300 shrink-0" />
            </button>
          ))}

          {/* Maintenance Mode — actionable toggle, not just a link */}
          <button
            onClick={toggleMaintenance}
            disabled={maintBusy}
            className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left disabled:opacity-50 ${
              data.maintenanceOn ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <ShieldAlert size={15} className={data.maintenanceOn ? 'text-amber-500' : 'text-gray-400'} />
              <span className="truncate">Maintenance Mode</span>
            </span>
            {data.maintenanceOn ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
