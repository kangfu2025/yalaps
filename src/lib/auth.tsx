import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, type AppRole } from "./supabase";
import type { User } from "@supabase/supabase-js";

/** Map a username to a synthetic email used with Supabase Auth. */
export const USERNAME_DOMAIN = "yala.local";
export function usernameToEmail(input: string): string {
  const s = input.trim();
  if (s.includes("@")) return s.toLowerCase();
  return `${s.toLowerCase()}@${USERNAME_DOMAIN}`;
}

interface AuthState {
  user: User | null;
  username: string | null;
  role: AppRole | null;
  loading: boolean;
  signIn: (usernameOrEmail: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfileAndRole(u: User | null) {
    if (!u) {
      setUsername(null);
      setRole(null);
      return;
    }
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("username").eq("id", u.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", u.id),
    ]);
    setUsername((prof as { username?: string } | null)?.username ?? u.email ?? null);
    const list = (roles ?? []) as Array<{ role: AppRole }>;
    if (list.some((r) => r.role === "admin")) setRole("admin");
    else if (list.some((r) => r.role === "staff")) setRole("staff");
    else setRole(null);
  }

  async function refresh() {
    const { data } = await supabase.auth.getUser();
    setUser(data.user ?? null);
    await loadProfileAndRole(data.user ?? null);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      await refresh();
      if (mounted) setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setUser(session?.user ?? null);
        loadProfileAndRole(session?.user ?? null);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signIn(usernameOrEmail: string, password: string) {
    const email = usernameToEmail(usernameOrEmail);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setUsername(null);
    setRole(null);
  }

  return (
    <AuthCtx.Provider value={{ user, username, role, loading, signIn, signOut, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
