/**
 * SearchableSelect — a dependency-free combobox for option lists too long
 * to scan (campus nodes, campuses). Behaves like the shadcn Select trigger
 * (same token styles) but adds a keyboard-friendly search filter, arrow-key
 * navigation, Enter to pick, Escape to dismiss and click-outside close.
 *
 * The open panel renders through a portal anchored to the trigger (fixed
 * positioning), so it can never be clipped by an `overflow-hidden` panel,
 * a scrolling route-planner shell or a bottom sheet, and it participates
 * in the app's layer scale at z-[60] — above panels (20), map controls
 * (30) and sheets (50), below toasts (70). It auto-flips upward when it
 * would overflow the viewport bottom, and re-anchors on scroll/resize.
 *
 * Themed entirely via CSS variables (popover/card tokens) so it flips with
 * the app theme. `options` are grouped by the optional `group` field, and
 * label matches are highlighted in the search results.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  /** Searchable plain text (also rendered, with matches highlighted). */
  label: string;
  /** Optional secondary line under the label. */
  caption?: string;
  /** Small uppercase tag on the right (e.g. "building"). */
  badge?: string;
  /** Optional group header label — groups sort by first appearance. */
  group?: string;
}

interface Props {
  options: SearchableOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  id?: string;
  /** Renders a clear (×) affordance when a value is selected. */
  clearable?: boolean;
  triggerClassName?: string;
  panelClassName?: string;
}

/** Vertical gap between the trigger and the anchored panel, and the viewport
 *  margin the panel must never cross. */
const ANCHOR_GAP = 6;
const VIEWPORT_MARGIN = 8;
const PANEL_MAX_H = 352; // 22rem
const PANEL_MIN_W = 224; // keep the list usable on narrow triggers

