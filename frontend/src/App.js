import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute   from './components/common/ProtectedRoute';
import Layout           from './components/common/Layout';
import Login            from './pages/auth/Login';
import DashboardRouter  from './pages/DashboardRouter';
import RequirementsPage from './pages/sales/RequirementsPage';
import QuotationsPage   from './pages/sales/QuotationsPage';
import CustomersPage    from './pages/sales/CustomersPage';
import EquipmentPage    from './pages/operations/EquipmentPage';
import DispatchManagePage from './pages/dispatch/DispatchManagePage';
import MaintenanceJobsPage from './pages/maintenance/MaintenanceJobsPage';
import InvoicesPage     from './pages/finance/InvoicesPage';
import ChatPage         from './pages/chat/ChatPage';
import UserManagement   from './pages/admin/UserManagement';

const Placeholder = ({ name }) => (
  <div className="card p-8 text-center text-gray-400">{name} — coming soon</div>
);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"    element={<DashboardRouter />} />
            <Route path="requirements" element={<ProtectedRoute navKey="requirements"><RequirementsPage /></ProtectedRoute>} />
            <Route path="quotations"   element={<ProtectedRoute navKey="quotations"><QuotationsPage /></ProtectedRoute>} />
            <Route path="equipment"    element={<ProtectedRoute navKey="equipment"><EquipmentPage /></ProtectedRoute>} />
            <Route path="dispatch"     element={<ProtectedRoute navKey="dispatch"><DispatchManagePage /></ProtectedRoute>} />
            <Route path="maintenance"  element={<ProtectedRoute navKey="maintenance"><MaintenanceJobsPage /></ProtectedRoute>} />
            <Route path="finance"      element={<ProtectedRoute navKey="finance"><InvoicesPage /></ProtectedRoute>} />
            <Route path="customers"    element={<ProtectedRoute navKey="customers"><CustomersPage /></ProtectedRoute>} />
            <Route path="chat"         element={<ProtectedRoute navKey="chat"><ChatPage /></ProtectedRoute>} />
            <Route path="users"        element={<ProtectedRoute navKey="users"><UserManagement /></ProtectedRoute>} />
            <Route path="audit-logs"   element={<ProtectedRoute navKey="audit-logs"><Placeholder name="Audit Logs" /></ProtectedRoute>} />
            <Route path="*"            element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}