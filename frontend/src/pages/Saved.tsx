import { Bookmark } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { EmptyState } from "@/components/ui/empty-state";

/** Saved — favorite buildings, recent destinations (Phase 4 wires the API). */
export function Saved() {
  const { user, status } = useAuth();

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <h1 className="text-lg font-semibold text-brand-text">Saved places</h1>
      <div className="mt-6">
        {status !== "authenticated" || !user ? (
          <EmptyState
            icon={Bookmark}
            title="Sign in to save places"
            description="Bookmark buildings, save routes, and keep your frequent destinations handy."
          />
        ) : (
          <EmptyState
            icon={Bookmark}
            title="No saved places yet"
            description="Tap the bookmark on any building or route to keep it here."
          />
        )}
      </div>
    </div>
  );
}
