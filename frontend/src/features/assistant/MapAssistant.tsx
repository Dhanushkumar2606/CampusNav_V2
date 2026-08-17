/**
 * MapAssistant — NOVA chat docked on the map page.
 *
 * A round notch button (rendered in the map's bottom-right control column)
 * toggles a chat panel that hovers over the right side of the map. Route
 * intents ("from main block to the library") are applied to the map
 * immediately — campus, source, destination and constraints are pushed
 * through the route provider's hydrate(), which resolves node ids, loads
 * the campus graph and auto-runs `findRoute`, so the route renders on the
 * map without leaving the chat.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { assistantQuery, SessionExpiredError } from "@/api/assistant";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useCampusRoute } from "@/features/campus/CampusRouteContext";
import { useLiveLocation } from "@/features/map/useLiveLocation";
import type { AssistantResponseOut } from "@/lib/navigation-types";
import { boundsFromNodes } from "@/lib/geo";
import {
  ChatMessage,
  MAX_PROMPT_LENGTH,
  MessageBubble,
  nextChatMessageId,
  SUGGESTED_PROMPTS,
  TypingIndicator,
} from "./chat";

/** Notch that toggles the chat (lives in the map control column) — same
 *  square control style as the rest of the column, with a cyan active
 *  state while the chat is open. */
export function MapAssistantNotch({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <TooltipIconButton
      label={open ? "Close NOVA assistant" : "Open NOVA assistant"}
      onClick={onToggle}
      pressed={open}
      className={
        open
          ? "border border-brand-cyan bg-brand-cyan/20 text-brand-cyan shadow-[0_0_12px_rgba(45,212,191,0.25)]"
          : undefined
      }
    >
      <Sparkles className="size-4 transition-transform duration-300 ease-out group-hover/ctl:rotate-12 group-hover/ctl:scale-110" aria-hidden />
    </TooltipIconButton>
  );
}

/** Build route-provider params from an assistant route/info response. */
function paramsFromResult(
  data: Record<string, unknown> | null | undefined,
): URLSearchParams | null {
  if (!data) return null;
  const destination = data.destination as Record<string, unknown> | undefined;
  const destinationId = typeof destination?.id === "string" ? destination.id : null;
  if (!destinationId) return null;
  const campusSlug =
    typeof destination?.campus_slug === "string"
      ? destination.campus_slug
      : typeof data.campus_slug === "string"
        ? data.campus_slug
        : null;

  const origin = data.origin as Record<string, unknown> | null | undefined;
  const sourceId = origin && typeof origin.id === "string" ? origin.id : null;

  const params = new URLSearchParams();
  if (campusSlug) params.set("campus", campusSlug);
  if (sourceId) params.set("source", sourceId);
  params.set("destination", destinationId);
  if (data.require_accessible) params.set("accessible", "true");
  if (data.mode === "fastest") params.set("mode", "fastest");
  if (data.avoid_stairs) params.set("avoid_stairs", "true");
  return params;
}

