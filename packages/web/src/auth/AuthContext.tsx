import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api } from "@/api/client";
import { AuthUser } from "@/api/types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (...codes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("stark_user");
    const token = localStorage.getItem("stark_token");
    if (stored && token) {
      setUser(JSON.parse(stored));
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const result = await api.post<{ token: string; user: AuthUser }>("/auth/login", { email, password });
    localStorage.setItem("stark_token", result.token);
    localStorage.setItem("stark_user", JSON.stringify(result.user));
    setUser(result.user);
  }

  function logout() {
    localStorage.removeItem("stark_token");
    localStorage.removeItem("stark_user");
    setUser(null);
  }

  function hasPermission(...codes: string[]) {
    if (!user) return false;
    return codes.some((c) => user.permissions.includes(c));
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, hasPermission }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
