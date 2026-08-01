import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { startSessionLog, endSessionLog } from "../api/sessionLogs";

const AuthContext = createContext(null);

const SESSION_KEY     = "kwops_session";
const SESSION_LOG_KEY = "kwops_session_log_id";

// ─── helpers ────────────────────────────────────────────────────────────────

function saveSession(profile) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile)); } catch (_) {}
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_LOG_KEY);
  } catch (_) {}
}
function saveSessionLogId(id) {
  try { sessionStorage.setItem(SESSION_LOG_KEY, id); } catch (_) {}
}
function loadSessionLogId() {
  try { return sessionStorage.getItem(SESSION_LOG_KEY) ?? null; } catch (_) { return null; }
}

// ─── provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(() => loadSession());
  // Session restore is synchronous (loadSession() above reads sessionStorage
  // directly), so there is no actual async loading window - this is never
  // toggled. Kept as a plain value (not state) since several pages
  // (ProtectedRoute, DashboardRouter, etc.) already destructure `loading`
  // from useAuth() expecting it to exist.
  const loading = false;
  const [error,   setError]   = useState(null);

  // Best-effort session end on tab/browser close (fetch + keepalive survives page unload)
  useEffect(() => {
    const handlePageHide = () => {
      const logId      = loadSessionLogId();
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
      if (!logId || !supabaseUrl || !supabaseKey) return;
      fetch(
        `${supabaseUrl}/rest/v1/session_logs?session_log_id=eq.${encodeURIComponent(logId)}&logged_out_at=is.null`,
        {
          method:    'PATCH',
          keepalive: true,
          headers: {
            apikey:          supabaseKey,
            Authorization:   `Bearer ${supabaseKey}`,
            'Content-Type':  'application/json',
            Prefer:          'return=minimal',
          },
          body: JSON.stringify({ logged_out_at: new Date().toISOString() }),
        }
      ).catch(() => {});
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  // ── login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (username, password) => {
    setError(null);

    if (!username?.trim() || !password) {
      throw new Error("Please enter your username and password.");
    }

    let data, error;

    try {
      ({ data, error } = await supabase.rpc("verify_login", {
        p_username: username.trim().toLowerCase(),
        p_password: password,
      }));
    } catch (networkErr) {
      throw new Error("Network error. Please check your connection.");
    }

    if (error) {
      console.error("verify_login RPC error:", error);
      throw new Error("Login service unavailable. Please try again.");
    }

    if (!data || data.length === 0) {
      throw new Error("Invalid username or password.");
    }

    const userProfile = data[0];

    if (!userProfile.is_active) {
      throw new Error("Your account has been deactivated. Contact your administrator.");
    }

    // Fire-and-forget: log the login timestamp
    Promise.resolve(
      supabase.rpc("log_last_login", { p_user_id: userProfile.user_id })
    ).catch(() => {});

    // Fire-and-forget: start session log (never block login on failure)
    Promise.resolve(startSessionLog(userProfile))
      .then(logId => { if (logId) saveSessionLogId(logId); })
      .catch(() => {});

    setProfile(userProfile);
    saveSession(userProfile);
    return userProfile;
  }, []);

  // ── live role refresh (called by PermissionsContext) ──────────────────────
  // If a Super Admin changes THIS signed-in user's own role, PermissionsContext
  // detects it (it already watches the current user's `users` row for the
  // is_active/logout check) and calls this so DashboardRouter re-renders with
  // the new role immediately - no logout/re-login required.
  const updateProfileRole = useCallback((newRole) => {
    setProfile(p => {
      if (!p || p.role === newRole) return p;
      const next = { ...p, role: newRole };
      saveSession(next);
      return next;
    });
  }, []);

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    const logId = loadSessionLogId();
    clearSession();
    setProfile(null);
    // Fire-and-forget session end (don't block logout on it)
    if (logId) Promise.resolve(endSessionLog(logId)).catch(() => {});
  }, []);

  // ── change own password ───────────────────────────────────────────────────
  const changePassword = useCallback(async (oldPassword, newPassword) => {
    if (!profile) throw new Error("Not logged in.");
    if (!newPassword || newPassword.length < 6) {
      throw new Error("New password must be at least 6 characters.");
    }
    if (oldPassword === newPassword) {
      throw new Error("New password must be different from the current one.");
    }

    const { data, error } = await supabase.rpc("change_own_password", {
      p_username:     profile.username,
      p_old_password: oldPassword,
      p_new_password: newPassword,
    });

    if (error) throw new Error(error.message || "Password change failed.");
    if (!data)  throw new Error("Current password is incorrect.");
    return true;
  }, [profile]);

  // ── admin: reset any user's password ─────────────────────────────────────
  // Server-verified: admin_reset_user_password re-checks the caller's actual
  // permission (Super Admin, or an Admin explicitly granted the
  // "password_reset" override) and the target's role fresh from the
  // database - it does not trust the client-side profile at all beyond
  // identifying who is asking. See add_super_admin_rbac.sql.
  const adminResetPassword = useCallback(async (userId, newPassword) => {
    if (!profile?.user_id) throw new Error("Not logged in.");
    if (!newPassword || newPassword.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    const { data, error } = await supabase.rpc("admin_reset_user_password", {
      p_actor_id:     profile.user_id,
      p_target_id:    userId,
      p_new_password: newPassword,
    });

    if (error) throw new Error(error.message || "Password reset failed.");
    return data;
  }, [profile]);

  // ── context value ─────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider
      value={{
        user:               profile,
        profile,
        role:               profile?.role ?? null,
        loading,
        error,
        login,
        logout,
        changePassword,
        adminResetPassword,
        updateProfileRole,
        isAdmin:            profile?.role === "Admin" || profile?.role === "Super Admin",
        isSuperAdmin:       profile?.role === "Super Admin",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