export function MapAssistantPanel({ onClose }: { onClose: () => void }) {
  const { getToken, status, logout } = useAuth();
  const location = useLiveLocation();
  const ctx = useCampusRoute();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  // One-shot GPS fix so "nearest X" queries can use the real position.
  useEffect(() => {
    if (location.status === "idle") location.locate();
  }, []);

  // Focus the input the moment the panel opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes the panel (nothing else uses Escape on the map page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When a route lands on the map (from this chat), turn the camera so the
  // navigation is actually in view — otherwise the polyline draws
  // off-screen and it looks like nothing happened.
  const appliedRouteKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const route = ctx.route;
    if (!route || !ctx.graph || !ctx.mapController) return;
    const key = route.steps.map((s) => s.edge_id).join("|");
    if (appliedRouteKeyRef.current === key) return;
    appliedRouteKeyRef.current = key;
    const nodes = route.steps
      .map((s) => ctx.graph?.nodes.find((n) => n.id === s.to_node_id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    const bounds = boundsFromNodes(nodes);
    if (bounds) ctx.mapController.flyToBounds(bounds);
  }, [ctx.route, ctx.graph, ctx.mapController, ctx.route?.steps]);

  const send = useCallback(
    async (raw: string) => {
      const query = raw.trim();
      if (!query || sending || query.length > MAX_PROMPT_LENGTH) return;

      const token = getToken();
      if (!token) return;

      const userMessage: ChatMessage = {
        id: nextChatMessageId(),
        role: "user",
        text: query,
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setSending(true);

      try {
        const res: AssistantResponseOut = await assistantQuery(
          token,
          query,
          // Current campus context (validated against the loaded campus
          // list — a stale URL-pinned slug must not widen/empty NOVA's
          // search, which guards against unknown campus slugs server-side).
          ctx.campusSlug && ctx.campuses.some((c) => c.slug === ctx.campusSlug)
            ? ctx.campusSlug
            : undefined,
          undefined,
          undefined,
          location.coords?.lat,
          location.coords?.lng,
        );
        setMessages((prev) => [
          ...prev,
          { id: nextChatMessageId(), role: "assistant", text: res.text, kind: res.kind, data: res.data },
        ]);
        // Route intents show the navigation on the map right away.
        if (res.kind === "route") {
          const params = paramsFromResult(res.data);
          if (params) ctx.hydrate(params);
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          // The session is gone — drop the stale token so the UI reflects
          // reality and stays secure; ask the user to sign in again.
          logout();
          setMessages((prev) => [
            ...prev,
            { id: nextChatMessageId(), role: "assistant", text: err.message, error: true },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: nextChatMessageId(),
              role: "assistant",
              text:
                err instanceof Error && err.message
                  ? `Sorry, I couldn't reach NOVA: ${err.message}`
                  : "Sorry, something went wrong.",
              error: true,
            },
          ]);
        }
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [getToken, sending, location.coords?.lat, location.coords?.lng, ctx],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const showSuggestions = messages.length === 0 && !sending;

  return (
    <div
      role="dialog"
      aria-label="NOVA — Campus AI Assistant"
      aria-modal="false"
      className="absolute bottom-4 right-3 z-40 flex max-h-[70dvh] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-brand-muted bg-brand-deep/95 shadow-float backdrop-blur md:right-16 md:bottom-4 md:top-3 md:h-[calc(100dvh-4.5rem)] md:max-h-[720px] md:min-h-[420px]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-brand-muted px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-brand-cyan" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-brand-text">NOVA</p>
            <p className="text-[11px] text-brand-subtle">Campus AI Assistant</p>
          </div>
        </div>
        <span
          className="ml-2 flex items-center gap-1.5 rounded-full border border-brand-green/30 bg-brand-green/10 px-2 py-0.5"
          role="status"
        >
          <span className="size-1.5 rounded-full bg-brand-green" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wider text-brand-green">
            Online
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="ml-auto h-8 w-8 px-0"
          aria-label="Close NOVA assistant"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {showSuggestions ? (
          <div className="flex h-full flex-col justify-center gap-4">
            <div>
              <p className="text-sm font-medium text-brand-text">
                Hi, I'm NOVA — your CampusNav AI assistant.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-subtle">
                Ask me for a route — for example “from main block to the library” — and I'll show
                it on the map. I can also find buildings, facilities and campus info.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Suggested prompts">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void send(prompt)}
                  className="rounded-full border border-brand-muted bg-brand-surface/70 px-3 py-1 text-xs text-brand-subtle transition-colors hover:border-brand-cyan/40 hover:text-brand-text"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {sending ? <TypingIndicator /> : null}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-brand-muted p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="map-assistant-input" className="sr-only">
            Ask NOVA
          </label>
          <input
            ref={inputRef}
            id="map-assistant-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. main block to library…"
            maxLength={MAX_PROMPT_LENGTH}
            disabled={sending}
            className="h-10 min-w-0 flex-1 rounded-lg border border-brand-muted bg-brand-surface/60 px-3 text-sm text-brand-text placeholder:text-brand-subtle focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <span className="sr-only" role="status">
            {sending ? "NOVA is responding" : ""}
          </span>
          <Button type="submit" size="icon" disabled={!input.trim() || sending} aria-label="Send message">
            {sending ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-brand-deep border-t-transparent" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
          </Button>
        </div>
        {status !== "authenticated" ? null : (
          <p className="mt-2 text-[10px] text-brand-subtle">
            NOVA answers from real campus data — routes appear on the map automatically.
          </p>
        )}
      </form>
    </div>
  );
}