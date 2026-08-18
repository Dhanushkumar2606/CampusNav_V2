/**
 * Assistant page — NOVA, the CampusNav AI assistant. Rule-based intents
 * answered by the backend; renders shared chat UI from features/assistant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Send, Sparkles } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { assistantQuery, SessionExpiredError } from "@/api/assistant";
import { listCampuses } from "@/api/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useLiveLocation } from "@/features/map/useLiveLocation";
import type { AssistantResponseOut } from "@/lib/navigation-types";
import { LAST_CAMPUS_KEY } from "@/features/campus/CampusRouteContext";
import {
  ChatMessage,
  MAX_PROMPT_LENGTH,
  MessageBubble,
  nextChatMessageId,
  SUGGESTED_PROMPTS,
  TypingIndicator,
} from "@/features/assistant/chat";

export function Assistant() {
  const { getToken, status, logout } = useAuth();
  const location = useLiveLocation();
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

  useEffect(() => {
    inputRef.current?.focus();
    // One-shot: if the user is on this page and hasn't denied access, get a
    // fix so "nearest X" queries can use their real position.
    if (location.status === "idle") location.locate();
  }, []);

  // Campus context for NOVA: mirror the map's selection — the last-used
  // campus when it still exists in the catalog, otherwise the featured (or
  // first) campus. Whatever the map used, NOVA resolves places on the same
  // campus. A stale slug is never sent (the backend refuses unknown slugs).
  const [campuses, setCampuses] = useState<{ slug: string; featured: boolean }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    listCampuses()
      .then((cs) => {
        if (!cancelled) setCampuses(cs);
      })
      .catch(() => {
        // Soft default — NOVA still answers without a campus context.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const campusSlug = useMemo(() => {
    if (!campuses || campuses.length === 0) return undefined;
    try {
      const stored = localStorage.getItem(LAST_CAMPUS_KEY);
      if (stored && campuses.some((c) => c.slug === stored)) return stored;
    } catch {
      // ignore storage errors
    }
    const featured = campuses.find((c) => c.featured);
    return featured?.slug ?? campuses[0].slug;
  }, [campuses]);

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
          campusSlug,
          undefined,
          undefined,
          location.coords?.lat,
          location.coords?.lng,
        );
        setMessages((prev) => [
          ...prev,
          {
            id: nextChatMessageId(),
            role: "assistant",
            text: res.text,
            kind: res.kind,
            data: res.data,
          },
        ]);
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          // Session gone (expired or rejected) — clear the stale token so
          // the UI reflects reality; gracefully ask for a fresh login.
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
                  ? `Sorry, I couldn't reach SPIDY: ${err.message}`
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
    [getToken, sending, campusSlug, location.coords?.lat, location.coords?.lng],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const handleReset = () => {
    setMessages([]);
    inputRef.current?.focus();
  };

  const showSuggestions = messages.length === 0 && !sending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-brand-muted px-4 py-3 md:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight text-brand-text">SPIDY</h1>
          <p className="text-xs text-brand-subtle">Campus AI Assistant</p>
        </div>
        <span
          className="flex items-center gap-1.5 rounded-full border border-brand-green/30 bg-brand-green/10 px-2 py-0.5"
          role="status"
        >
          <span className="size-1.5 rounded-full bg-brand-green" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wider text-brand-green">
            {status === "authenticated" ? "Online" : "Signed out"}
          </span>
        </span>
        {messages.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="ml-auto h-8 px-2 text-xs"
            aria-label="Clear conversation"
          >
            <RotateCcw className="size-3.5 mr-1" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6" role="log" aria-live="polite" aria-label="Conversation">
        {showSuggestions ? (
          <div className="flex h-full flex-col items-center justify-center gap-6">
            <EmptyState
              icon={Sparkles}
              title="Hi, I'm SPIDY — your CampusNav AI assistant."
              description="I can help you find buildings, plan routes, discover campus facilities, and answer campus-related questions."
            />
            <div className="flex max-w-xl flex-wrap justify-center gap-2" aria-label="Suggested prompts">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void send(prompt)}
                  className="rounded-full border border-brand-muted bg-brand-surface/70 px-3.5 py-1.5 text-xs text-brand-subtle transition-colors hover:border-brand-cyan/40 hover:text-brand-text"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {sending ? <TypingIndicator /> : null}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-brand-muted p-4 md:px-6">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Ask SPIDY
          </label>
          <input
            ref={inputRef}
            id="assistant-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about buildings, routes, departments…"
            maxLength={MAX_PROMPT_LENGTH}
            disabled={sending}
            className="h-11 flex-1 rounded-lg border border-brand-muted bg-brand-deep/70 px-3.5 text-sm text-brand-text placeholder:text-brand-subtle focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <span className="sr-only" role="status">
            {sending ? "SPIDY is responding" : ""}
          </span>
          <Button type="submit" size="lg" disabled={!input.trim() || sending} aria-label="Send message">
            {sending ? (
              <span className="flex items-center gap-2">
                <span className="size-3 animate-spin rounded-full border-2 border-brand-deep border-t-transparent" aria-hidden />
                <span className="hidden sm:inline">Thinking…</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Send className="size-4" aria-hidden />
                <span className="hidden sm:inline">Send</span>
              </span>
            )}
          </Button>
        </div>
        {status !== "authenticated" ? null : (
          <p className="mx-auto mt-2 max-w-2xl text-[11px] text-brand-subtle">
            SPIDY is CampusNav's rule-based assistant — it answers from real campus data without an LLM.
          </p>
        )}
      </form>
    </div>
  );
}