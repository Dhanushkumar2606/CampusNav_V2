/**
 * Three-up stats: distance, walk time, step count. Plus an "Estimated
 * edges" badge that fires whenever every step in the route is
 * `is_estimated=true` (which is true for the SRM KTR dataset).
 */
import { Clock, MapPin, Route as RouteIcon } from "lucide-react";

import type { Route } from "@/lib/navigation-types";
import { Badge } from "@/components/ui/badge";
import { formatDistance, formatMinutes } from "@/lib/format";

export function RouteSummary({ route }: { route: Route }) {
  return (
    <div className="rounded-md border border-brand-muted bg-brand-deep/60 p-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={<MapPin className="size-3.5" />} label="Distance" value={formatDistance(route.total_distance_m)} />
        <Stat icon={<Clock className="size-3.5" />} label="Walk time" value={formatMinutes(route.estimated_walk_time_min)} />
        <Stat icon={<RouteIcon className="size-3.5" />} label="Steps" value={`${route.step_count}`} />
      </div>
      {route.all_estimated ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline" className="border-brand-subtle/60 text-brand-subtle">
            Estimated edges
          </Badge>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline" className="border-brand-green/60 text-brand-green">
            Surveyed route
          </Badge>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-base text-brand-text">{value}</div>
    </div>
  );
}
