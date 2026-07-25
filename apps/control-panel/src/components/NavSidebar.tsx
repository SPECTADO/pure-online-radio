import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/queue", label: "Queue" },
  { to: "/schedule", label: "Schedule" },
  { to: "/library/songs", label: "Songs Library" },
  { to: "/library/jingles", label: "Jingles Library" },
  { to: "/library/ads", label: "Ads Library" },
  { to: "/clock-wheels", label: "Clock Wheels" },
  { to: "/external-streams", label: "External Streams" },
  { to: "/settings/separation-rules", label: "Separation Rules" },
];

export function NavSidebar() {
  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white p-4">
      <div className="mb-4 px-2 text-lg font-semibold text-slate-900">Spectado</div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
