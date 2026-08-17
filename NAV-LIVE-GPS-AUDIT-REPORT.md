# NAV-LIVE-GPS-AUDIT-REPORT.md

CampusNav V2 — Real (browser/device) GPS tracking audit & fix.

Date: 2026-08-17
Scope: `frontend/` location pipeline end-to-end. The navigation engine,
routing engine and off-route/reroute logic were already audited in a prior
session and are referenced here, not rewritten.

---

## A. Current GPS architecture

```
Browser geolocation (navigator.geolocation — real GPS)
        |
        v
lib/locationSource.ts  (the seam: returns navigator.geolocation in prod,
                        or the dev-only simulated source when
                        VITE_SIMULATED_GPS=true, or an injected stub)
        |
        v
features/map/useLiveLocation.ts   (state machine: idle -> locating ->
        ok | denied | unavailable; one live watch; watchdog; retries)
        |
        v
features/campus/CampusRouteContext.tsx
   |-- locate state (context value)
   |-- engine effect: projects each ok fix onto route geometry
   |     (routeProgress.ts / buildRouteGeometryModel) -> stepIndex,
   |     arrival, remainingM/ETA, off-route + one-shot auto re-route
   |-- follow effect: throttled camera fly-along during navigation
   |
   +--> NavStatusBar  (turn-by-turn banner, voice/haptics, "Live"/"GPS
   |                   signal lost" states, 360° viewer trigger)
   |
   +--> MapControls   (locate button with status label, marker drawing
                       with EMA smoothing + accuracy halo + heading cone)
   |
   +--> Renderers     (MapLibre MapCanvas / Leaflet LeafletCanvas via the
                       renderer-agnostic MapController)
```

Every geolocation call site goes through `getLocationSource()` — real GPS,
simulated GPS and test stubs all speak the identical
`watchPosition/getCurrentPosition/clearWatch` contract, so the navigation
engine never knows (or cares) where the fix came from.

## B. Root cause of the reported "Location unavailable / Could not determine your location."

The exact message the user saw is the hook's OLD catch-all error text, which
was produced for **any** non-denied geolocation failure (POSITION_UNAVAILABLE
code 2 or TIMEOUT code 3). The failure callback had fired, meaning:

1. `navigator.geolocation` existed (so not a fully unsupported browser), and
2. the browser rejected the request or never delivered a fix in time.

Deterministic root-cause candidates, in order of likelihood (a device or the
dev diagnostics panel is required to distinguish them — see below):

| # | Candidate | How it surfaces | State after this fix |
|---|-----------|-----------------|----------------------|
| 1 | **Insecure context** — app opened over `http://` on a non-localhost host. Safari/Chrome keep `navigator.geolocation` present but instantly fail every request (code 2). | code 2, `window.isSecureContext === false` | Hook detects insecure context BEFORE requesting and reports "Live location requires a secure connection (HTTPS)…" with no retry loop; smoke test + panel show Secure context: NO |
| 2 | **Safari without a user gesture** — Safari (macOS/iOS) suppresses the permission prompt for programmatic requests; the boot-time auto-detect `getCurrentPosition` (CampusRouteContext, no gesture) then fails code 2. Tap-driven requests are gesture-driven and work. | code 2 on the boot probe (silent), prompt appears on tap | Boot probe remains best-effort/silent; tap + navigation-start requests are unaffected; diagnostics show exact state |
| 3 | **Timeout** — old option `timeout: 10_000` with `enableHighAccuracy: true` is too tight for phones near buildings/trees (10–15 s per high-accuracy fix is routine). | code 3 | Timeout raised to 20 s; on TIMEOUT the watch survives and a controlled retry re-arms it; UI shows "Searching GPS…" |
| 4 | **macOS Location Services / device GPS disabled** | code 2 | Distinct message "…Move to an area with a clearer signal…" + retries |
| 5 | **No geolocation API at all** (very old browser / hardened webview) | `getLocationSource()` returns null | Distinct "Live location is not supported by this browser." |

