# NOVA AUTH + ROUTE FIX REPORT

**Date:** 2026-08-17 · **Status:** READY

---

## A. Root cause of the 401

The Nova UI always attached the correct `Authorization: Bearer <JWT>` header
(reusing the app-wide token from `useAuth().getToken()`), and the backend
validated it correctly. The failure was **silent token expiry, mid-session**:

1. The backend JWT lives for **60 minutes** (`JWT_EXPIRES_MINUTES=60`, HS256,
   `sub` = user UUID, `iss=campusnav-v2`).
2. The client kept the UI in the `authenticated` state after expiry — nothing
   on the client ever looked at the token's `exp` claim (the app has no
   refresh endpoint; `/auth/me` only runs at page load).
3. Nova is the **only** protected endpoint the UI calls at runtime, so the
   first place a stale token surfaced was the Nova chat — as a raw
   "401 Unauthorized" with a misleading "couldn't reach NOVA" message.

Verified live (through the exact Vite proxy path the browser uses):

| Request | Result |
|---|---|
| Fresh login JWT → `POST /assistant/query` | **200**, route `main_gate → central_library` (426.2 m) |
| No token | 401 (correct) |
| Garbage token | 401 (correct) |
| Expired token (real user, past `exp`) | 401 (correct) |

No authentication was weakened; the endpoint remains private and the
server remains the single authority on token validity.

## B. Exact files changed

Backend (`backend/`):
- `app/deps.py` — behavior-neutral refactor of `get_current_user` to
  `OAuth2PasswordBearer(auto_error=False)` + optional `AUTH_DEBUG=1`
  diagnostics (header presence, decodability, user state, role — **never**
  the JWT itself). 401 semantics unchanged.
- `app/services/assistant.py` — two NOVA intent fixes surfaced by the
  browser-path battery: (1) ambiguity detection now applies **only with a
  campus context** — without one, same-named places on different campuses
  (e.g. a "library" everywhere) are duplicates, not choices, so the
  deterministic best is routed; (2) new pattern for
  "find the fastest / an accessible route **to** X" (destination-only
  phrasing with preference prefix).
- `tests/test_assistant.py` — AUTH-NOVA-02/03/04/05/05b/07 + no-campus
  routing + prefixed-route regression tests.

Frontend (`frontend/`):
- `src/lib/jwt.ts` — **new** minimal JWT inspection (base64url payload
  decode + `isJwtExpired` with 30 s skew). Local check only; the server
  stays the validity authority.
