/**
 * Top-of-panel banner that surfaces the two data caveats from the
 * campus's data_provenance:
 *   1. Edge distances/topology are estimates, not surveyed footpaths.
 *   2. Accessibility flags are NOT verified — nothing is claimed to be
 *      wheelchair-safe without surveyed data.
 */
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function EstimatedBanner() {
  return (
    <Alert className="border-brand-amber/40 bg-brand-amber/10 text-brand-text">
      <TriangleAlert className="size-4 text-brand-amber" />
      <AlertTitle className="text-brand-text">Unverified campus data</AlertTitle>
      <AlertDescription className="text-brand-subtle">
        Distances are estimates, not surveyed footpaths. Accessibility
        flags are <strong className="text-brand-text">not verified</strong> —
        routes marked accessible aren't confirmed wheelchair-safe.
      </AlertDescription>
    </Alert>
  );
}
