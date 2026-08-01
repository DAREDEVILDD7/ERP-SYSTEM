// ✅ NEW — reads from your AuthContext sessionStorage session
import { Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionsContext';
import LoadingSpinner from './LoadingSpinner';

function MaintenanceScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="card p-8 max-w-sm text-center">
        <ShieldAlert size={40} className="mx-auto text-amber-400 mb-3" />
        <p className="text-gray-700 font-semibold">System under maintenance</p>
        <p className="text-gray-400 text-sm mt-1">
          The Super Admin has temporarily paused access while maintenance is
          in progress. Please check back shortly.
        </p>
      </div>
    </div>
  );
}

export default function ProtectedRoute({ children, requiredRole, navKey }) {
  const { profile, role, loading } = useAuth();
  const { canAccessModule, isMaintenanceModeOn, isSuperAdmin } = usePermissions();

  // Still restoring session from sessionStorage on mount
  if (loading) return <LoadingSpinner />;

  // No session — send to login
  if (!profile) return <Navigate to="/login" replace />;

  // Optional: role gate (e.g. <ProtectedRoute requiredRole="Admin">)
  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  // System-wide maintenance mode (Super Admin Dashboard's "Maintenance Mode"
  // toggle → modules.system_maintenance). Blocks every route for everyone
  // except Super Admin, who must still be able to manage/lift it.
  // isMaintenanceModeOn only ever becomes true from a strict, present,
  // explicit `true` value - never from a fetch failure or a not-yet-seeded
  // row - so this can never lock out the app for a reason nobody chose.
  if (isMaintenanceModeOn && !isSuperAdmin) {
    return <MaintenanceScreen />;
  }

  // DB-backed module gate (view permission + module enabled) — this is what
  // actually enforces access per module/route, not just hiding the sidebar
  // link. Direct-URL navigation to a route the user can't see is redirected
  // the same way an unauthorized requiredRole would be.
  if (navKey && !canAccessModule(navKey)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}