Previously the app treated 2/3/5 identically ("Could not determine your
location."), showed a one-shot toast and did NOTHING further — a single
transient failure killed tracking until the user manually re-tapped.
That masking behavior is the core defect this audit fixes: every failure
mode now has a distinct message, retry behavior and an honest UI state.

## C. Browser/Safari findings

- Geolocation requires a **secure context**: HTTPS, or localhost during dev.
  The hook now checks `window.isSecureContext` and reports the real cause.
- Safari (macOS/iOS): programmatic geolocation prompts need a user gesture;
  backgrounded tabs stop delivering watch fixes; iOS Safari throttles
  timers in background. Mitigations: tap/navigation-start requests are
  gesture-driven; the watch-aliveness watchdog re-arms a silently dead
  watch after one gap.
- Safari's `Permissions API` query is not supported for geolocation in
  older releases — the panel falls back to UNKNOWN and the UI derives
  denied state from the error code instead.
- The old `timeout: 10_000` specifically triggers Safari/mobile failures
  before acquisition; fixed to 20 s.

## D. Permission handling

- `denied` (code 1): watch stopped, coords cleared, message "Location
  permission is blocked. Allow location access in your browser settings
  and try again.", button state "Permission required", **no retry**.
- `prompt`/granted states are visible in the dev diagnostics panel
  (`navigator.permissions.query`, live-updating).
- Chromium re-request flow on the locate button is preserved
  (`permissions.request`).
- No silent fallback to campus center/hard-coded coordinates exists or was
  added — the user is always told real GPS is unavailable.

## E. getCurrentPosition() findings

Two call sites, both with sensible options:

1. Campus boot auto-detect (`CampusRouteContext`, one-shot): used only when
   no campus is pinned; best-effort and silent on failure. Its options are
   inherited from the browser default — it never blocks the UI. Kept.
2. `useLiveLocation` fallback for engines without `watchPosition`: same
   options as the watch (high accuracy, 20 s timeout, 5 s maximumAge).

No `timeout: 0` anywhere. `maximumAge: 5_000` allows a recent cached fix
for the one-shot path; the watch path intentionally prefers fresh fixes.

## F. watchPosition() findings

The watch lifecycle is now fully controlled:

- **Exactly one live watch at a time.** Every start path goes through
  `arm()`, which clears the previous watch first (`clearWatch`), so
  duplicate/stacked watchers are impossible. Verified by test.
- **Started only by user action or recovery logic** — never per render.
  `locate()` (button / navigation start) and the retry/watchdog paths.
- **Stops on** `denied`, on re-arm, and on unmount (cleanup effect).
- **Controlled retry**: on TIMEOUT/POSITION_UNAVAILABLE the watch survives
  and a re-arm retry is scheduled at 4 s → 8 s → 15 s → 30 s (bounded at
  30 s — no aggressive loop), `retrying: true` shown in UI as
  "Searching GPS…". Success cancels any pending retry.
- **Watch-aliveness watchdog**: if a live watch delivers nothing for 25 s
  (Safari silent-drop, power savers, background tabs), it is re-armed once
  per gap without touching the visible fix.
- Heading/speed/altitude from the position are now captured (when the
  device reports them) and feed the marker cone + diagnostics.

## G. React lifecycle findings

- No watcher is created in a render effect dependent on GPS coordinates.
  The watch id, last fix time, last arm time, coords and retry timer all
  live in refs; the state machine only ever mirrors them into React state.
- The engine effect depends on `locate.coords` (a new snapshot per fix) —
  correct and deliberate; it gates on `status === "ok"`.
- Transient errors preserve the last good `coords` so the marker and banner
  don't flicker; the engine still gates on `status === "ok"`, so stale
  coords can never advance steps.

## H. GPS marker implementation

- Teal location dot (brand) + white/deep border + accuracy halo
  (MapLibre GeoJSON circle / Leaflet circle, radius = live accuracy).
- **Heading cone** — when the device reports `heading`, a rotated
  wedge points the walking direction (both renderers).
- **Visual-only EMA smoothing** (α = 0.5, min move 1.5 m): the drawn
  marker glides instead of jumping on tiny GPS fluctuations. The
  navigation engine always receives the **raw** fix — smoothing never
  touches routing coordinates.
- Dot survives transient errors (only `denied` clears it).

## I. Live route-progress implementation

Unchanged from the audited engine (`routeProgress.ts` geometry model):
per-fix projection, step boundaries with 2-fix hysteresis, remaining
distance, pace-smoothed ETA, arrival gate (≤20 m or frac ≥ 0.99). The
NavStatusBar renders instruction, progress bar, remaining/ETA and a new
green **Live** indicator when the fix is fresh; "GPS signal lost" when
stale. The next-junction pulse ring on the route layer (from the 360°
session) is retained. Full passed-portion line-removal is a visual
enhancement not present in either renderer today; noted in §P.

## J. Off-route/reroute integration

Unchanged from the audited engine: off-route toggle at 50 m (clears at
30 m), coarse fixes cannot judge deviation, one-shot auto re-route from the
snapped node with an in-flight guard and arrival-zone guard. Real GPS feeds
the exact same pipeline.

## K. GPS-loss handling

GPS active → updates stop → 12 s staleness gate flips the banner to
"GPS signal lost — steps won't advance until it returns" (session kept,
route kept) → watchdog re-arms a silent watch after 25 s → transient-error
retries re-arm earlier when the browser reports errors → fix returns →
projection resumes from the current position. The session is never reset
and the user is never sent back to the start.

## L. Simulator separation

- Simulator selection is guarded by `import.meta.env.DEV &&
  VITE_SIMULATED_GPS === "true"` inside the locationSource seam.
- Production bundle verification: `dist/assets/` scanned — no
  `locationSim`, `NavigationDiagnostics`, `gpsSmoke`, `SimulatorPanel` or
  `VITE_SIMULATED_GPS` code present (the only "simulated" strings come from
  a third-party library). The dev diagnostics module is mounted under
  `import.meta.env.DEV` and is fully tree-shaken in production.
- The dev diagnostics panel now shows a REAL-GPS status card in every dev
  build (permission, provider, watch state, position, accuracy, altitude,
  heading, speed, last update, error kind, secure context, browser) plus
  the sim controls only when the sim is enabled.

## M. Tests executed

Frontend (vitest): 44 passed
- `useLiveLocation` state machine (14): acquisition, denial, timeout
  recovery, POSITION_UNAVAILABLE mapping, insecure-context honesty, watch
  activity exposure, transient-error coords preservation, silent-watch
  re-arm, controlled retry re-arm, superseding requests, unmount cleanup,
  simulator contract.
- Navigation engine suite (11) — sim-driven: acquisition, step advance,
  arrival, off-route, reroute, coarse-GPS gates, GPS loss/recovery.
- Route progress (9), other suites (10).

TypeScript: `tsc -b` clean. Production build: `vite build` clean.
Backend: `pytest` — 113 passed.
Dev-server module transform: all changed modules compile (HTTP 200).
Production bundle scan: no simulation/diagnostics code shipped.

Deterministic sim-based engine tests prove the navigation engine; the
REAL browser integration is proven by code review + the smoke test utility
(see §P for device verification).

## N. Results

- Real GPS pipeline now distinguishes every failure mode with actionable
  messages, retries transient failures, self-heals silently dead watches,
  preserves the marker across GPS hiccups, and reports honest UI state at
  every step.
- No regression: full frontend + backend suites green, production bundle
  verified clean of dev-only code.

## O. Files changed

- `frontend/src/features/map/useLiveLocation.ts` — error-kind model,
  secure-context check, retry/backoff, watchdog back-off, heading/speed/
  altitude capture, watchActive, retrying; timeout 10 s → 20 s.
- `frontend/src/features/map/useLiveLocation.test.ts` — 7 new tests,
  assertions updated for the richer coords snapshot.
- `frontend/src/features/campus/CampusRouteContext.tsx` —
  `MapController.setUserMarker` gains a heading parameter.
- `frontend/src/features/map/MapCanvas.tsx` / `LeafletCanvas.tsx` —
  heading cone in the you-are-here marker (both renderers).
- `frontend/src/features/map/MapControls.tsx` — locate button with
  always-visible state label (Use my location / Locating… / Live /
  Searching GPS… / Permission required / Location unavailable); marker
  EMA smoothing + heading; dot cleared only on denied; diagnostics mounted
  in every dev build.
- `frontend/src/sim/gpsSmoke.ts` (new) — dev-only REAL GPS smoke test
  (API, secure context, permission, getCurrentPosition, watchPosition,
  clearWatch).
- `frontend/src/sim/NavigationDiagnostics.tsx` — real-GPS status card +
  smoke-test runner + sim controls card (sim only when enabled).
- `frontend/src/features/navigation/NavStatusBar.tsx` — "Live" indicator.

## P. Remaining limitations

- **Physical-device verification not performed here** (no phone/headless
  browser in this environment). Run the diagnostics panel ("Run REAL GPS
  smoke test") on the actual device/page before shipping to users.
- Safari background-tab throttling can still delay fixes for minutes on a
  backgrounded tab; the watchdog recovers on visibility.
- Heading cone assumes a north-up map; MapLibre bearing rotation is not
  subtracted (minor visual offset when the user rotates the map).
- Passed-portion line removal on the route layer (see §I) is a visual
  enhancement not implemented in either renderer.
- macOS "Location Services" disabled or device GPS off is detectable only
  by the error code/message and the smoke test — no OS-level API exists.
- The boot auto-detect probe can be suppressed by Safari's gesture
  requirement; it is silent and non-blocking by design.

## Q. Production readiness verdict

**READY WITH DEVICE VERIFICATION REQUIRED**

All identified root-cause candidates for the reported failure are now
handled with distinct, actionable behavior, the pipeline is fully
instrumented for diagnosis, and every regression suite passes. Real
physical GPS acquisition on the target device/browser could not be
exercised in this development environment, and per policy the integration
is not marked verified until the smoke test passes on a real device.
