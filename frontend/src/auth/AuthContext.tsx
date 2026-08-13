/**
 * Auth context. Token lives in `localStorage` (key: `campusnav.token`).
 * Status is tri-state to avoid a flash of "logged out" UI on first paint
 * while `/auth/me` is in flight.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { login as apiLogin, me as apiMe } from "@/api/navigation";
import type { User } from "@/lib/navigation-types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthValue {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  getToken: () => string | null;
}

const TOKEN_KEY = "campusnav.token";
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(token ? "loading" : "anonymous");

  // Hydrate user from /auth/me when there's a token.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setStatus("anonymous");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    apiMe(token)
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        // Token was invalid or backend down — drop it.
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const tok = await apiLogin(email, password);
    localStorage.setItem(TOKEN_KEY, tok.access_token);
    setToken(tok.access_token);
    // The /me fetch effect will run via setToken and hydrate user.
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, token, login, logout, getToken: () => token }),
    [status, user, token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
