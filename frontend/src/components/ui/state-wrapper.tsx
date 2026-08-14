import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

type Status = "idle" | "loading" | "success" | "error" | "offline";

interface StateWrapperProps {
  status: Status;
  children: React.ReactNode;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
  offlineMessage?: string;
  /** Retry action surfaced in the error state. */
  onRetry?: () => void;
  /** Render skeleton rows instead of a centered spinner while loading. */
  skeleton?: { rows?: number; className?: string };
  className?: string;
}

/**
 * StateWrapper — consistent loading/error/empty treatment for async lists.
 * Loading shows a subtle skeleton block (or a spinner), errors use the
 * polished ErrorState (optionally with a retry action), and a successful
 * but empty result renders the empty message.
 */
export function StateWrapper({
  status,
  children,
  loadingMessage = "Loading…",
  errorMessage = "Something went wrong. Please try again.",
  emptyMessage = "No data available.",
  offlineMessage = "You appear to be offline. Check your connection.",
  onRetry,
  skeleton,
  className,
}: StateWrapperProps) {
  if (status === "loading") {
    if (skeleton) {
      const rows = skeleton.rows ?? 3;
      return (
        <div
          role="status"
          aria-label={loadingMessage}
          className={cn("space-y-3", className)}
        >
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className={cn("h-16 w-full", skeleton.className)} />
          ))}
        </div>
      );
    }
    return (
      <div
        role="status"
        aria-label={loadingMessage}
        className={cn("flex h-32 items-center justify-center gap-2 text-brand-subtle", className)}
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span className="text-sm">{loadingMessage}</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <ErrorState
        message={errorMessage}
        onRetry={onRetry}
        className={cn("h-32 justify-center", className)}
      />
    );
  }

  if (status === "offline") {
    return (
      <div
        role="alert"
        className={cn("flex h-32 items-center justify-center text-brand-warning", className)}
      >
        {offlineMessage}
      </div>
    );
  }

  if (status === "success" && (children == null || (Array.isArray(children) && children.length === 0))) {
    return (
      <div className={cn("flex h-32 items-center justify-center text-brand-subtle", className)}>
        {emptyMessage}
      </div>
    );
  }

  return <>{children}</>;
}