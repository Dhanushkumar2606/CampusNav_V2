# Live-Navigation Audit — CampusNav V2

**Route:** SRM Institute of Science and Technology (Kattankulathur) · Boys Hostel → Medical Auditorium (572 m, 10 steps)
**Method:** deterministic simulated GPS (`frontend/src/sim/`) + unit tests (vitest) + headless browser E2E (Puppeteer, real backend :8000) + static audit.
**Evidence types:** SIMULATED (deterministic replay of real backend route geometry), UNIT (vitest + jsdom), E2E (headless Chrome, real UI, real backend). **Real-device GPS was not physically exercised** — any claim that needs a phone is marked UNVERIFIED.

---

## A. Fix pipeline

| Item | Result | Evidence |
|---|---|---|
| Graph loads for campus | PASS | E2E: endpoints listed from `/navigation/campuses/{slug}/graph` |
| Route request (Find) | PASS | E2E + backend tests (113 green); route card rendered |
| Route geometry integrity | PASS | UNIT: every one of 459 fixture fixes projects ≤ 3.8 m from the route line |
| One route request per Find | PASS | E2E request log: exactly one POST per Find click (fix shipped) |

## B. Start-navigation flow

| Item | Result | Evidence |
|---|---|---|
| Start navigation from planned origin | PASS | E2E + UNIT (session at step 0, remaining = total) |
| Re-snap on start ("start from where you are") | PASS with FIX | Start re-routes from the snapped live fix; **BUG FIXED**: snapped node == destination would POST source==destination → backend 400 → route destroyed mid-session. Guarded. |
| Live fix required to track | PASS | E2E: "GPS signal lost" until first fix; countdown only after fixes flow |

## C. Live tracking

| Item | Result | Evidence |
|---|---|---|
| Remaining distance counts down | PASS | E2E: 531 m → 421 m → 269 m → 26 m; UNIT |
| Step instructions advance | PASS | E2E: instruction changes as walk progresses; UNIT with 2-fix hysteresis |
| ETA + arrival time | PASS | UNIT: timeText composition (distance/pace median of last 5 samples) |
| Progress bar | PASS | E2E DOM: width tracks (done / total) |

## D. Accuracy gates (fine / coarse / junk)

| Item | Result | Evidence |
|---|---|---|
| Fine fixes (< 40 m) drive everything | PASS | E2E walk + UNIT |
| Coarse fixes (40–80 m) refresh remaining/ETA only | PASS | E2E: countdown updates, step instruction frozen; UNIT |
| Junk fixes (> 80 m) ignored | PASS | E2E: countdown flat through 30% junk window, resumes after; UNIT |
| Off-route detection (> 50 m, clear < 30 m) | PASS | E2E banner appears and clears; UNIT (perpendicular 57.8 m offset) |

## E. Off-route / auto re-route

| Item | Result | Evidence |
|---|---|---|
| Off-route banner | PASS | E2E: "Off the route — re-routing from your position…" |
| One-shot auto re-route | PASS | UNIT: exactly one re-route POST, then flag clears |
| **BUG FIXED: self-targeting re-route** | — | A fix that snaps onto the destination triggered POST source==destination → 400 → route cleared → navigation UI dead ("Try again", no bar). Reroute now skips when the snap is the destination (or stale). |
| Recovery after re-route | PASS | E2E: countdown resumes after the detour clears |

## F. Arrival

| Item | Result | Evidence |
|---|---|---|
| Arrival gate (≤ 20 m remaining or ≥ 99 % done) | PASS | E2E: "You've arrived at medical_auditorium" + "Done · Return to map"; UNIT |
| **BUG FIXED: arrival never fired (cum off-by-one)** | — | `buildRouteGeometryModel` seeded `cum=[0]` AND pushed 0 again for vertex 0 — the projection under-reported distance by one segment (destination at 529/572 m), so the ≤ 20 m gate was unreachable. Every route was affected. |
| **BUG FIXED: engine froze after arrival** | — | One multipath fix at the end set `phase: "arrived"` forever; subsequent fixes were ignored. A fine fix > 70 m short of the end now resumes guidance (re-departure gate, unit-tested). |
| Walking past the destination | PASS | Re-departure gate resumes guidance; arrival re-triggers when back in the zone |

## G. GPS errors & loss

| Item | Result | Evidence |
|---|---|---|
| Permission denied stops the watch | PASS | UNIT |
| Transient errors keep the watch alive | PASS | UNIT |
| **BUG FIXED: GPS-loss banner only showed before the first fix** | — | A real mid-walk loss (silent watch, no error) kept the last coords "ok" forever. `NavStatusBar` now gates on fix freshness (12 s) with a 1 s re-render tick. |
| Loss banner mid-walk | PASS | E2E: pause → banner after > 10 s silence → resume → countdown back |
| Stale-fix re-projection after a re-route | DOCUMENTED | A pending fix may be re-projected onto the fresh route once (2-fix hysteresis counts two effect passes of the same fix). With the real nearest-node endpoint the re-route origin sits next to the stale fix; harmless in practice, covered by unit-test note. |

## H. Lifecycle

| Item | Result | Evidence |
|---|---|---|
| End navigation mid-walk | PASS | E2E: bar unmounts, Start re-enabled |
| Restart navigation | PASS | E2E: fresh session per scenario |
| Repeated sessions don't poison each other | PASS | E2E 4 sessions sequentially; **BUG FIXED**: stale snap from a previous session leaked into the next (guarded at re-route + start) |
| Camera follow | NOT AUDITED | Purely visual; unaffected by the audited paths |

## I. Conformance

| Item | Result | Evidence |
|---|---|---|
| No fabricated fixes in production | PASS | Simulator dead-code-gated behind `import.meta.env.DEV && VITE_SIMULATED_GPS === "true"` |
| Determinism | PASS | 1 fix/s replay of committed fixtures; zero RNG; scenarios are pure functions |
| Frontend unit suite | 27/27 PASS | `npm test` (vitest) |
| Frontend typecheck + build | PASS | `npm run lint` (tsc -b), `npm run build` |
| Backend suite | 113/113 PASS | backend `pytest` |
| E2E (headless Chrome, real backend) | 16/16 PASS | `routecheck-sim.js` (dev server with `VITE_SIMULATED_GPS=true`) |
| **Real-device GPS** | **UNVERIFIED** | No physical walk was performed; all positional behavior proven via the deterministic simulator |

---

## Verdict

**NAVIGATION: READY** for the fixed set of behaviors the audit could prove (route → track → gates → off-route → re-route → arrival → errors → lifecycle) **with the caveat that real-device GPS remains UNVERIFIED** — the accuracy thresholds (fine/coarse/junk, off-route 50 m, arrival 20 m) are engineering defaults tuned by reasoning, not by field data.

Bugs found and fixed during the audit (all with regression coverage unless noted):
1. `cum` off-by-one in `buildRouteGeometryModel` — arrival was unreachable on every route.
2. Duplicate route POST per Find click (recalc-key recorded only after a route landed).
3. Self-targeting auto re-route (snap == destination → backend 400 → session destroyed).
4. Stale nearest-node snap leaking across sessions.
5. Engine freeze after arrival (multipath false-arrival killed guidance).
6. GPS-loss banner unreachable after the first fix (no freshness gate).

Honest gaps: real-device calibration, camera follow, voice/haptics feedback loop, iOS VR diagnostic (unrelated, still open).
