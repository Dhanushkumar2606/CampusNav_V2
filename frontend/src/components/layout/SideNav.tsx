import { NavLink } from "react-router-dom";
import { Compass, Map as MapIcon, Bookmark, Sparkles, User } from "lucide-react";

import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/map", label: "Map", icon: MapIcon },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/profile", label: "Profile", icon: User },
] as const;

/** Desktop left rail — contextual navigation for the shell. */
export function SideNav() {
  return (
    <nav
      aria-label="Primary"
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-brand-muted bg-brand-navy/40 p-3 md:flex"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-brand-green/10 text-brand-green"
                : "text-brand-subtle hover:bg-brand-surface hover:text-brand-text",
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
