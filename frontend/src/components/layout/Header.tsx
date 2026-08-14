import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Compass, DoorOpen, LogOut, MapPin, Search, SearchX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PremiumBadge } from "@/components/ui/premium-badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { searchCampus } from "@/api/search";
import { prettyLabel } from "@/lib/brand";
import type { SearchResult } from "@/lib/navigation-types";

const TYPE_ICONS: Record<SearchResult["type"], React.ComponentType<{ className?: string }>> = {
  building: Building2,
  node: MapPin,
  poi: Compass,
  room: DoorOpen,
};

/**
 * Shell header — brand mark, campus search with live dropdown results,
 * user chip. Enter navigates to Explore; clicking a result deep-links to
 * the map with that place as the route destination.
 */
export function Header() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const campusSlug = params.get("campus") ?? undefined;

  // Debounced live search for the dropdown.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSelectedIndex(-1);
      return;
    }
    setSearching(true);
    setError(false);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchCampus(q, campusSlug, 5);
        setResults(data);
        setSearching(false);
        setSelectedIndex(-1);
      } catch {
        setError(true);
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, campusSlug]);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const goToResult = (result: SearchResult) => {
    const campus = result.campus_slug ? `&campus=${result.campus_slug}` : "";
    const dest = result.slug ?? result.id;
    if (result.type === "building" || result.type === "node" || result.type === "room") {
      navigate(`/map?destination=${encodeURIComponent(dest)}${campus}`);
    } else {
      navigate(`/map?campus=${result.campus_slug}`);
    }
    setOpen(false);
    setQuery("");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/explore?q=${encodeURIComponent(q)}`);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      goToResult(results[selectedIndex]);
    }
  };

  const initials = user?.full_name
    ? user.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const showDropdown = open && query.trim().length >= 2;

  return (
    <header className="z-40 flex h-14 shrink-0 items-center gap-3 border-b border-brand-muted bg-brand-navy/70 px-4 backdrop-blur">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex items-center gap-2.5"
        aria-label="CampusNav home"
      >
        <span className="size-2.5 rounded-full bg-brand-green shadow-glow" aria-hidden />
        <span className="text-sm font-semibold tracking-wide text-brand-text">CampusNav</span>
        <PremiumBadge />
      </button>

      {/* Campus search with live results */}
      <form onSubmit={onSubmit} role="search" className="ml-auto flex min-w-0 flex-1 justify-end">
        <div ref={dropdownRef} className="relative w-full max-w-xs sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-subtle" aria-hidden />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search buildings, departments…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn("h-9 bg-brand-deep/70 pl-9 text-sm", "sm:w-full")}
            aria-label="Search campus"
            aria-expanded={showDropdown}
          />
          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-brand-muted bg-brand-deep shadow-xl">
              {searching ? (
                <p className="px-3 py-2.5 text-xs text-brand-subtle">Searching…</p>
              ) : error ? (
                <p className="px-3 py-2.5 text-xs text-brand-danger">Search unavailable.</p>
              ) : results.length === 0 ? (
                <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-brand-subtle">
                  <SearchX className="size-3.5" aria-hidden /> No matches for “{query.trim()}”
                </p>
              ) : (
                <ul role="listbox" aria-label="Search results" className="max-h-72 overflow-y-auto py-1">
                  {results.map((result, index) => {
                    const Icon = TYPE_ICONS[result.type] ?? MapPin;
                    return (
                      <li key={result.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === selectedIndex}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onClick={() => goToResult(result)}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                            index === selectedIndex
                              ? "bg-brand-cyan/10 text-brand-text"
                              : "text-brand-subtle hover:bg-brand-surface/60",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-brand-cyan" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{prettyLabel(result.label)}</span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-brand-subtle/70">
                            {result.category}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </form>

      <div className="ml-2 flex items-center gap-2">
        <ThemeToggle />
        {status === "authenticated" && user ? (
          <div className="hidden items-center gap-2 sm:flex">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-surface text-xs font-semibold text-brand-cyan" aria-hidden>
              {initials}
            </span>
            <span className="max-w-[140px] truncate text-xs text-brand-subtle">{user.email}</span>
          </div>
        ) : null}
        {status === "authenticated" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logout();
              navigate("/", { replace: true });
            }}
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}