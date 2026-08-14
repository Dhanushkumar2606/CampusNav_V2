# CampusNav V2 — User Guide

CampusNav is an AI-native campus navigation app. Tell it what you need in
plain language — *"I have a class in 15 minutes"* — and it figures out the
where and the how. It runs on **real campus data only**: if the app doesn't
know something, it tells you honestly instead of guessing.

## Signing in

1. Open the app. Create an account (email + password, 8+ characters) or sign in.
2. Without an account you can still browse the map and search the campus —
   saving places and asking the assistant require an account.

## The Map

The map (MapLibre) shows the real SRM Kattankulathur campus graph:
buildings, path nodes, gates and transit stops.

When you open the map without a specific campus, it tries to pick the right
one for you: the last campus you explored wins; otherwise the nearest campus
to your GPS fix (only if you allow location); otherwise the featured campus.
You can always switch campuses from the routing panel.

- **Click / tap any marker** to see place details and set it as origin or destination.
- **Plan a route** in the left panel (desktop) or the sheet (mobile):
  1. Pick a *From* point and a *To* point.
  2. Choose **Shortest** (least distance) or **Fastest** (least walk time).
  3. Toggle **Avoid stairs** and **Accessible route only** as needed.
  4. **Find route** — the route renders on the map with step-by-step
     instructions and (when available) alternative routes as tabs.

> Honesty note: campus accessibility data is currently *unverified*. The app
> treats edges as accessible by default and says so in the UI — an
> "accessible" route is not a confirmed wheelchair-safe route until surveyed.

## Explore

- With no search text the page becomes a **campus hub**: cards for every
  campus (featured ones first) with real counts — buildings, entrances,
  landmarks, transit stops, walkable nodes and surveyed paths — plus a
  **"Use my location"** row that ranks campuses by honest distance from
  your fix. Tap a campus to open its map.
- **Search** any building, department, landmark, gate or transit stop.
- Filter by **category chips** (Buildings, Landmarks, Transit, Entrances).
- Use **↑/↓ arrows + Enter** to navigate results from the keyboard, or click
  the arrow to view details and the heart to **save** the place.
- Recent searches are remembered on this device.

## Assistant

The assistant understands intent from natural language (rule-based, no LLM):

| You say | You get |
|---------|---------|
| "Where is the library?" | Search results card, tap to navigate |
| "Navigate to the CSE Block" | Route card with a Navigate button |
| "I have a class in the Tech Park in 15 minutes" | Route card with the time constraint understood |
| Anything else | Best-effort search over real campus data |

Tap a suggested prompt to try it. **Clear** starts a fresh conversation.

## Saved

Bookmark places from Explore (or the detail sheet) and they appear here,
account-scoped. Remove with the trash icon, or jump straight to navigation.

## Profile

Persist your preferences: distance units (metric/imperial), default route
mode, stairs/accessibility defaults, and theme. Changes apply on your next
route.

## Accessibility features

- Full **keyboard support**: skip-to-content link, focus rings everywhere,
  arrow-key search navigation, ARIA roles on tabs/lists/switches.
- **Reduced motion** is respected (CSS + framer-motion): animations are
  disabled when the OS requests it.
- **Color contrast** tuned on the premium navy/emerald palette in both
  dark and light themes; theme toggle in the header.

## Tips

- Search works on partial names: "lib", "tech p", "gate" all match.
- Shared route links: the map reads `?source=&destination=&accessible=` from
  the URL, so routes are shareable.
- Dark mode prefers OS setting the first time; you can override per device.