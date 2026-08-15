/**
 * BuildingDetails — shared content for the selected-place experience.
 * Renders ONLY real data: building name/kind/floors/elevator/accessibility,
 * the node's connected neighbors, plus (Phase G) the building's entrances
 * from `getBuildingDetail`, an Add-to-Saved toggle and a shareable
 * `/map?place=<id>` deep link. Missing data shows "Not available".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  Bookmark,
  Building2,
  Check,
  DoorOpen,
  Footprints,
  Landmark,
  Layers,
  Loader2,
  Navigation,
  Orbit,
  Share2,
  TrainFront,
  X,
} from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addFavorite, getBuildingDetail, listFavorites, removeFavorite } from "@/api/search";
import type { Building, BuildingDetailOut, GraphPayload, PathNode } from "@/lib/navigation-types";
import { prettyLabel } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { nodeImmersive } from "@/lib/immersive";
import { ImmersiveViewer } from "@/features/immersive/ImmersiveViewer";

export interface BuildingDetailsProps {
  node: PathNode;
  building: Building | null;
  graph: GraphPayload;
  onSetOrigin: () => void;
  onSetDestination: () => void;
  onClose?: () => void;
  /** compact: inline card; full: sheet layout with header row */
  variant?: "compact" | "full";
}

const KIND_META: Record<string, { label: string; icon: typeof Building2 }> = {
  entrance: { label: "Entrance", icon: DoorOpen },
  landmark: { label: "Landmark", icon: Landmark },
  transit: { label: "Transit", icon: TrainFront },
  junction: { label: "Junction", icon: Footprints },
  poi: { label: "Place", icon: Building2 },
  transition: { label: "Transition", icon: Layers },
};

function InfoRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-brand-subtle">{label}</span>
      <span className={cn("text-right font-medium", ok ? "text-brand-text" : "text-brand-subtle/70")}>
        {value}
      </span>
    </div>
  );
}

