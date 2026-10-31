import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { NavSidebar } from "./NavSidebar";
import { TopBar } from "./TopBar";
import { ToastContainer } from "./ToastContainer";
import { UploadQueueTray } from "./UploadQueueTray";
import { natsClient } from "../lib/natsClient";
import { refreshAccessToken } from "../lib/apiClient";

/** Comfortably inside the default 15m JWT_ACCESS_TTL. */
const PROACTIVE_REFRESH_MS = 10 * 60 * 1000;

export function AppShell() {
  useEffect(() => {
    // Best-effort: a failed NATS connection just leaves the status badge
    // showing "error"/"offline" (and retries in the background) — it must
    // never block the rest of the UI.
    natsClient.connect().catch(() => {});
  }, []);

  useEffect(() => {
    // Plain <img>/<audio>/download links to the API (cover art, previews, the
    // waveform fetch) can't do apiClient's 401-refresh-retry themselves -- keep
    // the access cookie fresh instead, so they don't break after 15 idle minutes.
    const timer = setInterval(() => void refreshAccessToken(), PROACTIVE_REFRESH_MS);
    return () => clearInterval(timer);
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
      <ToastContainer />
      <UploadQueueTray />
    </div>
  );
}