- `src/api/assistant.ts` — Nova client hardened: never sends an
  already-expired token (fail fast); server 401/403 → `SessionExpiredError`
  ("Your session has expired or is no longer valid — please sign in
  again."). Same Bearer pattern as the rest of the app; no new storage.
- `src/features/assistant/MapAssistant.tsx` and `src/pages/Assistant.tsx` —
  render the graceful session message and call the existing `logout()` to
  drop the stale token; all other errors keep the previous message.
- `src/api/assistant.test.ts` — **new** frontend auth-chain tests
  (AUTH-NOVA-06, expired-token short-circuit, 401 mapping,
  AUTH-NOVA-07 body-shape/no-credential assertion).

## C. Authentication flow BEFORE the fix

```
Browser (token in localStorage "campusnav.token", status stays
"authenticated" even after the 60-min JWT silently expires)
  ↓  Authorization: Bearer <expired JWT>
POST /api/assistant/query  (Vite proxy → :8000)
  ↓
app/routers/assistant.py → Depends(get_current_user)  →  decode fails → 401
  ↓
UI: "Sorry, I couldn't reach NOVA: 401 Unauthorized"
```

## D. Authentication flow AFTER the fix

```
Login → JWT (HS256, sub=user UUID, exp=+60 min) → stored in existing
localStorage key (unchanged)
  ↓
Nova send() → assistantQuery(token, …) → isJwtExpired(token)?
  ├─ expired  → SessionExpiredError: "Your session has expired…"
  │             + existing logout() drops the token; NO network call
  └─ valid    → POST /api/assistant/query with Authorization: Bearer
                ↓
        get_current_user: header present → decode → user found,
        not disabled → 200
        ├─ missing header / malformed / expired / unknown user → 401
        │   (unchanged, still enforced)
```

## E. JWT verification result

- Algorithm HS256, secret from settings, `sub` = user UUID, `iss`/`iat`/`exp`
  present, 60-minute TTL. Verified live: fresh token accepted; expired
  (past `exp`) and malformed tokens rejected with 401.
- Server-side diagnostics (opt-in `AUTH_DEBUG=1`) confirmed the exact
  rejection reason per case — **no JWT material is ever logged**:
  - valid: `header present: true · format valid: true · user found: true · role: student`
  - invalid: `header present: true · format valid: false (reason: <jose error>)`
  - missing: `header present: false`

## F. Frontend token propagation result

- Nova uses the same token source (`useAuth().getToken()`) and the same
  Bearer convention as every other protected call — no parallel storage, no
  cookies introduced.
- Tested (vitest): the request carries `Authorization: Bearer <JWT>`; an
  expired token short-circuits **before** `fetch`; a server 401/403 maps to
  the graceful session message; the request body contains only the typed
  assistant payload (no `api_key`/`sk-`/secret material).

## G. Backend authentication result

- AUTH-NOVA-01/02: authenticated request accepted (200).
- AUTH-NOVA-03: missing token → 401. AUTH-NOVA-04: invalid token → 401.
  AUTH-NOVA-05: expired token → 401. AUTH-NOVA-05b: disabled account → 401.
- AUTH-NOVA-07: Nova responses never contain provider credentials.
- All enforced via the unchanged `get_current_user` dependency.

## H. AI provider result

Nova is the rule-based engine (no external LLM credentials in this build);
"provider" = the backend intent engine + route service, called server-side.
The only credential class that exists — the user JWT — stays in the
browser; no provider key exists to leak. If an external AI provider is
added later, its key must live server-side only (architecture unchanged).

## I. Nova response test result (live, via Vite proxy, no campus_slug — the UI default)

| Prompt | Result |
|---|---|
| `Hello Nova` | `info` — greeting with capability hints |
| `Where is the library?` | `search` — real candidates listed |
| `main gate to library` | **`route`** — main_gate → central_library, 426.2 m / 5.6 min |
| `Navigate me from Main Gate to Central Library.` | **`route`** — 426.2 m / 5.6 min |
| `Find the fastest route from Main Gate to Library.` | **`route`** — mode `fastest` |
| `Find an accessible route to Library.` | **`route`** — `require_accessible: true` |

## J. Route computation result

Uses the existing route engine end-to-end: `calculate_route` → SRM campus
graph → A* (real surveyed nodes). Response carries `total_distance_m`,
`estimated_walk_time_min`, `step_count`, and graph-label ids
(`main_gate`, `central_library`) that resolve through the campus graph
`labels` map. No separate routing engine exists or was added.

## K. Map integration result

Existing mechanism, unchanged: `MapAssistant` hydrates the map via
`paramsFromResult(res.data)` → `CampusRouteContext.hydrate(...)` → label
resolution → `findRoute` → polyline + `flyToBounds`. The route card's
`Navigate` button deep-links `/map?source=…&destination=…&campus=…`. The
duplicate-request guard (`autoRouteRef` one-shot + `appliedRouteKeyRef`)
prevents repeat POSTs for the same route. Visual confirmation on the map
requires a live browser session; the full data chain feeding it is verified.

## L. Automated test results

- Backend: **129 passed** (incl. AUTH-NOVA-02/03/04/05/05b/07, NOVA-01/02/03
  intent/route tests, no-campus routing, prefixed-route phrasing).
- Frontend: **49 passed** (incl. 5 new Nova auth-chain tests), `tsc -b` clean.

## M. Regression test results

- Backend suite: full pass (auth, search, routing, discovery, seed,
  immersive, health, panorama, tools).
- Frontend suite: full pass (immersive, routeProgress, useLiveLocation,
  navEngine) + typecheck clean.
- Auth edge cases live-verified: logged-in → 200; expired → 401 +
  client-side fail-fast with re-login prompt; invalid/missing → 401;
  backend unavailable / provider failure paths unchanged (still a useful
  network/AI error, never a fake 401 message).
- No changes to login, register, logout, map, search, saved, profile, GPS,
  navigation, or 360 viewer.

## N. Remaining limitations

1. **No silent refresh**: the app has no token-refresh endpoint; on expiry
   the user must sign in again (per the brief: graceful re-login). This is
   the honest behavior — no fake tokens are minted.
2. **Map visual check** is covered by code path + live data chain; a
   browser E2E click-through is recommended for final human sign-off.
3. `AUTH_DEBUG=1` diagnostics are opt-in and stay off by default; no token
   material is logged in either mode.

---

## Verdict

**READY** — the 401 is root-caused (silent 60-minute JWT expiry, no
client-side detection) and fixed without weakening auth: Nova reuses the
existing JWT mechanism, fails fast on expired tokens with a graceful
re-login message, and the full chain (login → JWT → Nova → intent →
location resolution → existing route engine) returns real routes for
"main gate to library", fastest and accessible variants included.
