import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccess } from '../../lib/rolePermissions';
import {
  LayoutDashboard, ClipboardList, FileText, Package,
  Truck, Wrench, DollarSign, Users, MessageSquare,
  Settings, ScrollText, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

const NAV_ITEMS = [
  { key: 'dashboard',   label: 'Dashboard',    icon: LayoutDashboard, path: '/dashboard' },
  { key: 'requirements',label: 'Requirements', icon: ClipboardList,   path: '/requirements' },
  { key: 'quotations',  label: 'Quotations',   icon: FileText,        path: '/quotations' },
  { key: 'equipment',   label: 'Equipment',    icon: Package,         path: '/equipment' },
  { key: 'dispatch',    label: 'Dispatch',     icon: Truck,           path: '/dispatch' },
  { key: 'maintenance', label: 'Maintenance',  icon: Wrench,          path: '/maintenance' },
  { key: 'finance',     label: 'Finance',      icon: DollarSign,      path: '/finance' },
  { key: 'customers',   label: 'Customers',    icon: Users,           path: '/customers' },
  { key: 'chat',        label: 'Chat',         icon: MessageSquare,   path: '/chat' },
  { key: 'users',       label: 'User Mgmt',    icon: Settings,        path: '/users' },
  { key: 'audit-logs',  label: 'Audit Logs',   icon: ScrollText,      path: '/audit-logs' },
];

export default function Sidebar() {
  const { profile, role, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleItems = NAV_ITEMS.filter(item => canAccess(role, item.key));

  return (
    <aside className={clsx(
      'flex flex-col h-screen bg-white border-r border-gray-100 transition-all duration-200 shrink-0',
      collapsed ? 'w-16' : 'w-56'
    )}>

      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">KW</span>
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-sm font-semibold text-gray-900 truncate">KW Ops Portal</p>
            <p className="text-xs text-gray-400 truncate">Logistics Portal</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-primary-50 text-primary-600 font-medium'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            <item.icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User + collapse */}
      <div className="border-t border-gray-100 p-2 space-y-1">
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-primary-600 text-xs font-semibold">
                {profile?.name?.charAt(0) ?? 'U'}
              </span>
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-gray-900 truncate">{profile?.name}</p>
              <p className="text-xs text-gray-400 truncate">{role}</p>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>

        <button
          onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-center py-1.5 rounded-lg text-gray-400 hover:bg-gray-50 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}