import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccess } from '../../lib/rolePermissions';
import {
  LayoutDashboard, ClipboardList, FileText, Package,
  Truck, Wrench, DollarSign, Users, MessageSquare,
  Settings, ScrollText,
} from 'lucide-react';
import clsx from 'clsx';

const ALL_NAV = [
  { key: 'dashboard',    label: 'Home',        icon: LayoutDashboard, path: '/dashboard' },
  { key: 'requirements', label: 'Tickets',     icon: ClipboardList,   path: '/requirements' },
  { key: 'quotations',   label: 'Quotes',      icon: FileText,        path: '/quotations' },
  { key: 'equipment',    label: 'Equipment',   icon: Package,         path: '/equipment' },
  { key: 'dispatch',     label: 'Dispatch',    icon: Truck,           path: '/dispatch' },
  { key: 'maintenance',  label: 'Maintenance', icon: Wrench,          path: '/maintenance' },
  { key: 'finance',      label: 'Finance',     icon: DollarSign,      path: '/finance' },
  { key: 'customers',    label: 'Customers',   icon: Users,           path: '/customers' },
  { key: 'chat',         label: 'Chat',        icon: MessageSquare,   path: '/chat' },
  { key: 'users',        label: 'Users',       icon: Settings,        path: '/users' },
  { key: 'audit-logs',   label: 'Audit',       icon: ScrollText,      path: '/audit-logs' },
];

export default function MobileNav() {
  const { role } = useAuth();
  const visible = ALL_NAV.filter(item => canAccess(role, item.key));
  // Show max 5 in bottom bar, rest go in "more" — for now show first 5
  const primary = visible.slice(0, 5);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 safe-area-pb">
      <div className="flex items-stretch">
        {primary.map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) => clsx(
              'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors min-h-[56px]',
              isActive ? 'text-primary-600' : 'text-gray-400'
            )}
          >
            <item.icon size={20} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}