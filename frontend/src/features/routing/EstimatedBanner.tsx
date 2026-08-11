/**
 * Top-of-panel banner that surfaces the "estimated edges" caveat from
 * the campus's data_provenance. Important per memory: SRM KTR's topology
 * is a reasonable guess; route styling reflects this with dashed lines.
 */
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function EstimatedBanner() {
  return (
    <Alert className="border-brand-purple/40 bg-brand-purple/10 text-brand-text">
      <TriangleAlert className="size-4 text-brand-purple" />
      <AlertTitle className="text-brand-text">Estimated edges</AlertTitle>
      <AlertDescription className="text-brand-subtle">
        Edge distances and topology for this campus are best-effort
        estimates, not surveyed footpaths. Routes will look reasonable
        but may not match real walking paths.
      </AlertDescription>
    </Alert>
  );
}
