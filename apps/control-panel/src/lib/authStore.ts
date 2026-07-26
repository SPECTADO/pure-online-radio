import { create } from "zustand";
import type { AuthUserDTO } from "@spectado/shared-types";
import { apiClient, ApiError } from "./apiClient";

interface AuthState {
  user: AuthUserDTO | null;
  /** True while the initial `/auth/me` hydration call is in flight. */
  isHydrating: boolean;
  /** Set once hydration has run at least once, so ProtectedRoute knows
   * whether "no user yet" means "still checking" or "definitely logged out". */
  hasHydrated: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isHydrating: false,
  hasHydrated: false,
  error: null,

  hydrate: async () => {
    set({ isHydrating: true });
    try {
      const user = await apiClient.get<AuthUserDTO>("/auth/me");
      set({ user, isHydrating: false, hasHydrated: true, error: null });
    } catch {
      // Not logged in (401) or API unreachable — either way, no session.
      set({ user: null, isHydrating: false, hasHydrated: true });
    }
  },

  login: async (username: string, password: string) => {
    set({ error: null });
    try {
      // The API's /auth/login response body *is* the AuthUserDTO (in addition
      // to setting the httpOnly cookies), so no follow-up /auth/me call is needed.
      const user = await apiClient.post<AuthUserDTO>("/auth/login", { username, password });
      set({ user, hasHydrated: true, error: null });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Unable to reach the server. Please try again.";
      set({ user: null, error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await apiClient.post("/auth/logout");
    } catch {
      // Best-effort: even if the request fails (e.g. API unreachable), drop
      // the local session so the UI reflects "logged out".
    }
    set({ user: null });
  },
}));
