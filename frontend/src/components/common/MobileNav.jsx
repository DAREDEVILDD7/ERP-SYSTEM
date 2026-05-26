import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccess } from '../../lib/rolePermissions';
import {
  LayoutDashboard, ClipboardList, FileText, Package,
  Truck, Wrench, DollarSign, Users, MessageSquare,
  ScrollText, LogOut, ShoppingCart, Building2,
  MoreHorizontal, X,
} from 'lucide-react';
import clsx from 'clsx';

const ALL_NAV = [
  { key: 'dashboard',    label: 'Home',         icon: LayoutDashboard, path: '/dashboard' },
  { key: 'requirements', label: 'Tickets',      icon: ClipboardList,   path: '/requirements' },
  { key: 'quotations',   label: 'Quotes',       icon: FileText,        path: '/quotations' },
  { key: 'equipment',    label: 'Equipment',    icon: Package,         path: '/equipment' },
  { key: 'dispatch',     label: 'Dispatch',     icon: Truck,           path: '/dispatch' },
  { key: 'maintenance',  label: 'Maintenance',  icon: Wrench,          path: '/maintenance' },
  { key: 'finance',      label: 'Finance',      icon: DollarSign,      path: '/finance' },
  { key: 'procurement',  label: 'Procurement',  icon: ShoppingCart,    path: '/procurement' },
  { key: 'customers',    label: 'Customers',    icon: Building2,       path: '/customers' },
  { key: 'chat',         label: 'Chat',         icon: MessageSquare,   path: '/chat' },
  { key: 'users',        label: 'Users',        icon: Users,           path: '/users' },
  { key: 'audit-logs',   label: 'Audit',        icon: ScrollText,      path: '/audit-logs' },
];

export default function MobileNav() {
  const { role, profile, logout } = useAuth();
  const navigate = useNavigate();
  const [showMore, setShowMore] = useState(false);

  const visible = ALL_NAV.filter(item => canAccess(role, item.key));
  const primary  = visible.slice(0, 4);
  const overflow = visible.slice(4);

  const handleLogout = async () => {
    setShowMore(false);
    await logout();
    navigate('/login');
  };

  return (
    <>
      {/* Bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100">
        <div className="flex items-stretch">
          {primary.map(item => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) => clsx(
                'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors min-h-[56px]',
                isActive ? 'text-primary-600' : 'text-gray-400'
              )}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setShowMore(true)}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-gray-400 min-h-[56px]"
          >
            <MoreHorizontal size={20} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowMore(false)} />
          <div className="relative bg-white rounded-t-2xl shadow-xl max-h-[80vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-primary-600 text-sm font-semibold">{profile?.name?.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{profile?.name}</p>
                  <p className="text-xs text-gray-400">{role}</p>
                </div>
              </div>
              <button onClick={() => setShowMore(false)} className="p-2 text-gray-400">
                <X size={20} />
              </button>
            </div>

            {/* Overflow nav items */}
            <div className="px-4 py-3 grid grid-cols-3 gap-2">
              {overflow.map(item => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) => clsx(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors',
                    isActive ? 'bg-primary-50 text-primary-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  )}
                >
                  <item.icon size={22} />
                  <span className="text-xs font-medium text-center leading-tight">{item.label}</span>
                </NavLink>
              ))}
            </div>

            {/* Sign out */}
            <div className="px-4 pb-6 pt-2 border-t border-gray-100 mt-2">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium"
              >
                <LogOut size={18} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}