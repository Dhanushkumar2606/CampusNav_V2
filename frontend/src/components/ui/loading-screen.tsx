import { Loader2 } from "lucide-react";

/** Full-viewport loading state used as the Suspense fallback. */
export function LoadingScreen() {
  return (
    <div
      className="flex h-full min-h-screen items-center justify-center bg-brand-deep text-brand-cyan"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-widest text-brand-subtle">
          Loading
        </span>
      </div>
    </div>
  );
}