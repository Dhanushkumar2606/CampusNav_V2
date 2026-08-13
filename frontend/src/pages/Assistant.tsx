import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  MapPin,
  Navigation,
  RotateCcw,
  Search,
  Send,
  Sparkles,
} from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { assistantQuery } from "@/api/assistant";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { prettyLabel } from "@/lib/brand";
import type { AssistantResponseOut } from "@/lib/navigation-types";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: string;
  data?: Record<string, unknown> | null;
  error?: boolean;
}

const SUGGESTED_PROMPTS = [
  "Where is the library?",
  "Navigate to the CSE Block",
  "Find the auditorium",
  "I have a class in the Tech Park in 15 minutes",
];

const MAX_PROMPT_LENGTH = 500;

let nextMessageId = 1;

function MessageBubble({ message }: { message: ChatMessage }) {
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

  const icon = message.error ? (
    <Bot className="size-4 text-brand-danger" aria-hidden />
  ) : (
    <Bot className="size-4 text-brand-cyan" aria-hidden />
  );

  return (
    <div className="flex gap-2.5">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-surface shrink-0",
          message.error ? "text-brand-danger" : "text-brand-cyan",
        )}
        aria-hidden
      >
        {icon}
      </span>
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

function AssistantResultCards({ message }: { message: ChatMessage }) {
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
              <p className="text-xs text-brand-subtle">
                {requireAccessible ? "Accessible · " : ""}
                {mode} route
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate(
                  `/map?destination=${destinationId}&accessible=${requireAccessible}${
                    campusSlug ? `&campus=${campusSlug}` : ""
                  }`,
                )
              }
            >
              <Navigation className="size-3.5 mr-1.5" aria-hidden />
              Navigate
            </Button>
          </div>
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
                <span className="block text-xs capitalize text-brand-subtle">{category}</span>
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

function TypingIndicator() {
  return (
    <div className="flex gap-2.5" aria-label="Assistant is thinking">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-surface text-brand-cyan"
        aria-hidden
      >
        <Bot className="size-4" />
      </span>
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

export function Assistant() {
  const { getToken, status } = useAuth();
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
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const query = raw.trim();
      if (!query || sending || query.length > MAX_PROMPT_LENGTH) return;

      const token = getToken();
      if (!token) return;

      const userMessage: ChatMessage = {
        id: nextMessageId++,
        role: "user",
        text: query,
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setSending(true);

      try {
        const res: AssistantResponseOut = await assistantQuery(token, query);
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId++,
            role: "assistant",
            text: res.text,
            kind: res.kind,
            data: res.data,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId++,
            role: "assistant",
            text:
              err instanceof Error && err.message
                ? `Sorry, I couldn't reach the assistant: ${err.message}`
                : "Sorry, something went wrong.",
            error: true,
          },
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [getToken, sending],
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
        <h1 className="text-lg font-semibold text-brand-text">Campus assistant</h1>
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
              title="Ask anything about campus"
              description="“Where is the CSE department?”, “Find an accessible route to the library”, “What's near the auditorium?” — the assistant answers from real campus data."
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
            Ask the campus assistant
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
            {sending ? "Assistant is responding" : ""}
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
            Rule-based assistant — responds from real campus data without an LLM.
          </p>
        )}
      </form>
    </div>
  );
}