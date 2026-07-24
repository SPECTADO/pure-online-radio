import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { NavSidebar } from "./NavSidebar";
import { TopBar } from "./TopBar";
import { natsClient } from "../lib/natsClient";

export function AppShell() {
  useEffect(() => {
    // Best-effort: a failed NATS connection just leaves the status badge
    // showing "error"/"offline" — it must never block the rest of the UI.
    natsClient.connect().catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      <NavSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
