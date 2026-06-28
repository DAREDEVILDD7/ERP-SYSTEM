import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Component } from "react";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import { NotificationProvider } from "./context/NotificationContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import Layout from "./components/common/Layout";
import Login from "./pages/auth/Login";
import DashboardRouter from "./pages/DashboardRouter";
import RequirementsPage from "./pages/sales/RequirementsPage";
import QuotationsPage from "./pages/sales/QuotationsPage";
import CustomersPage from "./pages/sales/CustomersPage";
import EquipmentPage from "./pages/operations/EquipmentPage";
import DispatchManagePage from "./pages/dispatch/DispatchManagePage";
import MaintenanceJobsPage from "./pages/maintenance/MaintenanceJobsPage";
import InvoicesPage from "./pages/finance/InvoicesPage";
import ChatPage from "./pages/chat/ChatPage";
import UserManagement from "./pages/admin/UserManagement";
import AuditLogs from "./pages/admin/AuditLogs";
import ProcurementPage from "./pages/procurement/ProcurementPage";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-semibold text-gray-800">Something went wrong</h2>
            <p className="text-sm text-gray-500">
              An unexpected error occurred. Please refresh the page to continue.
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="btn btn-primary w-full"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// eslint-disable-next-line no-unused-vars
const Placeholder = ({ name }) => (
  <div className="card p-8 text-center text-gray-400">{name} — coming soon</div>
);

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NotificationProvider>
          <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
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
                path="procurement"
                element={
                  <ProtectedRoute navKey="procurement">
                    <ProcurementPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="requirements"
                element={
                  <ProtectedRoute navKey="requirements">
                    <RequirementsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="quotations"
                element={
                  <ProtectedRoute navKey="quotations">
                    <QuotationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="equipment"
                element={
                  <ProtectedRoute navKey="equipment">
                    <EquipmentPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="dispatch"
                element={
                  <ProtectedRoute navKey="dispatch">
                    <DispatchManagePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="maintenance"
                element={
                  <ProtectedRoute navKey="maintenance">
                    <MaintenanceJobsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="finance"
                element={
                  <ProtectedRoute navKey="finance">
                    <InvoicesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="customers"
                element={
                  <ProtectedRoute navKey="customers">
                    <CustomersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="chat"
                element={
                  <ProtectedRoute navKey="chat">
                    <ChatPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="users"
                element={
                  <ProtectedRoute navKey="users">
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="audit-logs"
                element={
                  <ProtectedRoute navKey="audit-logs">
                    <AuditLogs />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
          </NotificationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
