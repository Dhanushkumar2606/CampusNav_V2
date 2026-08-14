import { Outlet } from "react-router-dom";

import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { SideNav } from "./SideNav";
import { PageTransition } from "@/components/ui/page-transition";

/**
 * AppShell — the premium product shell.
 *   Desktop: header + left rail + content.
 *   Mobile:  header + content + bottom navigation.
 * Map-first content (MapView) renders full-bleed inside <main>.
 */
export function AppShell() {
  return (
    <div className="flex h-full flex-col bg-brand-deep text-brand-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-brand-green focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-deep"
      >
        Skip to content
      </a>
      <Header />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main id="main-content" className="relative min-h-0 flex-1 overflow-hidden">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}