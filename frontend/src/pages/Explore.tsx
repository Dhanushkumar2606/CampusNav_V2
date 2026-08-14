import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Compass,
  Heart,
  Home,
  MapPin,
  Search,
  X,
} from "lucide-react";

import { StateWrapper } from "@/components/ui/state-wrapper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { prettyLabel } from "@/lib/brand";
import { searchCampus, addFavorite, getCampusCategories } from "@/api/search";
import { listCampuses } from "@/api/navigation";
import { CampusHub } from "@/features/explore/CampusHub";
import type { SearchResult, CategoryOut } from "@/lib/navigation-types";

const RECENT_SEARCHES_KEY = "campusnav:recent-searches";
const MAX_RECENT = 8;

const STATIC_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "building", label: "Buildings" },
  { key: "landmark", label: "Landmarks" },
  { key: "transit", label: "Transit" },
  { key: "entrance", label: "Entrances" },
] as const;

// API category labels (plural, backend-driven) -> chip keys (singular, stable).
const API_KEY_TO_STATIC: Record<string, string> = {
  landmarks: "landmark",
  transport: "transit",
};

export function Explore() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const query = params.get("q")?.trim() ?? "";
  const initialCategory = (params.get("category") as typeof STATIC_CATEGORIES[number]["key"]) ?? "all";

  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [categoryCounts, setCategoryCounts] = useState<CategoryOut[] | null>(null);
  const [category, setCategory] = useState<string>(initialCategory);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "empty">("idle");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showBuildingDetail, setShowBuildingDetail] = useState<SearchResult | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recent searches on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setRecentSearches(parsed.slice(0, MAX_RECENT));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Real category counts for the chips (Phase F): uses the first campus as
  // the default scope; falls back to label-only chips when unavailable.
  useEffect(() => {
    let cancelled = false;
    listCampuses()
      .then((campuses) => {
        const first = campuses[0];
        if (cancelled || !first) return;
        return getCampusCategories(first.slug).then((cats) => {
          if (!cancelled) setCategoryCounts(cats);
        });
      })
      .catch(() => {
        // chips stay label-only
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // API labels are merged onto the stable static keys when they overlap.
  const categories: { key: string; label: string; count?: number }[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of categoryCounts ?? []) {
      const key = API_KEY_TO_STATIC[c.key] ?? c.key;
      if (key === "all") continue;
      counts.set(key, (counts.get(key) ?? 0) + c.count);
    }
    return [
      { key: "all", label: "All" },
      ...STATIC_CATEGORIES.filter((c) => c.key !== "all").map((c) => ({
        key: c.key,
        label: c.label,
        count: counts.get(c.key),
      })),
      ...[...counts.entries()]
        .filter(([key]) => !STATIC_CATEGORIES.some((c) => c.key === key))
        .map(([key, count]) => ({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          count,
        })),
    ];
  }, [categoryCounts]);

  // Debounced search effect
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setStatus(query ? "empty" : "idle");
      setSelectedIndex(-1);
      return;
    }

    setStatus("loading");
    setSelectedIndex(-1);
    const controller = new AbortController();

    searchCampus(debouncedQuery, undefined, 20)
      .then((data) => {
        if (controller.signal.aborted) return;
        const filtered = category === "all"
          ? data
          : data.filter((r) => r.type === category || r.category === category);
        setResults(filtered);
        setStatus(filtered.length > 0 ? "success" : "empty");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("Search error:", err);
        setStatus("error");
      });

    return () => controller.abort();
  }, [debouncedQuery, category, retryTick]);

  // Update URL when query or category changes (but not on initial load)
  useEffect(() => {
    if (debouncedQuery !== query || category !== initialCategory) {
      const newParams = new URLSearchParams(params);
      if (debouncedQuery) newParams.set("q", debouncedQuery);
      else newParams.delete("q");
      if (category !== "all") newParams.set("category", category);
      else newParams.delete("category");
      navigate(`/explore?${newParams.toString()}`, { replace: true });
    }
  }, [debouncedQuery, category, query, initialCategory, params, navigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        handleResultAction(results[selectedIndex], "navigate");
      } else if (e.key === "Escape") {
        setSelectedIndex(-1);
        inputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex]);

  const addToRecent = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter((r) => r !== trimmed);
      const updated = [trimmed, ...filtered].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch {
        // ignore quota errors
      }
      return updated;
    });
  }, []);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const q = inputRef.current?.value.trim() ?? "";
    if (q) {
      addToRecent(q);
      setDebouncedQuery(q);
      setSelectedIndex(-1);
    }
  }, [addToRecent]);

  const handleQuickSearch = useCallback((q: string) => {
    addToRecent(q);
    setDebouncedQuery(q);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }, [addToRecent]);

  const clearRecent = useCallback(() => {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  }, []);

  const handleResultAction = useCallback(
    async (result: SearchResult, action: "navigate" | "view" | "save") => {
      if (action === "navigate") {
        // Navigate to map view with this building as destination
        navigate(`/map?destination=${result.id}&campus=${result.campus_slug}`);
      } else if (action === "view") {
        setShowBuildingDetail(result);
      } else if (action === "save") {
        const token = getToken();
        if (!token) {
          toast({
            title: "Sign in to save places",
            description: "Favorites are tied to your account.",
            tone: "info",
          });
          return;
        }
        try {
          await addFavorite(token, {
            target_type: result.type === "building" ? "building" : "node",
            target_id: result.id,
            note: null,
          });
          toast({ title: "Saved", description: prettyLabel(result.label), tone: "success" });
        } catch (err) {
          toast({
            title: "Could not save",
            description: err instanceof Error ? err.message : "Please try again.",
            tone: "error",
          });
        }
      }
    },
    [getToken, navigate, toast],
  );

  const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    building: Building2,
    landmark: MapPin,
    transit: Compass,
    entrance: Home,
    poi: MapPin,
  };

  const DetailIcon = showBuildingDetail ? categoryIcons[showBuildingDetail.category] ?? MapPin : MapPin;

  return (
    <div className="h-full flex flex-col">
      {/* Header with search */}
      <div className="shrink-0 p-4 md:p-6">
        <form onSubmit={handleSearch} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-subtle" aria-hidden />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search buildings, departments, places…"
            value={debouncedQuery}
            onChange={(e) => setDebouncedQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-10 text-base bg-brand-deep/70"
            autoFocus
          />
        </form>

        {/* Category chips */}
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Search categories">
          {categories.map((cat) => (
            <Chip
              key={cat.key}
              role="tab"
              aria-selected={category === cat.key}
              onClick={() => setCategory(cat.key)}
              className={cn(
                "transition-colors",
                category === cat.key
                  ? "bg-brand-cyan text-brand-deep"
                  : "bg-brand-surface hover:bg-brand-muted"
              )}
            >
              {cat.label}
              {typeof cat.count === "number" ? (
                <span
                  className={cn(
                    "ml-1 rounded-full px-1.5 text-[10px] font-semibold",
                    category === cat.key ? "bg-brand-deep/20 text-brand-deep" : "bg-brand-muted text-brand-subtle"
                  )}
                >
                  {cat.count}
                </span>
              ) : null}
            </Chip>
          ))}
        </div>

        {/* Recent searches */}
        {recentSearches.length > 0 && debouncedQuery === "" && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-brand-subtle uppercase tracking-wider">
                Recent searches
              </span>
              <Button variant="ghost" size="sm" onClick={clearRecent} className="h-6 px-2 text-xs">
                Clear
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((q) => (
                <Chip
                  key={q}
                  onClick={() => handleQuickSearch(q)}
                  className="bg-brand-surface hover:bg-brand-muted cursor-pointer"
                >
                  {q}
                  <X className="size-3 ml-1 -mr-1" onClick={(e) => {
                    e.stopPropagation();
                    setRecentSearches((prev) => prev.filter((r) => r !== q));
                  }} aria-label={`Remove ${q}`} />
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-0 md:px-4 md:pb-6">
        {debouncedQuery === "" ? (
          <CampusHub onNavigate={(slug) => navigate(`/map?campus=${slug}`)} />
        ) : (
        <StateWrapper
          status={status === "loading" ? "loading" : status === "error" ? "error" : status === "empty" ? "success" : "success"}
          loadingMessage="Searching…"
          errorMessage="Could not load results. Please try again."
          emptyMessage={debouncedQuery ? `No results for “${debouncedQuery}”` : "Start typing to search the campus"}
          onRetry={() => setRetryTick((t) => t + 1)}
          skeleton={{ rows: 4, className: "h-20" }}
        >
          {status === "success" && results.length > 0 && (
            <div className="space-y-3" role="listbox" aria-label="Search results">
              {results.map((result, index) => {
                const Icon = categoryIcons[result.category] ?? MapPin;
                const isSelected = index === selectedIndex;
                return (
                  <Card
                    key={result.id}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "cursor-pointer transition-all",
                      isSelected
                        ? "border-brand-cyan/60 bg-brand-cyan/10 shadow-lg"
                        : "border-brand-muted bg-brand-navy/60 hover:bg-brand-navy/80"
                    )}
                    onClick={() => handleResultAction(result, "navigate")}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "flex size-10 items-center justify-center rounded-lg shrink-0",
                          result.type === "building" && "bg-brand-green/20 text-brand-green",
                          result.type === "node" && "bg-brand-cyan/20 text-brand-cyan",
                          result.type === "poi" && "bg-brand-purple/20 text-brand-purple"
                        )}>
                          <Icon className="size-5" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-brand-text truncate">
                            {prettyLabel(result.label)}
                          </h3>
                          <p className="text-xs text-brand-subtle capitalize">{result.category}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResultAction(result, "view");
                            }}
                            aria-label={`View ${prettyLabel(result.label)}`}
                          >
                            <ArrowRight className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResultAction(result, "save");
                            }}
                            aria-label={`Save ${prettyLabel(result.label)}`}
                          >
                            <Heart className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    {result.subtitle && (
                      <CardContent className="pt-0">
                        <p className="text-xs text-brand-subtle">{result.subtitle}</p>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </StateWrapper>
        )}
      </div>

      {/* Building Detail Bottom Sheet */}
      <BottomSheet
        open={!!showBuildingDetail}
        onClose={() => setShowBuildingDetail(null)}
        title={showBuildingDetail ? prettyLabel(showBuildingDetail.label) : undefined}
      >
        {showBuildingDetail && (
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex size-12 items-center justify-center rounded-xl",
                showBuildingDetail.type === "building" && "bg-brand-green/20 text-brand-green",
                showBuildingDetail.type === "node" && "bg-brand-cyan/20 text-brand-cyan",
                showBuildingDetail.type === "poi" && "bg-brand-purple/20 text-brand-purple"
              )}>
                <DetailIcon className="size-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-brand-text truncate">
                  {prettyLabel(showBuildingDetail.label)}
                </h3>
                <p className="text-sm text-brand-subtle capitalize">{showBuildingDetail.category}</p>
              </div>
            </div>
            <Separator />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => handleResultAction(showBuildingDetail, "navigate")}>
                <MapPin className="size-4 mr-2" />
                Navigate
              </Button>
              <Button variant="default" className="flex-1" onClick={() => handleResultAction(showBuildingDetail, "save")}>
                <Heart className="size-4 mr-2" />
                Save
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}