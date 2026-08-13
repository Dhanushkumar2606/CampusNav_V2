import { cn } from "@/lib/utils";

type Status = "idle" | "loading" | "success" | "error" | "offline";

interface StateWrapperProps {
  status: Status;
  children: React.ReactNode;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
  offlineMessage?: string;
  className?: string;
}

export function StateWrapper({
  status,
  children,
  loadingMessage = "Loading…",
  errorMessage = "Something went wrong. Please try again.",
  emptyMessage = "No data available.",
  offlineMessage = "You appear to be offline. Check your connection.",
  className,
}: StateWrapperProps) {
  if (status === "loading") {
    return (
      <div className={cn("flex h-32 items-center justify-center text-brand-subtle", className)}>
        {loadingMessage}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={cn("flex h-32 items-center justify-center text-brand-danger", className)}>
        {errorMessage}
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className={cn("flex h-32 items-center justify-center text-brand-warning", className)}>
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