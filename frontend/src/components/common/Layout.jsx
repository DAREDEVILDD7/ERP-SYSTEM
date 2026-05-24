import Sidebar from './Sidebar';
import Navbar from './Navbar';
import MobileNav from './MobileNav';
import { Outlet, useLocation } from 'react-router-dom';

const PAGE_TITLES = {
  '/dashboard':    'Dashboard',
  '/requirements': 'Requirements',
  '/quotations':   'Quotations',
  '/equipment':    'Equipment',
  '/dispatch':     'Dispatch',
  '/maintenance':  'Maintenance',
  '/finance':      'Finance',
  '/customers':    'Customers',
  '/chat':         'Internal Chat',
  '/users':        'User Management',
  '/audit-logs':   'Audit Logs',
};

export default function Layout() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] ?? 'KW Ops';

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar title={title} />
        {/* pb-16 on mobile to avoid content hiding behind bottom nav */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}