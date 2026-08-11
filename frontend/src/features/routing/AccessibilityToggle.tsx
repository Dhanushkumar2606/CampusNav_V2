/**
 * Checkbox for `require_accessible`. When the dataset has no surveyed
 * accessibility data, this toggle has no visible effect — but it's
 * wired correctly so Phase 3's agent can pass the value through.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function AccessibilityToggle({ checked, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="require-accessible"
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <Label htmlFor="require-accessible" className="cursor-pointer text-sm">
        Prefer accessible route
      </Label>
    </div>
  );
}