export function highlightMatches(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-brand-cyan/25 text-brand-cyan">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

interface PanelPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  disabled,
  id,
  clearable,
  triggerClassName,
  panelClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return out;
  }, [options, query]);

  const groups = useMemo(() => {
    const out: { name: string; items: SearchableOption[] }[] = [];
    for (const o of filtered) {
      const g = o.group ?? "";
      const last = out[out.length - 1];
      if (last && last.name === g) last.items.push(o);
      else out.push({ name: g, items: [o] });
    }
    return out;
  }, [filtered]);

  const flatItems = useMemo(() => {
    const out: { group: string; option: SearchableOption }[] = [];
    for (const g of groups) {
      for (const o of g.items) out.push({ group: g.name, option: o });
    }
    return out;
  }, [groups]);

  const closePanel = useCallback(() => {
    setOpen(false);
    setQuery("");
    // Return focus to the trigger so the keyboard user stays on the control.
    window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  /** Anchor the panel to the trigger's current rect, flipping above when it
   *  would overflow the bottom of the viewport. */
  const measurePosition = useCallback((): PanelPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const maxHeight = Math.min(PANEL_MAX_H, vh - 2 * VIEWPORT_MARGIN - ANCHOR_GAP);
    const width = Math.min(Math.max(rect.width, PANEL_MIN_W), vw - 2 * VIEWPORT_MARGIN);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, vw - width - VIEWPORT_MARGIN));

    // The panel height is bounded by maxHeight, so overflow can be decided
    // before paint — no flicker from a two-pass flip.
    const panelH = panelRef.current
      ? Math.min(panelRef.current.offsetHeight, maxHeight)
      : maxHeight;
    const below = rect.bottom + ANCHOR_GAP;
    const above = rect.top - ANCHOR_GAP - panelH;
    const fitsBelow = below + panelH <= vh - VIEWPORT_MARGIN;
    const fitsAbove = above >= VIEWPORT_MARGIN;
    if (fitsBelow) return { top: below, left, width, maxHeight };
    if (fitsAbove) return { top: above, left, width, maxHeight };
    // Neither side fits fully (tiny viewport / trigger at the very bottom):
    // clamp the panel height to the larger usable side instead of overflowing.
    const spaceBelow = vh - VIEWPORT_MARGIN - below;
    const spaceAbove = rect.top - VIEWPORT_MARGIN - ANCHOR_GAP;
    const useAbove = spaceAbove > spaceBelow;
    return {
      top: useAbove ? Math.max(VIEWPORT_MARGIN, above) : below,
      left,
      width,
      maxHeight: Math.min(maxHeight, Math.max(8, useAbove ? spaceAbove : spaceBelow)),
    };
  }, []);

  // Open: measure once before paint (no flicker), then keep the anchor in
  // sync while the panel is up — scrolls (capture phase catches the inner
  // panel scroller too) and resizes move the trigger under the panel.
  useLayoutEffect(() => {
    if (!open) return;
    setPosition(measurePosition());
    // The trigger's rect can still be animating in (panel slide-ins, sheet
    // transitions) — re-measure on the next frame so the first paint lands
    // in the right spot instead of a stale pre-animation rect.
    const raf = requestAnimationFrame(() => setPosition(measurePosition()));
    return () => cancelAnimationFrame(raf);
  }, [open, measurePosition]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => setPosition(measurePosition());
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("orientationchange", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("orientationchange", reposition);
    };
  }, [open, measurePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideRoot = rootRef.current?.contains(target) ?? false;
      const insidePanel = panelRef.current?.contains(target) ?? false;
      if (!insideRoot && !insidePanel) closePanel();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // stopImmediatePropagation: a bottom-sheet keydown handler must not
      // also dismiss the sheet when this dropdown closes.
      e.stopImmediatePropagation();
      closePanel();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closePanel]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(-1);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-searchable-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const pick = (opt: SearchableOption) => {
    onValueChange(opt.value);
    closePanel();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    }
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flatItems.length === 0 ? -1 : (i + 1) % flatItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        flatItems.length === 0 ? -1 : i <= 0 ? flatItems.length - 1 : i - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) pick(item.option);
    }
  };

  const panel = open && position ? (
    <div
      ref={panelRef}
      role="listbox"
      aria-label={placeholder}
      data-dropdown-open="true"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
      className={cn(
        // Layer scale: 60 = dropdown/popover (above sheets at 50, below
        // toasts at 70). Portaled to body — never clipped by panels.
        // Flex column: the search row stays fixed and the option list is
        // the flex-1 min-h-0 scroll region inside the capped maxHeight.
        "fixed z-[60] flex max-h-full flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-float backdrop-blur-xl animate-in fade-in-0 zoom-in-95",
        position.top > (position.maxHeight + ANCHOR_GAP) ? "origin-bottom" : "origin-top",
        panelClassName,
      )}
      onKeyDown={onPanelKeyDown}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          placeholder={searchPlaceholder}
          aria-label="Search options"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
          {flatItems.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No matches
            </p>
          ) : (
            <div>
              {groups.map((g) => (
                <div key={g.name || "__ungrouped"}>
                  {g.name ? (
                    <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground first:pt-1">
                      {g.name}
                    </p>
                  ) : null}
                  {g.items.map((option) => {
                    const flatIndex = flatItems.findIndex((f) => f.option === option);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        data-searchable-index={flatIndex}
                        role="option"
                        aria-selected={option.value === value}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => pick(option)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md border border-transparent bg-brand-surface/80 px-2.5 py-2 text-left text-sm text-brand-text outline-none transition-colors",
                          flatIndex === activeIndex
                            ? "border-brand-cyan/60 bg-brand-cyan/25"
                            : "hover:border-brand-muted hover:bg-brand-surface",
                          "aria-selected:border-brand-cyan/40 aria-selected:bg-brand-cyan/15",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {highlightMatches(option.label, query)}
                          </span>
                          {option.caption ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {option.caption}
                            </span>
                          ) : null}
                        </span>
                        {option.badge ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider text-brand-cyan">
                            {option.badge}
                          </span>
                        ) : null}
                        {option.value === value ? (
                          <Check className="h-4 w-4 shrink-0 text-brand-cyan" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2.5 whitespace-nowrap rounded-lg border border-brand-muted bg-brand-surface px-4 text-left text-sm shadow-sm transition-colors",
            "hover:border-brand-cyan/40 hover:bg-brand-surface/90",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            open && "border-brand-cyan/70",
            triggerClassName,
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              selected ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {selected ? selected.label : placeholder}
          </span>
          {selected && clearable ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onValueChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  onValueChange("");
                }
              }}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-4 w-4" />
            </span>
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </button>
      </div>

      {typeof document !== "undefined" ? createPortal(panel, document.body) : panel}
    </div>
  );
}