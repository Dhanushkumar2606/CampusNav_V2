/**
 * LocationPicker — searchable dropdown for picking a node by label.
 * Lists verified destinations only: buildings, entrances, landmarks,
 * POIs and transit stops. Raw routing junctions (internal graph
 * scaffolding) are excluded — they are not places a user can plan to.
 * The currently selected node is always kept, even if it is a junction,
 * so a deep-linked selection still renders. Building entrances sort
 * first (the most useful targets), then everything else alphabetically.
 */
import { useMemo } from "react";

import type { GraphPayload } from "@/lib/navigation-types";
import { prettyLabel } from "@/lib/brand";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface Props {
  graph: GraphPayload | null;
  value: string | null;
  onChange: (nodeId: string) => void;
  placeholder: string;
  disabled?: boolean;
  id?: string;
  /** Offer the user's live GPS snap as an option (the From field). */
  allowLive?: boolean;
}

interface Option {
  value: string;
  label: string;
  group: string;
  badge?: string;
}

export function LocationPicker({
  graph,
  value,
  onChange,
  placeholder,
  disabled,
  id,
  allowLive,
}: Props) {
  const { locate, nearestNode } = useCampusRoute();

  // The user's live position, snapped to the closest walkable node — shown
  // only for the From field, and only while a fix (or a pending request)
  // exists. "Locating…" is a placeholder row that can't be picked.
  const liveOption = useMemo<Option | null>(() => {
    if (!allowLive) return null;
    if (locate.status === "locating") {
      return { value: "locating", label: "Locating your position…", group: "You", badge: "GPS" };
    }
    const snap = nearestNode;
    if (locate.status !== "ok" || !locate.coords || !snap) return null;
    const accuracy = Math.round(locate.coords.accuracyM);
    return {
      value: snap.node_id,
      label: "My location",
      group: "You",
      badge: accuracy > 0 ? `±${accuracy} m` : "GPS",
    };
  }, [allowLive, locate.status, locate.coords, nearestNode]);

  const options = useMemo(() => {
    const list: Option[] = [];
    if (liveOption) list.push(liveOption);
    if (graph) {
      const copy = graph.nodes.filter(
        // Hide raw junction scaffolding; always keep the current selection
        // (which may be the live snap — it's listed above already).
        (n) => n.type !== "junction" || n.id === value,
      );
      copy.sort((a, b) => {
        // Building entrances bubble to the top.
        const aB = a.building_id ? 0 : 1;
        const bB = b.building_id ? 0 : 1;
        if (aB !== bB) return aB - bB;
        return a.label.localeCompare(b.label);
      });
      for (const n of copy) {
        list.push({
          value: n.id,
          label: prettyLabel(n.label),
          group: n.building_id ? "Buildings" : "Places",
          badge: n.building_id ? "building" : n.type,
        });
      }
    }
    return list;
  }, [graph, value, liveOption]);

  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onValueChange={(v) => {
        if (v === "locating") return;
        onChange(v);
      }}
      placeholder={placeholder}
      searchPlaceholder={graph ? "Search places…" : "Loading graph…"}
      disabled={disabled || !graph}
    />
  );
}