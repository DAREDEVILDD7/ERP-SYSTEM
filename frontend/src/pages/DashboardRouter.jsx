import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/rolePermissions';
import SuperAdminDashboard from '../components/dashboard/SuperAdminDashboard';
import AdminDashboard      from '../components/dashboard/AdminDashboard';
import SalesDashboard      from '../components/dashboard/SalesDashboard';
import OperationsDashboard from '../components/dashboard/OperationsDashboard';
import OperationalDashboard from '../components/dashboard/OperationalDashboard';
import DispatchDashboard   from '../components/dashboard/DispatchDashboard';
import WarehouseDashboard  from '../components/dashboard/WarehouseDashboard';
import FinanceDashboard    from '../components/dashboard/FinanceDashboard';
import MaintenanceDashboard  from '../components/dashboard/MaintenanceDashboard';
import ProcurementDashboard from '../components/dashboard/ProcurementDashboard';
import ITHeadDashboard      from '../components/dashboard/ITHeadDashboard';
import LoadingSpinner       from '../components/common/LoadingSpinner';
import { ShieldCheck, LayoutDashboard } from 'lucide-react';

// Session-scoped (not persisted across tabs/devices, cleared on tab close -
// matches every other "current session" flag in this app, e.g.
// sessionStorage["jtc_loading_played"]). Super Admin only; every other role
// is unaffected by this key entirely.
const SUPER_ADMIN_VIEW_KEY = 'jtc_super_admin_dashboard_view';

// The Operational Dashboard is now the landing view: it answers "how is the
// business running" before "is the platform healthy", which is the order a
// Super Admin actually reads them in. The System Dashboard keeps its tab and
// its behaviour - only the order and the default changed. Note the polarity
// flip: the stored value is now checked for 'system' (the non-default),
// so an old session that stored 'system' still restores System, and every
// other stored value - including the legacy 'operations' - lands on
// Operational, which is where the default should put it anyway.
function loadSuperAdminView() {
  try {
    return sessionStorage.getItem(SUPER_ADMIN_VIEW_KEY) === 'system' ? 'system' : 'operations';
  } catch (_) {
    return 'operations'; // storage disabled / privacy mode - default landing still applies
  }
}

export default function DashboardRouter() {
  const { role, loading } = useAuth();
  // Lazily evaluated once, in useState - default is 'operations' (the
  // required landing dashboard), restored from the current session if the Super
  // Admin already switched views earlier in this tab. Declared
  // unconditionally (before the loading/role checks below) per the Rules of
  // Hooks; it is simply unused for every non-Super-Admin role.
  const [superAdminView, setSuperAdminView] = useState(loadSuperAdminView);

  if (loading) return <LoadingSpinner />;

  if (role === ROLES.SUPER_ADMIN) {
    const setView = (view) => {
      setSuperAdminView(view);
      try { sessionStorage.setItem(SUPER_ADMIN_VIEW_KEY, view); } catch (_) {}
    };

    return (
      <div className="space-y-4">
        <div className="flex gap-1 border-b border-gray-100">
          {[
            { key: 'operations', label: 'Operational Dashboard', icon: LayoutDashboard },
            { key: 'system',     label: 'System Dashboard',      icon: ShieldCheck },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                superAdminView === t.key ? 'border-jtc text-jtc' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {/* OperationalDashboard renders the trend / forecast / anomaly
            surfaces and then embeds AdminDashboard - the broadest existing
            operational snapshot - unchanged, exactly as every other role's
            dashboard below. Super Admin never loses access to either view;
            switching is instant and client-side only. */}
        {superAdminView === 'system' ? <SuperAdminDashboard /> : <OperationalDashboard />}
      </div>
    );
  }

  switch (role) {
    case ROLES.ADMIN:       return <AdminDashboard />;
    case ROLES.SALES:       return <SalesDashboard />;
    case ROLES.OPERATIONS:  return <OperationsDashboard />;
    case ROLES.DISPATCH:    return <DispatchDashboard />;
    case ROLES.WAREHOUSE:   return <WarehouseDashboard />;
    case ROLES.FINANCE:     return <FinanceDashboard />;
    case ROLES.MAINTENANCE:  return <MaintenanceDashboard />;
    case ROLES.PROCUREMENT:  return <ProcurementDashboard />;
    case ROLES.IT_HEAD:      return <ITHeadDashboard />;
    default: return <div className="text-gray-500">No dashboard configured for this role.</div>;
  }
}
