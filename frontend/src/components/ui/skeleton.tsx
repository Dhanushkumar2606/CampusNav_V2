import { cn } from "@/lib/utils";

/** Skeleton placeholder for async content. Mirrors shadcn conventions. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton-shimmer animate-shimmer rounded-md", className)} {...props} />;
}
