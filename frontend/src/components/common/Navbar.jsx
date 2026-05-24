import { useAuth } from '../../context/AuthContext';
import { Bell, Search } from 'lucide-react';

export default function Navbar({ title }) {
  const { profile, role } = useAuth();

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Search — cosmetic for now */}
        <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
          <Search size={18} />
        </button>

        {/* Notifications */}
        <button className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* User chip */}
        <div className="flex items-center gap-2 pl-3 border-l border-gray-100">
          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-primary-600 text-sm font-semibold">
              {profile?.name?.charAt(0) ?? 'U'}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-gray-900 leading-none">{profile?.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}