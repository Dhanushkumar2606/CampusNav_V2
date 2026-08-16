/**
 * Login page. Posts to /api/auth/login via the typed api wrapper,
 * stores the token, and lets RequireAuth take it from there.
 */
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogIn, AlertTriangle, CheckCircle2, Loader2, Mail } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { NavigationApiError, transportErrorMessage } from "@/api/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PremiumBadge } from "@/components/ui/premium-badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface LocationState {
  from?: string;
  registered?: boolean;
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
  const justRegistered = (location.state as LocationState | null)?.registered === true;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof NavigationApiError && err.status === 401) {
        setError("Invalid email or password.");
      } else {
        setError(transportErrorMessage(err));
      }
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
        className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-96 opacity-60"
      />

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <header className="mb-8 flex items-center gap-2.5">
          <span className="size-2.5 rounded-full bg-brand-green shadow-glow" aria-hidden />
          <span className="text-base font-semibold tracking-wide text-brand-text">
            CampusNav
          </span>
          <PremiumBadge />
        </header>

        <form
          onSubmit={onSubmit}
          className="w-full rounded-xl border border-brand-muted bg-brand-navy/60 p-6 shadow-card backdrop-blur sm:p-8"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome{" "}
            <span className="bg-gradient-to-r from-brand-green via-brand-cyan to-brand-purple bg-clip-text text-transparent">
              back
            </span>
          </h1>
          <p className="mt-1 text-sm text-brand-subtle">
            Use your CampusNav account to plan routes across campuses.
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-subtle"
                  aria-hidden
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 bg-brand-deep/60 pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="h-11 bg-brand-deep/60 pl-4"
              />
            </div>
          </div>

          {justRegistered ? (
            <Alert className="mt-4 border-brand-green/40 bg-brand-green/10">
              <CheckCircle2 className="size-4 text-brand-green" />
              <AlertTitle>Account created</AlertTitle>
              <AlertDescription>
                Your account is ready — sign in with your new credentials.
              </AlertDescription>
            </Alert>
          ) : null}

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
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <LogIn className="size-4" aria-hidden />
            )}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <p className="mt-5 text-center text-sm text-brand-subtle">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-medium text-brand-cyan hover:text-brand-cyan/80 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}