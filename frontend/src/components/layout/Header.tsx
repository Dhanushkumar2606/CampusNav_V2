import { useNavigate } from "react-router-dom";
import { LogOut, Search } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Shell header — brand mark, campus search (drives /explore), user chip.
 * The search box only owns navigation; result rendering lives on Explore.
 */
export function Header() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(`/explore?q=${encodeURIComponent(q)}`);
      setQuery("");
    }
  };

  const initials = user?.full_name
    ? user.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

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
      </button>

      {/* Campus search */}
      <form onSubmit={onSubmit} role="search" className="ml-auto flex min-w-0 flex-1 justify-end">
        <div className="relative w-full max-w-xs sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-subtle" aria-hidden />
          <Input
            type="search"
            placeholder="Search buildings, departments…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn("h-9 bg-brand-deep/70 pl-9 text-sm", "sm:w-full")}
            aria-label="Search campus"
          />
        </div>
      </form>

      <div className="ml-2 flex items-center gap-2">
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
