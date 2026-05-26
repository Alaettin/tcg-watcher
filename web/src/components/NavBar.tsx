import { NavLink } from "react-router-dom";
import { Activity, Bookmark, ListChecks, Store, Bell, Settings as SettingsIcon } from "lucide-react";
import clsx from "clsx";

const ITEMS = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/watchlist", label: "Sets", icon: ListChecks },
  { to: "/lists", label: "Listen", icon: Bookmark },
  { to: "/shops", label: "Shops", icon: Store },
  { to: "/events", label: "Events", icon: Bell },
  { to: "/settings", label: "Einst.", icon: SettingsIcon },
];

export function NavBar() {
  return (
    <>
      <header className="hidden md:flex sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <nav className="mx-auto w-full max-w-6xl flex items-center gap-1 px-4 h-14">
          <div className="font-semibold mr-6">Pokémon Watcher</div>
          {ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition",
                  isActive
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                )
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6">
          {ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex flex-col items-center gap-0.5 py-2 text-[9px] font-medium min-w-0",
                  isActive
                    ? "text-slate-900 dark:text-slate-100"
                    : "text-slate-500 dark:text-slate-400",
                )
              }
            >
              <item.icon size={18} />
              <span className="truncate w-full text-center px-0.5">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
