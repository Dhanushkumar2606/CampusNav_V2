import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./SideNav";

/** Mobile bottom navigation — thumb-friendly, map-first. */
export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="grid shrink-0 grid-cols-5 border-t border-brand-muted bg-brand-navy/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
              isActive ? "text-brand-green" : "text-brand-subtle",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn("size-5", isActive && "text-brand-green")} aria-hidden />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
