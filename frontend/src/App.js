import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import Layout from "./components/common/Layout";
import Login from "./pages/auth/Login";
import DashboardRouter from "./pages/DashboardRouter";
import RequirementsPage from "./pages/sales/RequirementsPage";

const Placeholder = ({ name }) => (
  <div className="card p-8 text-center text-gray-400">{name} — coming soon</div>
);

// Debug wrapper to see what's happening
function AppDebug() {
  const { user, role, loading } = useAuth();
  console.log(
    "🟢 AppDebug render — loading:",
    loading,
    "user:",
    user?.id ?? "null",
    "role:",
    role,
  );
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <AppDebug />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardRouter />} />
            <Route
              path="requirements"
              element={
                <ProtectedRoute navKey="requirements">
                  <RequirementsPage />
                </ProtectedRoute>
              }
            />{" "}
            <Route
              path="quotations"
              element={
                <ProtectedRoute navKey="quotations">
                  <Placeholder name="Quotations" />
                </ProtectedRoute>
              }
            />
            <Route
              path="equipment"
              element={
                <ProtectedRoute navKey="equipment">
                  <Placeholder name="Equipment" />
                </ProtectedRoute>
              }
            />
            <Route
              path="dispatch"
              element={
                <ProtectedRoute navKey="dispatch">
                  <Placeholder name="Dispatch" />
                </ProtectedRoute>
              }
            />
            <Route
              path="maintenance"
              element={
                <ProtectedRoute navKey="maintenance">
                  <Placeholder name="Maintenance" />
                </ProtectedRoute>
              }
            />
            <Route
              path="finance"
              element={
                <ProtectedRoute navKey="finance">
                  <Placeholder name="Finance" />
                </ProtectedRoute>
              }
            />
            <Route
              path="customers"
              element={
                <ProtectedRoute navKey="customers">
                  <Placeholder name="Customers" />
                </ProtectedRoute>
              }
            />
            <Route
              path="chat"
              element={
                <ProtectedRoute navKey="chat">
                  <Placeholder name="Chat" />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute navKey="users">
                  <Placeholder name="User Management" />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit-logs"
              element={
                <ProtectedRoute navKey="audit-logs">
                  <Placeholder name="Audit Logs" />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
