/**
 * BuildingDetails — shared content for the selected-place experience.
 * Renders ONLY real data: building name/kind/floors/elevator/accessibility
 * plus the node's connected neighbors. Missing data shows "Not available".
 */
import {
  Accessibility,
  Building2,
  DoorOpen,
  Footprints,
  Landmark,
  Layers,
  Navigation,
  TrainFront,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Building, GraphPayload, PathNode } from "@/lib/navigation-types";
import { prettyLabel } from "@/lib/brand";
import { cn } from "@/lib/utils";

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
  const kind = KIND_META[node.type] ?? KIND_META.poi;
  const KindIcon = kind.icon;
  const connected = graph.edges
    .filter((e) => e.from_id === node.id || e.to_id === node.id)
    .map((e) => (e.from_id === node.id ? e.to_id : e.from_id))
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is PathNode => Boolean(n))
    .slice(0, 4);

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
    </div>
  );
}
