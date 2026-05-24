import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccess } from '../../lib/rolePermissions';
import LoadingSpinner from './LoadingSpinner';

export default function ProtectedRoute({ navKey, children }) {
  const { user, role, loading } = useAuth();

  if (loading) return <LoadingSpinner fullscreen={true} />;
  if (!user)   return <Navigate to="/login" replace />;
  if (navKey && !canAccess(role, navKey)) return <Navigate to="/dashboard" replace />;

  return children;
}