# Auth UI/UX Redesign — CampusNav V2

UI/UX-only redesign of the Login and Register pages to match the app's
premium design language (dark-navy + emerald/teal, `index.css` HSL tokens,
brand-gradient motif, shadcn primitives). **Zero workflow changes** — every
state transition, validation rule, API call, error string, redirect target,
and the authenticated-bounce behavior are preserved 1:1 from the previous
code and verified by automated checks.

## A. Files changed

| File | Change |
|---|---|
| `frontend/src/pages/Login.tsx` | Presentation-only redesign (see B) |
| `frontend/src/pages/Register.tsx` | Presentation-only redesign (see C) |
| `frontend/src/components/ui/password-input.tsx` | **NEW** — shared presentational `Input` wrapper with show/hide password toggle; all form semantics pass through untouched |

No changes to: `AuthContext`, `RequireAuth`, `navigation.ts` api wrapper,
routing (`App.tsx`), backend, or any other file.

## B. Login redesign

- Brand mark upgraded to match the app shell `Header` (glowing emerald dot +
  wordmark + `PremiumBadge`); `ThemeToggle` added top-right (auth pages sit
  outside `AppShell`, so they previously had no theme control).
- `brand-gradient` hero wash extended to `h-96 opacity-60` for depth.
- Card: `shadow-card` (brand shadow utility), `sm:p-8` on desktop, kept
  `rounded-xl border-brand-muted bg-brand-navy/60 backdrop-blur`.
- Heading: "Welcome back" with the Landing-page gradient-text treatment
  (`from-brand-green via-brand-cyan to-brand-purple bg-clip-text`).
- Email input: leading `Mail` icon in a relative wrapper (same pattern as the
  Header search field), `h-11` touch target.
- Password input: `PasswordInput` (eye/eye-off toggle) — **no** change to
  `value`, `onChange`, `required`, `minLength`, `autoComplete`.
- Submit button: green-glow primary (existing variant), `Loader2` spinner
  while submitting (reduced-motion is neutralized by the global
  `prefers-reduced-motion` CSS rule), label text unchanged.
- Kept 1:1: `onSubmit`, 401 → "Invalid email or password.", other errors via
  `transportErrorMessage`, `navigate(from, { replace: true })` on success,
  render-time bounce-away when already authenticated, `justRegistered`
  success `Alert` ("Account created" banner with `CheckCircle2`), the
  destructive `Alert` wrapper for login errors, and the "Create an account"
  `Link` to `/register`.

## C. Register redesign

- Same shared chrome as Login: glowing brand mark, `ThemeToggle`, gradient
  wash, `shadow-card` card, gradient-accented heading ("Create your account").
- Inputs: leading icons (`User`, `Mail`), `h-11`, eye toggles on both password
  fields via `PasswordInput`.
- Field errors: same text, same `id`s, same `aria-invalid` /
  `aria-describedby` wiring — now rendered with an inline `AlertCircle` icon.
- Kept 1:1: `EMPTY_ERRORS` / `EMAIL_RE` / `validate()` rules and messages,
  `noValidate`, `onSubmit` (409 → "An account with this email already exists.
  Try signing in instead.", 422 → "Please check your details and try again.",
  fallback → `transportErrorMessage`), payload shape
  (`{ full_name, email, password }` with existing `trim()` /
  `.toLowerCase()` munging), post-success redirect to `/login` with
  `{ state: { registered: true }, replace: true }`, duplicate-submit guard
  (`disabled={submitting}`), and the "Sign in" `Link` to `/login`.

## D. Evidence — unit & static

- `npm run lint` (`tsc -b`): clean.
- `npm run build`: clean (chunk-size warnings pre-existing, unrelated).
- `npm run test`: **27/27** vitest pass (unchanged suite — auth pages have no
  unit tests and none were added; the redesign can't regress engine tests).
- `git diff` review of `Login.tsx` / `Register.tsx`: the only removed lines
  are the old heading/brand text and markup; **no logic line deleted or
  altered** (verified with a logic-line filter over the diff).

## E. Evidence — headless E2E (SIMULATED browser, real dev server + backend)

Harness: `/var/folders/.../pptr/authflow.js` (puppeteer-core, headless Chrome,
vite dev :5173, uvicorn :8000, real `/api/auth/register` + `/api/auth/login`).

19 checks, all PASS:

1. Register h1 "Create your account" + gradient span
2. Brand mark present
3. Theme toggle present
4. 4 inputs (name/email/pass/confirm) with correct types
5. 2 password fields with eye toggles
6. `form.noValidate` preserved
7. Empty-submit → all 4 field errors (same messages)
8. Short password (<8) message
9. Mismatch ("Passwords do not match.")
10–11. Eye toggle: `password` → `text` → `password`
12. Register success → redirect to `/login`
13. "Account created" banner + icon renders
14. Login h1 "Welcome back" + gradient span
15. Login → `/register` link
16. Register → `/login` link
17. Invalid login → stays on `/login`, destructive alert "Couldn't sign in /
    Invalid email or password."
18. Valid login → `/map`
19. Authenticated bounce: hard-nav to `/login` → back to `/map`

Theme verification (computed styles, both themes): dark card
`rgba(12,18,39,0.6)` (brand-navy/60) with "Switch to light mode" toggle label;
light card `rgba(231,235,244,0.6)` with "Switch to dark mode"; gradient
headline renders `background-image: linear-gradient` + transparent text fill in
both; no horizontal overflow at 1280×900. Screenshots captured:
`auth-login-dark/light.png`, `auth-register-dark/light.png`.

Notable harness notes: `__PREMIUM__` is a build flag (`PREMIUM=true` env), so
`PremiumBadge` renders only on premium builds — consistent with the shell; the
`Premium` assertion was dropped from the E2E for that reason (badge component
itself is exercised wherever the shell is).

## F. Remaining issues

- **Pre-existing (not introduced here):** dev-mode React warning "Cannot
  update a component while rendering a different component" fires on the
  render-time authenticated bounce in `Login.tsx` (preserved per spec; a
  follow-up could move `navigate` into a `useEffect` with identical behavior).
- The stray 401 in the E2E console log is the deliberate invalid-password
  attempt (expected).
- `PremiumBadge` shows only when built with `PREMIUM=true` (pre-existing
  build-flag behavior, consistent with `Header`).

## Verdict

**AUTH UI/UX REDESIGN COMPLETE — WORKFLOW PRESERVED.** The two pages now
share the app's brand-mark header, theme toggle, gradient headline, icon-led
inputs, show/hide password, and premium card treatment; every validation
rule, error string, API call, redirect, and the authenticated bounce are
verified unchanged by 27/27 unit tests, clean lint/build, and a 19-check
headless E2E against the real stack.