import { Sparkles } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

/** Assistant — the campus-aware AI panel (Phase 5 builds the chat UI). */
export function Assistant() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4 md:px-6">
        <h1 className="text-lg font-semibold text-brand-text">Campus assistant</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <EmptyState
          icon={Sparkles}
          title="Ask anything about campus"
          description="“Where is the CSE department?”, “Find an accessible route to the library”, “What's near the auditorium?” — the assistant answers from real campus data."
        />
      </div>
    </div>
  );
}
