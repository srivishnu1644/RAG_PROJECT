import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, clearToken, getToken, setToken } from "../lib/api";
import type { AuthResponse, User } from "../lib/types";

interface AuthContextValue {
  user: User | null;
  /** True until the initial "am I already signed in?" check finishes. */
  initialising: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [initialising, setInitialising] = useState(true);

  // Restore the session on mount: a token in localStorage is only a claim
  // until the server confirms it is still valid and the user still exists.
  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      if (!getToken()) {
        setInitialising(false);
        return;
      }
      try {
        const { user: restored } = await api.get<{ user: User }>(
          "/api/auth/me",
        );
        if (!cancelled) setUser(restored);
      } catch {
        // Expired or tampered token: drop it and show the sign-in screen.
        if (!cancelled) clearToken();
      } finally {
        if (!cancelled) setInitialising(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const response = await api.post<AuthResponse>("/api/auth/login", {
        email,
        password,
      });
      setToken(response.token);
      setUser(response.user);
    },
    [],
  );

  const register = useCallback(
    async (name: string, email: string, password: string): Promise<void> => {
      const response = await api.post<AuthResponse>("/api/auth/register", {
        name,
        email,
        password,
      });
      setToken(response.token);
      setUser(response.user);
    },
    [],
  );

  const logout = useCallback((): void => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, initialising, login, register, logout }),
    [user, initialising, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }
  return context;
}
