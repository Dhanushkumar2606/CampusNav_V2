import { isPremium } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PremiumBadge() {
  if (!isPremium) return null;
  return (
    <Badge variant="secondary" className={cn("bg-brand-amber text-brand-deep")}>
      Premium
    </Badge>
  );
}