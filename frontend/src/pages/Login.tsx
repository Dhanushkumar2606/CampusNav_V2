/**
 * Login page. Posts to /api/auth/login via the typed api wrapper,
 * stores the token, and lets RequireAuth take it from there.
 */
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogIn, AlertTriangle } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LocationState {
  from?: string;
}

export function Login() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? "/map";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "authenticated") {
    // Bounce away if someone navigates to /login while signed in.
    navigate(from, { replace: true });
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-brand-deep text-brand-text">
      <div
        aria-hidden
        className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-72 opacity-50"
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <header className="mb-8 flex items-center gap-3">
          <div className="size-2.5 rounded-full bg-brand-green shadow-[0_0_12px_2px_rgba(57,255,20,0.6)]" />
          <span className="text-sm uppercase tracking-[0.2em] text-brand-subtle">
            CampusNav · Phase 2
          </span>
        </header>

        <form
          onSubmit={onSubmit}
          className="w-full rounded-xl border border-brand-muted bg-brand-navy/60 p-6 shadow-xl backdrop-blur"
        >
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-brand-subtle">
            Use your CampusNav account to plan routes across campuses.
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-brand-deep/60"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="bg-brand-deep/60"
              />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="size-4" />
              <AlertTitle>Couldn't sign in</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="mt-6 w-full"
          >
            <LogIn className="size-4" />
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <p className="mt-4 text-center text-xs text-brand-subtle">
            Don't have an account?{" "}
            <Link to="/" className="text-brand-cyan hover:underline">
              Back to landing
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
