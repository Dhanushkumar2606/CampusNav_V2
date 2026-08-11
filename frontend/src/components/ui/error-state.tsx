import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

/** Polished inline error state with an optional retry action. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-brand-danger/30 bg-brand-danger/10 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-brand-danger/15">
        <AlertTriangle className="size-5 text-brand-danger" aria-hidden />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-brand-text">{title}</h3>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-brand-subtle">
          {message}
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
