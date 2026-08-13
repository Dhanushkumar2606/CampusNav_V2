import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Trash2, ArrowRight } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { StateWrapper } from "@/components/ui/state-wrapper";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { prettyLabel } from "@/lib/brand";
import { listFavorites, removeFavorite } from "@/api/search";
import type { FavoriteOut } from "@/lib/navigation-types";

export function Saved() {
  const { user, status, getToken } = useAuth();
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFavorites = async () => {
    const token = await getToken();
    if (!token) {
      setFavorites([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await listFavorites(token);
      setFavorites(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load favorites");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchFavorites();
    }
  }, [status, user]);

  const handleRemove = async (favoriteId: string) => {
    const token = await getToken();
    if (!token) return;
    try {
      await removeFavorite(token, favoriteId);
      setFavorites((prev) => prev.filter((f) => f.id !== favoriteId));
    } catch (err) {
      console.error("Remove favorite failed:", err);
    }
  };

  const handleNavigate = (favorite: FavoriteOut) => {
    if (favorite.target_type === "building") {
      navigate(`/map?destination=${favorite.target_id}`);
    }
  };

  if (status !== "authenticated") {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <Bookmark className="size-12 mx-auto text-brand-subtle mb-4" />
          <h2 className="text-lg font-semibold text-brand-text mb-2">Sign in to save places</h2>
          <p className="text-brand-subtle mb-6 max-w-xs">
            Bookmark buildings, save routes, and keep your frequent destinations handy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-brand-text">Saved places</h1>
        {favorites.length > 0 && (
          <span className="text-sm text-brand-subtle">{favorites.length} place{favorites.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <StateWrapper
        status={loading ? "loading" : error ? "error" : favorites.length === 0 ? "success" : "success"}
        loadingMessage="Loading your saved places…"
        errorMessage={error ?? "Could not load favorites"}
        emptyMessage="No saved places yet. Tap the bookmark on any building or route to keep it here."
      >
        {favorites.length > 0 && (
          <div className="space-y-3" role="list">
            {favorites.map((fav) => (
              <Card key={fav.id} className="border-brand-muted bg-brand-navy/60" role="listitem">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-brand-amber/20 text-brand-amber shrink-0">
                      <Bookmark className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-brand-text truncate">
                        {fav.label ?? prettyLabel(fav.target_id)}
                      </h3>
                      <p className="text-xs text-brand-subtle capitalize">
                        {fav.category ?? fav.target_type}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleNavigate(fav)}
                        aria-label={`Navigate to ${fav.label ?? fav.target_id}`}
                      >
                        <ArrowRight className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(fav.id)}
                        aria-label={`Remove ${fav.label ?? fav.target_id}`}
                        className="text-brand-danger hover:text-brand-danger/80"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </StateWrapper>
    </div>
  );
}