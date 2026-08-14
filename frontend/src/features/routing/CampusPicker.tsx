/**
 * CampusPicker — searchable dropdown bound to /api/navigation/campuses.
 * Auto-selects the first campus on mount if none is set.
 */
import { useEffect, useMemo } from "react";

import type { Campus } from "@/lib/navigation-types";
import { SearchableSelect } from "@/components/ui/searchable-select";

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

  const options = useMemo(
    () =>
      campuses.map((c) => ({
        value: c.slug,
        label: c.name,
        caption: c.description ?? undefined,
      })),
    [campuses],
  );

  return (
    <SearchableSelect
      options={options}
      value={value}
      onValueChange={onChange}
      placeholder="Select a campus…"
      searchPlaceholder="Search campuses…"
      disabled={disabled}
    />
  );
}