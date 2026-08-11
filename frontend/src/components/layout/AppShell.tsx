import { Outlet } from "react-router-dom";

import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { SideNav } from "./SideNav";

/**
 * AppShell — the premium product shell.
 *   Desktop: header + left rail + content.
 *   Mobile:  header + content + bottom navigation.
 * Map-first content (MapView) renders full-bleed inside <main>.
 */
export function AppShell() {
  return (
    <div className="flex h-full flex-col bg-brand-deep text-brand-text">
      <Header />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
