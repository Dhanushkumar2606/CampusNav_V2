/**
 * Lightweight toast system — context provider + useToast hook.
 * Renders a stacked viewport in the top-right (desktop) / top-center (mobile).
 */
import * as React from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastContextValue {
  toast: (opts: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, tone = "info" }: ToastInput) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-4"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-brand-surface/95 p-3 shadow-float backdrop-blur",
                  t.tone === "success" && "border-brand-green/30",
                  t.tone === "error" && "border-brand-danger/30",
                  t.tone === "info" && "border-brand-muted",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    t.tone === "success" && "text-brand-green",
                    t.tone === "error" && "text-brand-danger",
                    t.tone === "info" && "text-brand-cyan",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-text">{t.title}</p>
                  {t.description ? (
                    <p className="mt-0.5 text-xs text-brand-subtle">{t.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="rounded p-1 text-brand-subtle transition-colors hover:bg-brand-muted/50 hover:text-brand-text"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
