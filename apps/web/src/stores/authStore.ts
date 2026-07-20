import { create } from "zustand";
import { api, setToken, getToken } from "../lib/api";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  role: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loadMe: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  login: async (email, password) => {
    const res = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
    setToken(res.token);
    set({ user: res.user });
  },
  logout: () => {
    setToken(null);
    set({ user: null });
  },
  loadMe: async () => {
    if (!getToken()) {
      set({ user: null, loading: false });
      return;
    }
    try {
      const res = await api.get<{ user: User }>("/auth/me");
      set({ user: res.user, loading: false });
    } catch {
      setToken(null);
      set({ user: null, loading: false });
    }
  }
}));
