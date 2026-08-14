/**
 * Shared NOVA chat UI — message bubbles, result cards and typography used
 * by both the standalone Assistant page and the floating map assistant.
 */
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Building2,
  Clock,
  MapPin,
  Navigation,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { prettyLabel } from "@/lib/brand";
import { formatDistance, formatMinutes } from "@/lib/format";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: string;
  data?: Record<string, unknown> | null;
  error?: boolean;
}

export const SUGGESTED_PROMPTS = [
  "Where is the library?",
  "Navigate to the CSE Block",
  "Find the auditorium",
  "I have a class in the Tech Park in 15 minutes",
];

export const MAX_PROMPT_LENGTH = 500;

let nextMessageId = 1;
export function nextChatMessageId(): number {
  return nextMessageId++;
}

export function NovaAvatar({ error = false, className }: { error?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-surface",
        error ? "text-brand-danger" : "text-brand-cyan",
        className,
      )}
      aria-hidden
    >
      <Bot className="size-4" />
    </span>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-green/20 px-4 py-2.5 border border-brand-green/25">
          <p className="text-sm text-brand-text whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <NovaAvatar error={message.error} />
      <div className="max-w-[85%] space-y-2.5">
        <p
          className={cn(
            "rounded-2xl rounded-tl-sm border px-4 py-2.5 text-sm whitespace-pre-wrap",
            message.error
              ? "border-brand-danger/30 bg-brand-danger/10 text-brand-text"
              : "border-brand-muted bg-brand-surface/80 text-brand-text",
          )}
        >
          {message.text}
        </p>
        <AssistantResultCards message={message} />
      </div>
    </div>
  );
}

export function AssistantResultCards({ message }: { message: ChatMessage }) {
  const navigate = useNavigate();
  const data = message.data;
  if (!data) return null;

  if (message.kind === "route" && data.destination) {
    const destination = data.destination as Record<string, unknown>;
    const destinationId = typeof destination.id === "string" ? destination.id : null;
    const campusSlug = typeof destination.campus_slug === "string" ? destination.campus_slug : undefined;
    const requireAccessible = Boolean(data.require_accessible);
    const mode = data.mode === "fastest" ? "fastest" : "shortest";
    if (!destinationId) return null;

    const origin = data.origin as Record<string, unknown> | null | undefined;
    const sourceId =
      origin && typeof origin.id === "string" ? origin.id : null;
    const distanceM =
      typeof data.total_distance_m === "number" ? data.total_distance_m : null;
    const etaMin =
      typeof data.estimated_walk_time_min === "number" ? data.estimated_walk_time_min : null;
    const stepCount = typeof data.step_count === "number" ? data.step_count : null;
    const deadline =
      typeof data.time_constraint_min === "number" ? data.time_constraint_min : null;

    const mapQuery = new URLSearchParams();
    if (sourceId) mapQuery.set("source", sourceId);
    mapQuery.set("destination", destinationId);
    if (campusSlug) mapQuery.set("campus", campusSlug);
    mapQuery.set("accessible", String(requireAccessible));
    if (mode === "fastest") mapQuery.set("mode", "fastest");

    return (
      <Card className="border-brand-cyan/30 bg-brand-navy/70">
        <CardContent className="p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
              <MapPin className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-brand-text">
                {prettyLabel(String(destination.label ?? destination.name ?? ""))}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-brand-subtle">
                <span>
                  {requireAccessible ? "Accessible · " : ""}
                  {mode} route
                </span>
                {distanceM !== null ? <span>· {formatDistance(distanceM)}</span> : null}
                {etaMin !== null ? (
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-3" aria-hidden />
                    {formatMinutes(etaMin)}
                  </span>
                ) : null}
                {stepCount !== null ? <span>· {stepCount} steps</span> : null}
                {deadline !== null ? (
                  <span className="text-brand-amber">· {formatMinutes(deadline)} to get there</span>
                ) : null}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/map?${mapQuery.toString()}`)}
            >
              <Navigation className="size-3.5 mr-1.5" aria-hidden />
              Navigate
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (message.kind === "info" && data.building_detail) {
    const b = data.building_detail as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : null;
    const entrances = Array.isArray(b.entrances) ? (b.entrances as Record<string, unknown>[]) : [];
    const floors = Array.isArray(b.floors) ? (b.floors as Record<string, unknown>[]) : [];
    const label = prettyLabel(String(b.name ?? b.label ?? ""));
    if (!id) return null;

    return (
      <Card className="border-brand-cyan/30 bg-brand-navy/70">
        <CardContent className="space-y-2 p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
              <Building2 className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-brand-text">{label}</p>
              <p className="text-xs text-brand-subtle">
                {typeof b.num_floors === "number" ? `${b.num_floors} floors` : ""}
                {b.has_elevator ? " · elevator" : ""}
                {b.is_accessible ? " · accessible" : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate(`/map?destination=${id}`)}>
              <Navigation className="size-3.5 mr-1.5" aria-hidden />
              Navigate
            </Button>
          </div>
          {entrances.length > 0 ? (
            <div className="border-t border-brand-muted/60 pt-2">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-brand-subtle">
                Entrances
              </p>
              <div className="flex flex-wrap gap-1.5">
                {entrances.map((e) => {
                  const eid = typeof e.id === "string" ? e.id : null;
                  const ename = prettyLabel(String(e.label ?? ""));
                  return (
                    <button
                      key={eid ?? ename}
                      type="button"
                      disabled={!eid}
                      onClick={() => eid && navigate(`/map?destination=${eid}`)}
                      className="rounded-full border border-brand-muted bg-brand-surface/70 px-2.5 py-1 text-xs text-brand-text transition-colors hover:border-brand-cyan/40"
                    >
                      {ename}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {floors.length > 0 ? (
            <p className="text-xs text-brand-subtle">
              Floors:{" "}
              {floors
                .map((f) => String(f.label ?? f.level ?? ""))
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (message.kind === "search" && Array.isArray(data.results)) {
    const results = data.results as Record<string, unknown>[];
    if (results.length === 0) return null;
    return (
      <div className="space-y-1.5">
        {results.slice(0, 5).map((r, i) => {
          const id = typeof r.id === "string" ? r.id : null;
          const label = prettyLabel(String(r.label ?? ""));
          const category = String(r.category ?? "");
          const distanceM = typeof r.distance_m === "number" ? r.distance_m : null;
          if (!id) return null;
          return (
            <button
              key={`${id}-${i}`}
              type="button"
              onClick={() => navigate(`/map?destination=${id}`)}
              className="flex w-full items-center gap-2 rounded-lg border border-brand-muted bg-brand-navy/60 px-3 py-2 text-left transition-colors hover:border-brand-cyan/40 hover:bg-brand-navy/90"
              aria-label={`Navigate to ${label}`}
            >
              <Search className="size-3.5 shrink-0 text-brand-cyan" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-brand-text">{label}</span>
                <span className="block text-xs capitalize text-brand-subtle">
                  {category}
                  {distanceM !== null ? ` · ${formatDistance(distanceM)} from you` : ""}
                </span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-brand-subtle" aria-hidden />
            </button>
          );
        })}
      </div>
    );
  }

  return null;
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2.5" aria-label="NOVA is thinking">
      <NovaAvatar />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-brand-muted bg-brand-surface/80 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-brand-cyan"
            style={{ animationDelay: `${i * 120}ms` }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}