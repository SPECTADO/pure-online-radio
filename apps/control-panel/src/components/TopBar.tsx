import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../lib/authStore";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
        <ConnectionStatusBadge />
        {user && (
          <span className="text-sm text-slate-600">
            {user.username} <span className="text-slate-400">&middot;</span>{" "}
            <span className="text-slate-400">{user.role}</span>
          </span>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
