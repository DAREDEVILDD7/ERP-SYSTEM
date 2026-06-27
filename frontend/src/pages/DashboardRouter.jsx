import { useAuth } from '../context/AuthContext';
import { ROLES } from '../lib/rolePermissions';
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

export default function DashboardRouter() {
  const { role, loading } = useAuth();
  if (loading) return <LoadingSpinner />;

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