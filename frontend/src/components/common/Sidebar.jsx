import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { usePermissions } from "../../context/PermissionsContext";
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  Package,
  Truck,
  Wrench,
  DollarSign,
  Users,
  MessageSquare,
  ScrollText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  Building2,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useNotifications } from "../../context/NotificationContext";
import SidebarLogoHover from "./SidebarLogoHover";

const NAV_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/dashboard",
  },
  {
    key: "requirements",
    label: "Requirements",
    icon: ClipboardList,
    path: "/requirements",
  },
  {
    key: "quotations",
    label: "Quotations",
    icon: FileText,
    path: "/quotations",
  },
  { key: "equipment", label: "Equipment", icon: Package, path: "/equipment" },
  { key: "dispatch", label: "Dispatch", icon: Truck, path: "/dispatch" },
  {
    key: "maintenance",
    label: "Maintenance",
    icon: Wrench,
    path: "/maintenance",
  },
  { key: "finance", label: "Finance", icon: DollarSign, path: "/finance" },
  {
    key: "procurement",
    label: "Procurement",
    icon: ShoppingCart,
    path: "/procurement",
  },
  { key: "customers", label: "Customers", icon: Building2, path: "/customers" },
  { key: "chat", label: "Chat", icon: MessageSquare, path: "/chat" },
  { key: "users", label: "User Mgmt", icon: Users, path: "/users" },
  {
    key: "password-reset-requests",
    label: "Password Resets",
    icon: KeyRound,
    path: "/password-reset-requests",
  },
  {
    key: "audit-logs",
    label: "Audit Logs",
    icon: ScrollText,
    path: "/audit-logs",
  },
  {
    key: "permissions",
    label: "Roles & Permissions",
    icon: ShieldCheck,
    path: "/permissions",
  },
];

export default function Sidebar() {
  const { profile, logout } = useAuth();
  const { canAccessModule, canResetPasswords } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { notifications } = useNotifications();
  const unreadChatCount = notifications.filter(n => n.type === 'chat' && !n.is_read).length;

  // Route-change → sidebar-logo replay. Each pathname change bumps a counter
  // that `SidebarLogoHover` watches; the counter (rather than pathname
  // itself) means back-navigation to the same path still counts, and the
  // component's own `phase !== "idle"` guard coalesces rapid consecutive
  // navigations so the animation is never restarted mid-flight. The very
  // first mount is intentionally skipped — the loading screen already runs
  // the same animation on the first paint, and re-running it as the login
  // page mounts would double-play. Subsequent pathname changes (every
  // in-app navigation from that point on) trigger the replay, which runs
  // in parallel with whatever skeleton loader the destination page shows.
  const [navTick, setNavTick] = useState(0);
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;
    setNavTick((n) => n + 1);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // "password-reset-requests" is individually grantable on top of the
  // coarse per-role module access (off for every Admin by default) - so it
  // needs the extra canResetPasswords check the other nav items don't.
  const visible = NAV_ITEMS.filter((item) =>
    canAccessModule(item.key) &&
    (item.key !== 'password-reset-requests' || canResetPasswords)
  );

  return (
    <aside
      className={clsx(
        "flex flex-col h-screen bg-white border-r border-gray-100 transition-all duration-200 shrink-0",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Brand — official JTC logo, shared with login page and loading screen.
          Hovering triggers a scaled replay of the loading-page assembly
          animation (wedge → J → T → C → red-dot flourish); see
          SidebarLogoHover.jsx. */}
      <div className="flex items-center justify-center px-4 h-16 border-b border-gray-100">
        <SidebarLogoHover collapsed={collapsed} trigger={navTick} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visible.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-primary-50 text-primary-600 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              )
            }
          >
            {/* Icon — with dot indicator when collapsed and there are unread chat messages */}
            <div className="relative shrink-0">
              <item.icon size={18} />
              {item.key === 'chat' && collapsed && unreadChatCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full ring-1 ring-white" />
              )}
            </div>
            {!collapsed && <span className="truncate">{item.label}</span>}
            {/* Count badge — only shown when expanded */}
            {!collapsed && item.key === 'chat' && unreadChatCount > 0 && (
              <span className="ml-auto text-[10px] font-bold bg-rose-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none shrink-0">
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-gray-100 p-2 space-y-1">
        {!collapsed && profile && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-primary-600 text-xs font-semibold">
                {profile.name?.charAt(0) ?? "U"}
              </span>
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-medium text-gray-900 truncate">
                {profile.name}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {profile.department}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          title={collapsed ? "Sign out" : undefined}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-center py-1.5 rounded-lg text-gray-400 hover:bg-gray-50 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
