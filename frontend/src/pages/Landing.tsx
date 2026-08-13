import { useNavigate } from "react-router-dom";
import { LogIn, Map as MapIcon } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";

export function Landing() {
  const navigate = useNavigate();
  const { status } = useAuth();

  const onOpenMap = () => navigate("/map");
  const onSignIn = () => navigate("/login");

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Decorative neon stripe */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-72 opacity-50"
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16">
        <header className="flex items-center gap-3">
          <div className="size-2.5 rounded-full bg-brand-green shadow-[0_0_12px_2px_rgba(16,185,129,0.6)]" />
          <span className="text-sm uppercase tracking-[0.2em] text-brand-subtle">
            CampusNav · v1.0.0-premium
          </span>
        </header>

        <section className="mt-16 flex-1">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            Say where you're headed.{" "}
            <span className="bg-gradient-to-r from-brand-green via-brand-cyan to-brand-purple bg-clip-text text-transparent">
              We'll handle the map.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-brand-subtle">
            CampusNav V2 is an intent-based campus navigator. Tell the
            assistant where you need to go, or pick your starting point and
            destination — the A* router plans the shortest or fastest walking
            path on the real campus graph, with honest accessibility.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="animate-pulse-glow"
              onClick={onOpenMap}
              disabled={status === "loading"}
            >
              <MapIcon className="size-4" />
              Open the map
            </Button>
            {status !== "authenticated" ? (
              <Button variant="outline" size="lg" onClick={onSignIn}>
                <LogIn className="size-4" />
                Sign in
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => navigate("/map")}
              >
                Continue as authenticated user
              </Button>
            )}
          </div>

          <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { label: "Core", value: "Routing", note: "A* · Modes · Alternatives" },
              { label: "Smart", value: "Assistant", note: "Rule-based intent" },
              { label: "Premium", value: "Search + Saved", note: "Fuzzy search · Favorites" },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-brand-muted bg-brand-muted/40 p-5"
              >
                <div className="text-xs uppercase tracking-wider text-brand-subtle">
                  {card.label}
                </div>
                <div className="mt-2 text-xl font-semibold text-brand-text">
                  {card.value}
                </div>
                <div className="mt-1 text-sm text-brand-subtle">{card.note}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-16 flex items-center justify-between border-t border-brand-muted pt-6 text-xs text-brand-subtle">
          <span>v1.0.0-premium · All phases complete</span>
          <span>
            Backend health: <span className="text-brand-green">/health</span>
          </span>
        </footer>
      </div>
    </main>
  );
}