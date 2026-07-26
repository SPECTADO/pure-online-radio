import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { StationSettingsDTO } from "@spectado/shared-types";
import { apiClient } from "../lib/apiClient";

interface NavLeaf {
  to: string;
  label: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  children: NavLeaf[];
}

const NAV_TOP: NavLeaf[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/queue", label: "Queue" },
];

// Rendered after NAV_GROUPS -- always the last entry in the sidebar.
const NAV_BOTTOM: NavLeaf[] = [{ to: "/system-status", label: "System Status" }];

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Library",
    children: [
      { to: "/library/songs", label: "Songs Library" },
      { to: "/library/jingles", label: "Jingles Library" },
      { to: "/library/ads", label: "Ads Library" },
      { to: "/library/categories", label: "Categories" },
    ],
  },
  {
    label: "Schedule",
    children: [
      { to: "/schedule", label: "Schedule" },
      { to: "/external-streams", label: "External Streams" },
      { to: "/clock-wheels", label: "Clock Wheels" },
    ],
  },
  {
    label: "Settings",
    children: [
      { to: "/settings/station", label: "Station Settings" },
      { to: "/settings/queue-rules", label: "Queue Rules" },
      { to: "/settings/scratch-pad", label: "Scratch Pad" },
    ],
  },
];

const leafLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
  }`;

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.children.some((child) => pathname === child.to || pathname.startsWith(`${child.to}/`));
}

function NavGroupSection({ group, active }: { group: NavGroup; active: boolean }) {
  const [open, setOpen] = useState(active);

  // Auto-expand (never auto-collapse) when navigation lands inside this
  // group -- e.g. a direct link to /clock-wheels/:id shouldn't hide itself.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
      >
        {group.label}
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="ml-2 flex flex-col gap-1 border-l border-slate-200 pl-3 pt-1">
          {group.children.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={leafLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M7 5l6 5-6 5V5z" />
    </svg>
  );
}

export function NavSidebar() {
  const location = useLocation();
  const stationQuery = useQuery({
    queryKey: ["public", "station"],
    queryFn: () => apiClient.get<StationSettingsDTO>("/public/station"),
  });

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-4">
      <div className="mb-4 truncate px-2 text-lg font-semibold text-slate-900">
        {stationQuery.data?.name ?? "Spectado"}
      </div>

      {NAV_TOP.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={leafLinkClass}>
          {item.label}
        </NavLink>
      ))}

      <div className="mt-2 flex flex-col gap-1">
        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.label} group={group} active={isGroupActive(group, location.pathname)} />
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-1">
        {NAV_BOTTOM.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={leafLinkClass}>
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
