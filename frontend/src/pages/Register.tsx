/**
 * Register page. Posts to /api/auth/register (existing backend) and then
 * sends the user to /login to sign in with their new account — the backend
 * does not auto-authenticate on registration.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, UserPlus } from "lucide-react";

import { NavigationApiError, register as apiRegister, transportErrorMessage } from "@/api/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-72 opacity-50"
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <header className="mb-8 flex items-center gap-3">
          <div className="size-2.5 rounded-full bg-brand-green shadow-[0_0_12px_2px_rgba(16,185,129,0.6)]" />
          <span className="text-sm uppercase tracking-[0.2em] text-brand-subtle">
            CampusNav · v1.0.0-premium
          </span>
        </header>

        <form
          onSubmit={onSubmit}
          noValidate
          className="w-full rounded-xl border border-brand-muted bg-brand-navy/60 p-6 shadow-xl backdrop-blur"
        >
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-brand-subtle">
            Join CampusNav to plan routes across campuses.
          </p>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full-name">Full Name</Label>
              <Input
                id="full-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={errors.fullName ? "full-name-error" : undefined}
                className="bg-brand-deep/60"
              />
              {errors.fullName ? (
                <p id="full-name-error" className="text-xs text-brand-danger">
                  {errors.fullName}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
                className="bg-brand-deep/60"
              />
              {errors.email ? (
                <p id="email-error" className="text-xs text-brand-danger">
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
                className="bg-brand-deep/60"
              />
              {errors.password ? (
                <p id="password-error" className="text-xs text-brand-danger">
                  {errors.password}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
                className="bg-brand-deep/60"
              />
              {errors.confirmPassword ? (
                <p id="confirm-password-error" className="text-xs text-brand-danger">
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
            <UserPlus className="size-4" />
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