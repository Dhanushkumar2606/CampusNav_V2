/**
 * Route preference controls: stairs avoidance and the accessibility
 * toggle. The routing mode is fixed to shortest (optimal) — there is no
 * user-facing mode choice.
 */
import { Accessibility, Mountain } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface Props {
  avoidStairs: boolean;
  onAvoidStairsChange: (v: boolean) => void;
  requireAccessible: boolean;
  onRequireAccessibleChange: (v: boolean) => void;
}

export function RoutePreferences({
  avoidStairs,
  onAvoidStairsChange,
  requireAccessible,
  onRequireAccessibleChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="avoid-stairs"
          checked={avoidStairs}
          onCheckedChange={(c) => onAvoidStairsChange(c === true)}
        />
        <Label htmlFor="avoid-stairs" className="flex cursor-pointer items-center gap-1.5 text-sm">
          <Mountain className="size-3.5 text-brand-subtle" aria-hidden />
          Avoid stairs
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="require-accessible"
          checked={requireAccessible}
          onCheckedChange={(c) => onRequireAccessibleChange(c === true)}
        />
        <Label
          htmlFor="require-accessible"
          className="flex cursor-pointer items-center gap-1.5 text-sm"
        >
          <Accessibility className="size-3.5 text-brand-subtle" aria-hidden />
          Accessible route only
        </Label>
      </div>
    </div>
  );
}
