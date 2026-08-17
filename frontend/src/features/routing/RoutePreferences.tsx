/**
 * Route preference controls: mode (shortest/fastest), stairs avoidance,
 * and the accessibility toggle.
 */
import { Accessibility, Footprints, Mountain, Timer } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { RouteMode } from "@/lib/navigation-types";
import { cn } from "@/lib/utils";

interface Props {
  mode: RouteMode;
  onModeChange: (m: RouteMode) => void;
  avoidStairs: boolean;
  onAvoidStairsChange: (v: boolean) => void;
  requireAccessible: boolean;
  onRequireAccessibleChange: (v: boolean) => void;
}

const MODES: { value: RouteMode; label: string; icon: typeof Timer; hint: string }[] = [
  { value: "shortest", label: "Shortest", icon: Footprints, hint: "Least distance" },
  { value: "fastest", label: "Fastest", icon: Timer, hint: "Least walk time" },
];

export function RoutePreferences({
  mode,
  onModeChange,
  avoidStairs,
  onAvoidStairsChange,
  requireAccessible,
  onRequireAccessibleChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {MODES.map(({ value, label, icon: Icon, hint }) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            aria-pressed={mode === value}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
              mode === value
                ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-text"
                : "border-brand-muted bg-brand-surface text-brand-subtle hover:border-brand-muted/80",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Icon className="size-3.5" aria-hidden />
              {label}
            </span>
            <span className="text-[10px] text-brand-subtle">{hint}</span>
          </button>
        ))}
      </div>

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
