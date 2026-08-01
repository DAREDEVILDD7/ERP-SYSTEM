import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/rolePermissions';
import SuperAdminDashboard from '../components/dashboard/SuperAdminDashboard';
import AdminDashboard      from '../components/dashboard/AdminDashboard';
import SalesDashboard      from '../components/dashboard/SalesDashboard';
import OperationsDashboard from '../components/dashboard/OperationsDashboard';
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

function loadSuperAdminView() {
  try {
    return sessionStorage.getItem(SUPER_ADMIN_VIEW_KEY) === 'operations' ? 'operations' : 'system';
  } catch (_) {
    return 'system'; // storage disabled / privacy mode - default landing still applies
  }
}

export default function DashboardRouter() {
  const { role, loading } = useAuth();
  // Lazily evaluated once, in useState - default is 'system' (the required
  // landing dashboard), restored from the current session if the Super
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
            { key: 'system',     label: 'System Dashboard',     icon: ShieldCheck },
            { key: 'operations', label: 'Operations Dashboard', icon: LayoutDashboard },
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

        {/* Operations Dashboard reuses AdminDashboard - the broadest existing
            operational overview - unchanged, exactly as every other role's
            dashboard below. Super Admin never loses access to either view;
            switching is instant and client-side only. */}
        {superAdminView === 'system' ? <SuperAdminDashboard /> : <AdminDashboard />}
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
