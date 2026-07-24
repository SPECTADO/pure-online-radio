import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../lib/authStore";
import { AppShell } from "./AppShell";

/** Gate on auth state, then render the authenticated app shell. */
export function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const location = useLocation();

  if (!hasHydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <AppShell />;
}
