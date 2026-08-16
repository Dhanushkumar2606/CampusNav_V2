/**
 * Explore home hub — shown when no search query is active.
 *
 * Renders the campus catalog (featured first) with cheap per-campus stats
 * from `/campuses/{slug}/stats`, plus a "near me" row that geo-ranks
 * campuses via `/campuses/near` when the user shares their location.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Compass,
  Home,
  LocateFixed,
  MapPin,
  Navigation,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getCampusesNear, getCampusStats, listCampuses } from "@/api/navigation";
import type { Campus, CampusNear, CampusStats } from "@/lib/navigation-types";
import { cn } from "@/lib/utils";
import { getLocationSource } from "@/lib/locationSource";

const NEAR_RADIUS_M = 200_000;

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

type GeoState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; campuses: CampusNear[] }
  | { status: "error" };

export function CampusHub({ onNavigate }: { onNavigate: (slug: string) => void }) {
  const [campuses, setCampuses] = useState<Campus[] | null>(null);
  const [stats, setStats] = useState<Map<string, CampusStats>>(new Map());
  // Slugs whose stats request failed — distinct from a genuinely empty
  // campus, so cards never show misleading zeros + "loading stats…".
  const [statsFailed, setStatsFailed] = useState<Set<string>>(new Set());
  const [hubError, setHubError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [locateTick, setLocateTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHubError(false);
    setCampuses(null);
    setStatsFailed(new Set());
    (async () => {
      try {
        const all = await listCampuses();
        if (cancelled) return;
        const featuredFirst = [...all].sort(
          (a, b) => Number(b.featured) - Number(a.featured),
        );
        setCampuses(featuredFirst);
        const settled = await Promise.allSettled(
          featuredFirst.map((c) => getCampusStats(c.slug)),
        );
        if (cancelled) return;
        const merged = new Map<string, CampusStats>();
        const failed = new Set<string>();
        featuredFirst.forEach((c, i) => {
          const r = settled[i];
          if (r.status === "fulfilled") merged.set(c.slug, r.value);
          else failed.add(c.slug);
        });
        setStats(merged);
        setStatsFailed(failed);
      } catch {
        if (!cancelled) setHubError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTick]);

  const locate = useCallback(() => {
    const source = getLocationSource();
    if (!source) {
      setGeo({ status: "unsupported" });
      return;
    }
    setGeo({ status: "locating" });
    source.getCurrentPosition(
      (pos) => {
        getCampusesNear(pos.coords.latitude, pos.coords.longitude, {
          radiusM: NEAR_RADIUS_M,
        })
          .then((near) => setGeo({ status: "ready", campuses: near }))
          .catch(() => setGeo({ status: "error" }));
      },
      () => setGeo({ status: "error" }),
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  useEffect(() => {
    if (locateTick > 0) locate();
  }, [locateTick, locate]);

  if (hubError) {
    return (
      <ErrorState
        title="Could not load campuses"
        message="The catalog is unreachable right now."
        onRetry={() => setRetryTick((t) => t + 1)}
      />
    );
  }

  if (campuses === null) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading campuses">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (campuses.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-brand-subtle">
        No campuses are loaded yet.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:px-4 md:pb-6">
      {/* Near me */}
      <section aria-label="Campuses near you">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-text uppercase tracking-wider">
            Near you
          </h2>
          {geo.status !== "ready" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLocateTick((t) => t + 1)}
              disabled={geo.status === "locating"}
              className="h-7 px-2 text-xs"
            >
              <LocateFixed className="size-3.5 mr-1.5" aria-hidden />
              {geo.status === "locating" ? "Locating…" : "Use my location"}
            </Button>
          )}
        </div>
        {geo.status === "idle" || geo.status === "unsupported" ? (
          <p className="text-sm text-brand-subtle">
            Share your location and we&apos;ll rank campuses by distance.
          </p>
        ) : geo.status === "locating" ? (
          <p className="text-sm text-brand-subtle animate-pulse">
            Reading your GPS fix…
          </p>
        ) : geo.status === "error" ? (
          <p className="text-sm text-brand-subtle">
            Couldn&apos;t get a location fix. You can still browse below.
          </p>
        ) : geo.campuses.length === 0 ? (
          <p className="text-sm text-brand-subtle">
            No campuses within {formatDistance(NEAR_RADIUS_M)} of you.
          </p>
        ) : (
          <div className="space-y-2">
            {geo.campuses.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onNavigate(c.slug)}
                className="flex w-full items-center gap-3 rounded-xl border border-brand-muted bg-brand-navy/60 px-4 py-3 text-left transition-colors hover:bg-brand-navy/80"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/20 text-brand-cyan">
                  <Navigation className="size-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-text">{c.name}</p>
                  <p className="text-xs text-brand-subtle">
                    {formatDistance(c.distance_m)} from your fix
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Campus catalog */}
      <section aria-label="Campus catalog">
        <h2 className="mb-3 text-sm font-semibold text-brand-text uppercase tracking-wider">
          Campuses
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {campuses.map((c) => {
            const s = stats.get(c.slug);
            const failed = statsFailed.has(c.slug);
            const fmt = (v: number | undefined) =>
              failed ? "–" : (v ?? 0).toLocaleString();
            const counts: { label: string; value: string; icon: typeof MapPin }[] = [
              { label: "Buildings", value: fmt(s?.buildings), icon: Building2 },
              { label: "Entrances", value: fmt(s?.entrances), icon: Home },
              { label: "Landmarks", value: fmt(s?.landmarks), icon: MapPin },
              { label: "Transit", value: fmt(s?.transit), icon: Compass },
              { label: "POIs", value: fmt(s?.poi), icon: MapPin },
            ];
            return (
              <Card
                key={c.slug}
                className={cn(
                  "cursor-pointer border-brand-muted bg-brand-navy/60 transition-all hover:bg-brand-navy/80",
                  c.featured && "border-brand-green/40",
                )}
                onClick={() => onNavigate(c.slug)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-brand-text truncate">{c.name}</h3>
                      {c.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-brand-subtle">
                          {c.description}
                        </p>
                      )}
                      {c.featured && (
                        <Chip className="mt-2 bg-brand-green/20 text-brand-green">
                          <Sparkles className="size-3 mr-1" aria-hidden />
                          Featured
                        </Chip>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-brand-cyan"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate(c.slug);
                      }}
                    >
                      Navigate
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-brand-muted/60 pt-3">
                    {counts.map(({ label, value, icon: Icon }) => (
                      <span
                        key={label}
                        className="flex items-center gap-1 text-xs text-brand-subtle"
                      >
                        <Icon className="size-3 text-brand-muted" aria-hidden />
                        {value} <span className="text-brand-muted">{label.toLowerCase()}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-brand-muted">
                    {failed
                      ? "Stats unavailable right now — tap to open anyway"
                      : s
                        ? `${s.nodes} walkable nodes · ${s.surveyed_edges} surveyed paths`
                        : "loading stats…"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}