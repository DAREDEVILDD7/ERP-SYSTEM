import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

const SESSION_KEY = "kwops_session"; // key used in sessionStorage

// ─── helpers ────────────────────────────────────────────────────────────────

function saveSession(profile) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

// ─── provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);   // row from public.users (no password)
  const [loading, setLoading] = useState(true);   // true while restoring session on mount
  const [error,   setError]   = useState(null);

  // Restore session on page refresh
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setProfile(saved);
    }
    setLoading(false);
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

    // verify_login returns an empty array on bad credentials, one row on success
    if (!data || data.length === 0) {
      throw new Error("Invalid username or password.");
    }

    const userProfile = data[0];

    if (!userProfile.is_active) {
      throw new Error("Your account has been deactivated. Contact your administrator.");
    }

    // Fire-and-forget: log the login timestamp.
    // supabase.rpc() returns a PostgrestBuilder (thenable, not a full Promise),
    // so .catch() doesn't exist on it directly. Wrap in Promise.resolve() first.
    Promise.resolve(
      supabase.rpc("log_last_login", { p_user_id: userProfile.user_id })
    ).catch(() => {});

    setProfile(userProfile);
    saveSession(userProfile);
    return userProfile;
  }, []);

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    setProfile(null);
    clearSession();
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
  const adminResetPassword = useCallback(async (userId, newPassword) => {
    if (profile?.role !== "Admin") throw new Error("Admin access required.");
    if (!newPassword || newPassword.length < 6) {
      throw new Error("Password must be at least 6 characters.");
    }

    const { data, error } = await supabase.rpc("set_user_password", {
      p_user_id:      userId,
      p_new_password: newPassword,
    });

    if (error) throw new Error(error.message || "Password reset failed.");
    return data;
  }, [profile]);

  // ── context value ─────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider
      value={{
        // Keep the same shape as before so all existing code keeps working
        user:               profile,   // alias — components using `user` still work
        profile,
        role:               profile?.role ?? null,
        loading,
        error,
        login,
        logout,
        changePassword,
        adminResetPassword,
        isAdmin:            profile?.role === "Admin",
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