export function BuildingDetails({
  node,
  building,
  graph,
  onSetOrigin,
  onSetDestination,
  onClose,
  variant = "compact",
}: BuildingDetailsProps) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const kind = KIND_META[node.type] ?? KIND_META.poi;
  const KindIcon = kind.icon;

  // ---- Optional 360° experience (scene-linked; purely additive) ----
  const immersive = useMemo(() => nodeImmersive(node), [node]);
  const [viewerOpen, setViewerOpen] = useState(false);

  // ---- Phase G: full building record (entrances, floors, rooms) ----------
  const [detail, setDetail] = useState<BuildingDetailOut | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!building) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    getBuildingDetail(building.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [building?.id]);

  const connected = useMemo(
    () =>
      graph.edges
        .filter((e) => e.from_id === node.id || e.to_id === node.id)
        .map((e) => (e.from_id === node.id ? e.to_id : e.from_id))
        .map((id) => graph.nodes.find((n) => n.id === id))
        .filter((n): n is PathNode => Boolean(n))
        .slice(0, 4),
    [graph, node.id],
  );

  const totalRooms = useMemo(
    () => (detail?.floors ?? []).reduce((sum, f) => sum + f.rooms_count, 0),
    [detail],
  );

  // ---- Add-to-Saved (favorites) + shareable deep link --------------------
  const favoriteType = building ? "building" : "node";
  const favoriteId = building ? building.id : node.id;
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) return;
    listFavorites(token).then((favs) => {
      if (!cancelled) setSaved(favs.some((f) => f.target_type === favoriteType && f.target_id === favoriteId));
    });
    return () => {
      cancelled = true;
    };
  }, [getToken, favoriteType, favoriteId]);

  const toggleSaved = useCallback(async () => {
    const token = getToken();
    if (!token) {
      toast({ title: "Saved requires sign-in", tone: "error" });
      return;
    }
    try {
      if (saved) {
        const favs = await listFavorites(token);
        const match = favs.find((f) => f.target_type === favoriteType && f.target_id === favoriteId);
        if (match) {
          await removeFavorite(token, match.id);
          setSaved(false);
        }
      } else {
        await addFavorite(token, {
          target_type: favoriteType,
          target_id: favoriteId,
          note: null,
        });
        setSaved(true);
      }
    } catch {
      toast({ title: "Could not update Saved", tone: "error" });
    }
  }, [getToken, toast, saved, favoriteType, favoriteId]);

  const shareLink = useMemo(
    () => `${window.location.origin}/map?place=${encodeURIComponent(node.id)}`,
    [node.id],
  );
  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toast({ title: "Link copied", description: "Anyone with a map link can open this place.", tone: "success" });
    } catch {
      toast({ title: "Could not copy link", tone: "error" });
    }
  }, [shareLink, toast]);

  return (
    <div className={variant === "full" ? "pb-2" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-surface">
            <KindIcon className="size-5 text-brand-cyan" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-brand-text">{prettyLabel(node.label)}</h3>
            <p className="text-xs capitalize text-brand-subtle">{kind.label}</p>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-md p-1.5 text-brand-subtle transition-colors hover:bg-brand-surface hover:text-brand-text"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-brand-muted bg-brand-navy/50 p-3">
        <InfoRow
          label="Floors"
          value={building ? String(building.num_floors) : "Not available"}
          ok={Boolean(building)}
        />
        <InfoRow
          label="Rooms"
          value={detail && detail.floors.length > 0 ? String(totalRooms) : "Not available"}
          ok={Boolean(detail && detail.floors.length > 0)}
        />
        <InfoRow
          label="Elevator"
          value={building ? (building.has_elevator ? "Available" : "Not available") : "Not available"}
          ok={Boolean(building?.has_elevator)}
        />
        <InfoRow
          label="Accessible entry"
          value={
            building
              ? building.is_accessible
                ? "Reported accessible"
                : "Not marked accessible"
              : "Not available"
          }
          ok={Boolean(building?.is_accessible)}
        />
        <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="text-brand-subtle">Connects to</span>
          <span className="max-w-[55%] text-right font-medium text-brand-text">
            {connected.length > 0
              ? connected.map((n) => prettyLabel(n.label)).join(" · ")
              : "Not available"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-brand-muted/60 py-1.5 text-sm">
          <span className="text-brand-subtle">Entrances</span>
          <span className="max-w-[55%] text-right">
            {loadingDetail ? (
              <Loader2 className="ml-auto size-4 animate-spin text-brand-subtle" aria-hidden />
            ) : detail && detail.entrances.length > 0 ? (
              <span className="flex flex-col items-end gap-1">
                {detail.entrances.map((e) => (
                  <span key={e.id} className="flex items-center gap-1.5 font-medium text-brand-text">
                    {e.label}
                    {e.has_stairs ? (
                      <span className="text-[10px] uppercase tracking-wide text-brand-subtle">stairs</span>
                    ) : null}
                    <Accessibility
                      className={cn("size-3.5", e.is_accessible ? "text-brand-green" : "text-brand-subtle")}
                      aria-label={e.is_accessible ? "Accessible entrance" : "Not marked accessible"}
                    />
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-brand-subtle/70">Not available</span>
            )}
          </span>
        </div>
      </div>

      {building ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-brand-subtle">
          <Accessibility className="size-3.5" aria-hidden />
          Accessibility data is campus-reported and unverified.
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onSetOrigin}>
          <Navigation className="size-3.5" aria-hidden />
          Start here
        </Button>
        <Button size="sm" className="flex-1" onClick={onSetDestination}>
          <Navigation className="size-3.5" aria-hidden />
          Destination
        </Button>
      </div>
      {/* Optional 360° — only when this place has immersive content. The
          viewer is additive: it can never affect routing or navigation. */}
      {immersive ? (
        <div className="mt-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/10"
            onClick={() => setViewerOpen(true)}
          >
            <Orbit className="size-3.5" aria-hidden />
            Explore 360°
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-brand-subtle">
            Official campus tour — opens outside the navigation app.
          </p>
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => void toggleSaved()}>
          {saved ? <Check className="size-3.5 text-brand-green" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => void share()}>
          <Share2 className="size-3.5" aria-hidden />
          Share
        </Button>
      </div>

      {/* 360° viewer (portal; mounted only while open). */}
      <ImmersiveViewer
        open={viewerOpen}
        scene={immersive}
        placeLabel={prettyLabel(node.label)}
        onClose={() => setViewerOpen(false)}
        onNavigateHere={() => {
          setViewerOpen(false);
          onSetDestination();
        }}
      />
    </div>
  );
}