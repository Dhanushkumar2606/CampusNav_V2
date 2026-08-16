/**
 * Register page. Posts to /api/auth/register (existing backend) and then
 * sends the user to /login to sign in with their new account — the backend
 * does not auto-authenticate on registration.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, AlertCircle, Loader2, Mail, User, UserPlus } from "lucide-react";

import { NavigationApiError, register as apiRegister, transportErrorMessage } from "@/api/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PremiumBadge } from "@/components/ui/premium-badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";

type FieldError = string | null;

interface Errors {
  fullName: FieldError;
  email: FieldError;
  password: FieldError;
  confirmPassword: FieldError;
  form: FieldError;
}

const EMPTY_ERRORS: Errors = {
  fullName: null,
  email: null,
  password: null,
  confirmPassword: null,
  form: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Register() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>(EMPTY_ERRORS);

  function validate(): Errors {
    const next: Errors = { ...EMPTY_ERRORS };
    if (!fullName.trim()) next.fullName = "Full name is required.";
    if (!email.trim()) {
      next.email = "Email is required.";
    } else if (!EMAIL_RE.test(email.trim())) {
      next.email = "Enter a valid email address.";
    }
    if (!password) {
      next.password = "Password is required.";
    } else if (password.length < 8) {
      next.password = "Password must be at least 8 characters.";
    }
    if (!confirmPassword) {
      next.confirmPassword = "Please confirm your password.";
    } else if (confirmPassword !== password) {
      next.confirmPassword = "Passwords do not match.";
    }
    return next;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.values(next).some((v) => v !== null)) return;

    setSubmitting(true);
    try {
      await apiRegister({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      // Account created — the backend does not auto-authenticate, so take
      // the user to the existing login page to sign in (banner included).
      navigate("/login", { state: { registered: true }, replace: true });
    } catch (err) {
      if (err instanceof NavigationApiError && err.status === 409) {
        setErrors((prev) => ({
          ...prev,
          form: "An account with this email already exists. Try signing in instead.",
        }));
      } else if (err instanceof NavigationApiError && err.status === 422) {
        setErrors((prev) => ({
          ...prev,
          form: "Please check your details and try again.",
        }));
      } else {
        setErrors((prev) => ({ ...prev, form: transportErrorMessage(err) }));
      }
    } finally {
      setSubmitting(false);
    }
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
          noValidate
          className="w-full rounded-xl border border-brand-muted bg-brand-navy/60 p-6 shadow-card backdrop-blur sm:p-8"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your{" "}
            <span className="bg-gradient-to-r from-brand-green via-brand-cyan to-brand-purple bg-clip-text text-transparent">
              account
            </span>
          </h1>
          <p className="mt-1 text-sm text-brand-subtle">
            Join CampusNav to plan routes across campuses.
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full-name">Full Name</Label>
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-subtle"
                  aria-hidden
                />
                <Input
                  id="full-name"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  aria-invalid={errors.fullName ? true : undefined}
                  aria-describedby={errors.fullName ? "full-name-error" : undefined}
                  className="h-11 bg-brand-deep/60 pl-9"
                />
              </div>
              {errors.fullName ? (
                <p
                  id="full-name-error"
                  className="flex items-center gap-1.5 text-xs text-brand-danger"
                >
                  <AlertCircle className="size-3 shrink-0" aria-hidden />
                  {errors.fullName}
                </p>
              ) : null}
            </div>

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
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className="h-11 bg-brand-deep/60 pl-9"
                />
              </div>
              {errors.email ? (
                <p
                  id="email-error"
                  className="flex items-center gap-1.5 text-xs text-brand-danger"
                >
                  <AlertCircle className="size-3 shrink-0" aria-hidden />
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
                className="h-11 bg-brand-deep/60"
              />
              {errors.password ? (
                <p
                  id="password-error"
                  className="flex items-center gap-1.5 text-xs text-brand-danger"
                >
                  <AlertCircle className="size-3 shrink-0" aria-hidden />
                  {errors.password}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
                className="h-11 bg-brand-deep/60"
              />
              {errors.confirmPassword ? (
                <p
                  id="confirm-password-error"
                  className="flex items-center gap-1.5 text-xs text-brand-danger"
                >
                  <AlertCircle className="size-3 shrink-0" aria-hidden />
                  {errors.confirmPassword}
                </p>
              ) : null}
            </div>
          </div>

          {errors.form ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="size-4" />
              <AlertTitle>Couldn't create account</AlertTitle>
              <AlertDescription>{errors.form}</AlertDescription>
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
              <UserPlus className="size-4" aria-hidden />
            )}
            {submitting ? "Creating account…" : "Create Account"}
          </Button>

          <p className="mt-4 text-center text-sm text-brand-subtle">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-brand-cyan hover:text-brand-cyan/80 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}