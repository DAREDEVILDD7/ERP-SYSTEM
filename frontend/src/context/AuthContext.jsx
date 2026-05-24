import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", authUser.id)
        .single();
      if (error) {
        console.error("Profile error:", error);
        setProfile(null);
      } else {
        setProfile(data);
      }
    } catch (err) {
      console.error("Profile fetch failed:", err);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Listen FIRST — this fires immediately with current session
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("onAuthStateChange:", _event, session?.user?.id ?? "null");
      setUser(session?.user ?? null);
      // Don't await here — let it run in background
      fetchProfile(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const login = async (username, password) => {
    setError(null);
    const { data: email, error: lookupError } = await supabase.rpc(
      "get_email_by_username",
      { p_username: username.trim().toLowerCase() },
    );
    if (lookupError || !email) throw new Error("Username not found.");
    const { data, error: signInError } = await supabase.auth.signInWithPassword(
      { email, password },
    );
    if (signInError) throw new Error("Incorrect password.");
    return data;
  };

  const logout = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role: profile?.role ?? null,
        loading,
        error,
        login,
        logout,
        isAdmin: profile?.role === "Admin",
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
