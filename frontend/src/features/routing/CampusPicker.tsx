/**
 * Dropdown bound to /api/navigation/campuses. Auto-selects the first
 * campus on mount if none is set.
 */
import { useEffect } from "react";

import type { Campus } from "@/lib/navigation-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  campuses: Campus[];
  value: string | null;
  onChange: (slug: string) => void;
  disabled?: boolean;
}

export function CampusPicker({ campuses, value, onChange, disabled }: Props) {
  useEffect(() => {
    if (!value && campuses.length > 0) {
      onChange(campuses[0].slug);
    }
  }, [value, campuses, onChange]);

  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="bg-brand-deep/60">
        <SelectValue placeholder="Select a campus…" />
      </SelectTrigger>
      <SelectContent>
        {campuses.map((c) => (
          <SelectItem key={c.id} value={c.slug}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
