# GPS Simulator Relocation Report — CampusNav V2

Relocated the large always-visible GPS simulator panel out of the map
viewport into a compact, dev-only **Navigation Diagnostics** entry point.
Simulator engine, GPS behavior, and navigation logic untouched.

## Files changed

| File | Change |
|---|---|
| `frontend/src/sim/NavigationDiagnostics.tsx` | **NEW** — dev-only diagnostics trigger + compact panel (replaces `SimulatorPanel.tsx`) |
| `frontend/src/sim/SimulatorPanel.tsx` | **DELETED** — always-visible panel removed |
| `frontend/src/features/map/MapControls.tsx` | Renders `<NavigationDiagnostics />` inside the bottom-right map-controls column, gated by `isSimulatedLocationEnabled()` (dev-only) |
| `frontend/src/pages/MapView.tsx` | Removed the `<SimulatorPanel />` mount + import |
| `src/sim/locationSim.ts`, `scenarios.ts`, `tracks/` | **UNTOUCHED** (engine, scenarios, fixtures) |

Externally, the headless E2E harness (`routecheck-sim.js`) and dev probe
scripts were updated to drive the new control surface.

## Simulator functionality preserved (engine unchanged)

All behaviors verified byte-for-byte identical to before — `locationSim.ts`
was not modified. The E2E exercised, through the new UI:

- Route replay (deterministic fix cadence, `REPLAY_MS / speed`)
- Location updates through the same `LocationProvider` seam as real GPS
  (`watchPosition`/`getCurrentPosition` contract in `locationSource.ts`)
- Navigation progress, step turns, countdown
- Arrival detection
- Off-route / automatic re-route (backend-triggered scenario)
- GPS loss (dropout/junk window) + GPS-loss banner
- Coarse GPS (55 m — remaining only, no step advance)
- Pause / Resume / Restart / Clear, Deny, Fine/Coarse accuracy overrides
- Speed control (1× / 5× / 10× / 30× — same `setSpeed` as the old ⚡ 30×)
- Scenario surface identical: same 5 `SCENARIOS` (walk, arrival, coarse,
  dropout, off-route) built from the same fixtures

**Closing the diagnostics panel does not stop the simulation** — the
`SimulatorControl` continues streaming fixes while hidden; probe verified
the fix counter advanced `3 → 8` with the panel closed, and shown
`RUNNING` on reopen.

## UI changes

- **Before**: 280 px-wide panel fixed `bottom-3 left-1/2` over the map with
  raw cyan/slate debug styling, permanently visible whenever dev-mode GPS
  was enabled.
- **After**: a single 36×36 icon button (`Wrench`, `aria-label="Navigation
  diagnostics"`) tucked into the existing map-controls column (bottom
  right, next to fullscreen/NOVA — where the dev edges-toggle already
  lives). Clicking opens a compact panel anchored to the left of that
  column: `w-[min(20rem,calc(100vw-4rem))]`, `max-h-[min(60dvh,28rem)]`
  scrollable, `rounded-xl border-brand-muted bg-brand-deep/95 shadow-float`
  — the app's own design tokens (no new design system, no gradients beyond
  the existing brand, no decorative animation; the RUNNING status uses the
  brand green glow dot).
- Panel contents: header (`Navigation Diagnostics` + IDLE/RUNNING/PAUSED ·
  N× status + close), active-track line (`label · fix n/M · totalM m`),
  scenario chips, speed segmented control, transport/GPS-state buttons —
  all as compact existing `Button` outline/secondary variants with lucide
  icons.
- Escape and the X button close; closing never touches the engine.

## Production / dev behavior

- **Dev** (`VITE_SIMULATED_GPS=true`): trigger + panel available in the
  map-controls column. Map otherwise normal.
- **Prod** (`vite build`, `VITE_SIMULATED_GPS=false`): verified the
  built bundle contains **zero** simulator markers (`Navigation
  Diagnostics`, `VITE_SIMULATED`, `SimulatorPanel`, scenario ids) —
  `isSimulatedLocationEnabled()` is folded to `false` by
  `import.meta.env.DEV`, so the whole branch and module are tree-shaken
  from production output.
- Normal users never see any simulator UI: no panel, no controls, no
  overlays when closed (probe verified: `role="dialog"` and all sim
  buttons absent until opened).

## Tests executed

- `npm run test` — **27/27** vitest green (unchanged suite; engine untouched).
- `npm run lint` (`tsc -b`) — clean.
- E2E `routecheck-sim.js` (headless Chrome, real dev server + backend) —
  **20/20 PASS**: trigger present, panel opens, RUNNING after scenario
  load, countdown, step advance, arrival, off-route, re-route recovery,
  junk-GPS resume, GPS-loss banner after pause, resume, coarse-GPS
  remaining/no-step-advance — zero page errors.
- Close-probe (`close-probe.js`) — **14/14 PASS**: map clean when closed,
  36×36 trigger only, panel compact (320×358 at 1280×900, 320×342 at
  390×844), Escape close, replay continues while closed (fix 3→8),
  RUNNING on reopen, nav alive, map controls clickable, mobile no
  horizontal overflow.
- Screenshots recorded: `diag-map-clean.png` (map without any sim UI),
  `diag-panel-open.png` (panel open, map behind intact).

## Build result

`npm run build` — clean (`✓ built`; chunk-size warnings pre-existing,
unrelated). Production bundle verified free of simulator code.

## Remaining issues

- None functional. Notes: the diagnostics header hides the NOVA assistant
  notch area only while open (dev-only, intentional); the trigger follows
  the existing `VITE_SHOW_GRAPH_DEBUG` pattern for dev controls; E2E
  selectors in the temp harness were updated to the new labels (the
  `⚡ 30×` emoji buttons are now clean `30×` segmented chips).

## Verdict

**GPS SIMULATOR RELOCATED — FUNCTIONALITY PRESERVED — MAP UI CLEAN**