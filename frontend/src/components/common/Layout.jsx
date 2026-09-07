import { Suspense } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import MobileNav from './MobileNav';
import LoadingSpinner from './LoadingSpinner';
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
        {/* mobile-content-pb: overrides pb-20 on mobile with a safe-area-aware value
            (nav height + env(safe-area-inset-bottom) + breathing room).
            md:pb-6 covers desktop where there is no bottom nav. */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6 mobile-content-pb">
          {/* The one Suspense boundary for every code-split page (see App.js).
              It sits INSIDE <main>, below the sidebar and navbar, so a chunk
              fetch shows an in-content spinner instead of tearing down the
              shell — the non-fullscreen variant is the same affordance the
              app already uses for in-page loads. */}
          <Suspense fallback={<LoadingSpinner fullscreen={false} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}