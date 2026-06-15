// ✅ NEW — reads from your AuthContext sessionStorage session
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from './LoadingSpinner';

export default function ProtectedRoute({ children, requiredRole }) {
  const { profile, role, loading } = useAuth();

  // Still restoring session from sessionStorage on mount
  if (loading) return <LoadingSpinner />;

  // No session — send to login
  if (!profile) return <Navigate to="/login" replace />;

  // Optional: role gate (e.g. <ProtectedRoute requiredRole="Admin">)
  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}