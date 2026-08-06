import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Component } from "react";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import { PermissionsProvider } from "./context/PermissionsContext";
import { NotificationProvider } from "./context/NotificationContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import Layout from "./components/common/Layout";
import Login from "./pages/auth/Login";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import lazyRoute from "./lib/lazyRoute";

/* Every routed page is code-split. Before this, all 15 pages plus everything
   they pull in (recharts + d3 for the dashboards, jspdf for the PDF exports,
   the big Dispatch / Procurement / Equipment screens) sat in the single
   main bundle, so a Sales user downloaded the Procurement module and an
   Admin downloaded the chart library just to reach the login screen.
   `lazy()` moves each into its own chunk, fetched on first navigation.

   `Login` is deliberately NOT lazy: it is the unauthenticated landing route
   and it hands the truck animation's logo over to its own static <img>
   (see AppLoadingGate / LogoDockContext). Deferring it behind a chunk fetch
   would put a network round-trip inside that hand-off, which is exactly the
   timing the loading-gate invariants forbid. Layout / ProtectedRoute stay
   eager for the same reason on the authenticated side — they must render
   the shell instantly so the Suspense fallback appears *inside* the page
   area rather than replacing the sidebar and navbar.

   The Suspense boundary lives in Layout, around <Outlet />.

   `lazyRoute` is React.lazy plus recovery from a chunk 404 after a redeploy —
   see lib/lazyRoute.js. Use it, not bare `lazy()`, for anything routed. */
const DashboardRouter = lazyRoute(() => import("./pages/DashboardRouter"));
const RequirementsPage = lazyRoute(() => import("./pages/sales/RequirementsPage"));
const QuotationsPage = lazyRoute(() => import("./pages/sales/QuotationsPage"));
const CustomersPage = lazyRoute(() => import("./pages/sales/CustomersPage"));
const EquipmentPage = lazyRoute(() => import("./pages/operations/EquipmentPage"));
const DispatchManagePage = lazyRoute(() => import("./pages/dispatch/DispatchManagePage"));
const MaintenanceJobsPage = lazyRoute(() => import("./pages/maintenance/MaintenanceJobsPage"));
const InvoicesPage = lazyRoute(() => import("./pages/finance/InvoicesPage"));
const ChatPage = lazyRoute(() => import("./pages/chat/ChatPage"));
const UserManagement = lazyRoute(() => import("./pages/admin/UserManagement"));
const AuditLogs = lazyRoute(() => import("./pages/admin/AuditLogs"));
const PasswordResetRequests = lazyRoute(() => import("./pages/admin/PasswordResetRequests"));
const PermissionsManagement = lazyRoute(() => import("./pages/admin/PermissionsManagement"));
const ProcurementPage = lazyRoute(() => import("./pages/procurement/ProcurementPage"));
const AnalyticsPage = lazyRoute(() => import("./pages/analytics/AnalyticsPage"));

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

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PermissionsProvider>
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
              <Route
                path="password-reset-requests"
                element={
                  <ProtectedRoute navKey="password-reset-requests">
                    <PasswordResetRequests />
                  </ProtectedRoute>
                }
              />
              <Route
                path="permissions"
                element={
                  <ProtectedRoute navKey="permissions">
                    <PermissionsManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="analytics"
                element={
                  <ProtectedRoute navKey="analytics">
                    <AnalyticsPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
          </NotificationProvider>
          </PermissionsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
