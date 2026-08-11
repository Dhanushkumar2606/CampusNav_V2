import { useSearchParams } from "react-router-dom";
import { Compass, Search } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

/** Explore — campus discovery. Search results land here (Phase 4 wires
 *  the live /search API into this page). */
export function Explore() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <h1 className="text-lg font-semibold text-brand-text">Explore campus</h1>
      {q ? (
        <p className="mt-1 text-sm text-brand-subtle">
          Results for “<span className="text-brand-cyan">{q}</span>”
        </p>
      ) : null}

      <div className="mt-6">
        {q ? (
          <EmptyState
            icon={Search}
            title="Search is coming online"
            description="Campus search is being wired to the live API — buildings, departments, and places will appear here."
          />
        ) : (
          <EmptyState
            icon={Compass}
            title="Discover the campus"
            description="Use the search bar above, or pick a category to explore buildings, food, transport and more."
          />
        )}
      </div>
    </div>
  );
}
