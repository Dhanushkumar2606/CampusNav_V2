/**
 * Typeahead-style dropdown for picking a node by label. Renders every
 * node in the campus graph, sorted: building-entrance first (these
 * are the most useful targets), then everything else alphabetically.
 */
import { useMemo } from "react";

import type { GraphPayload } from "@/lib/navigation-types";
import { prettyLabel } from "@/lib/brand";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  graph: GraphPayload | null;
  value: string | null;
  onChange: (nodeId: string) => void;
  placeholder: string;
  disabled?: boolean;
  id?: string;
}

export function LocationPicker({
  graph,
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: Props) {
  const sortedNodes = useMemo(() => {
    if (!graph) return [];
    const copy = [...graph.nodes];
    copy.sort((a, b) => {
      // Building entrances bubble to the top.
      const aB = a.building_id ? 0 : 1;
      const bB = b.building_id ? 0 : 1;
      if (aB !== bB) return aB - bB;
      return a.label.localeCompare(b.label);
    });
    return copy;
  }, [graph]);

  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled || !graph}>
      <SelectTrigger id={id} className="bg-brand-deep/60">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {sortedNodes.map((n) => (
          <SelectItem key={n.id} value={n.id}>
            <span className="flex items-center gap-2">
              <span>{prettyLabel(n.label)}</span>
              {n.building_id ? (
                <span className="text-[10px] uppercase tracking-wider text-brand-cyan">
                  building
                </span>
              ) : null}
              {!n.building_id ? (
                <span className="text-[10px] uppercase tracking-wider text-brand-subtle">
                  {n.type}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
