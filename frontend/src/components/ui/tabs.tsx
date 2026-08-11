import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = { value: string; onValueChange: (v: string) => void };
const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}

/** Minimal accessible tabs — route alternatives, building sections, etc. */
export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-brand-surface p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current, onValueChange } = useTabs();
  const selected = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onValueChange(value)}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        selected
          ? "bg-brand-green/15 text-brand-green"
          : "text-brand-subtle hover:bg-brand-muted/50 hover:text-brand-text",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current } = useTabs();
  if (current !== value) return null;
  return <div role="tabpanel" className={className}>{children}</div>;
}
