/**
 * Typed wrappers around the navigation + auth endpoints.
 *
 * Every function throws `NavigationApiError` on a non-2xx response. The
 * Vite dev proxy (`/api/*` -> `http://localhost:8000`) strips the `/api`
 * prefix, so the backend sees `/navigation/...` and `/auth/...` directly.
 */
import type {
  Building,
  Campus,
  CampusNear,
  CampusStats,
  GraphPayload,
  Route,
  RouteRequest,
  RouteResponse,
  RouteStatus,
  TokenResponse,
  User,
} from "@/lib/navigation-types";

/** Thrown when the backend returns a non-2xx status. */
export class NavigationApiError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, message: string, detail: string | null = null) {
    super(message);
    this.name = "NavigationApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = typeof body?.detail === "string" ? body.detail : null;
    } catch {
      // body wasn't JSON; that's fine.
    }
    throw new NavigationApiError(res.status, `${res.status} ${res.statusText}`, detail);
  }
  return (await res.json()) as T;
}

/* ----- Navigation ----- */

export async function listCampuses(): Promise<Campus[]> {
  return unwrap<Campus[]>(await fetch("/api/navigation/campuses"));
}

/** Cheap catalog counts for one campus (Explore hub cards). */
export async function getCampusStats(slug: string): Promise<CampusStats> {
  return unwrap<CampusStats>(
    await fetch(`/api/navigation/campuses/${encodeURIComponent(slug)}/stats`),
  );
}

/** Campuses ranked by distance from a point, nearest first (haversine). */
export async function getCampusesNear(
  lat: number,
  lng: number,
  options?: { limit?: number; radiusM?: number },
): Promise<CampusNear[]> {
  const limit = options?.limit ?? 10;
  const radius = options?.radiusM ?? 200_000;
  return unwrap<CampusNear[]>(
    await fetch(
      `/api/navigation/campuses/near?lat=${lat}&lng=${lng}&limit=${limit}&radius_m=${radius}`,
    ),
  );
}

export async function getGraph(slug: string): Promise<GraphPayload> {
  return unwrap<GraphPayload>(
    await fetch(`/api/navigation/campuses/${encodeURIComponent(slug)}/graph`),
  );
}

export async function listBuildings(slug: string): Promise<Building[]> {
  return unwrap<Building[]>(
    await fetch(`/api/navigation/campuses/${encodeURIComponent(slug)}/buildings`),
  );
}

export interface NearestNodeOut {
  node_id: string;
  label: string;
  type: string;
  lat: number;
  lng: number;
  distance_m: number;
}

/** Snap a raw GPS fix to the closest walkable graph node (honest distance). */
export async function nearestNode(
  slug: string,
  lat: number,
  lng: number,
): Promise<NearestNodeOut> {
  return unwrap<NearestNodeOut>(
    await fetch(
      `/api/navigation/campuses/${encodeURIComponent(slug)}/nearest-node?lat=${lat}&lng=${lng}`,
    ),
  );
}

export async function postRoute(
  slug: string,
  req: RouteRequest,
): Promise<RouteResponse> {
  const res = await fetch(`/api/navigation/campuses/${encodeURIComponent(slug)}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = await unwrap<RouteResponse>(res);
  // The router also throws HTTPException for failure statuses, which surfaces
  // as a rejected unwrap. But the response body can carry a status field that
  // is not "ok" — let the caller deal with that via body.status.
  return body;
}

/* ----- Auth ----- */

export async function login(email: string, password: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    username: email.trim().toLowerCase(),
    password,
  });
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return unwrap<TokenResponse>(res);
}

export async function register(args: {
  email: string;
  password: string;
  full_name: string;
}): Promise<User> {
  return unwrap<User>(
    await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }),
  );
}

export async function me(token: string): Promise<User> {
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<User>(res);
}

/* ----- Helpers ----- */

/** Friendly message for a non-ok RouteResponse. */
export function routeErrorMessage(status: RouteStatus, fallback: string | null): string {
  switch (status) {
    case "no_path":
      return "No path found between those points.";
    case "no_access_route":
      return "No wheelchair-accessible route found between those points.";
    case "source_equals_destination":
      return "Source and destination are the same.";
    case "unknown_node":
      return "One of the selected points is not on this campus.";
    case "invalid_graph":
      return "The campus graph is incomplete — please try a different campus.";
    default:
      return fallback ?? "Could not compute a route.";
  }
}

/**
 * Message for a transport-level failure (NavigationApiError).
 * Distinguishes rate-limiting and server hiccups from plain network loss
 * so the panel can suggest a retry instead of just failing silently.
 */
export function transportErrorMessage(err: unknown): string {
  if (err instanceof NavigationApiError) {
    if (err.status === 429) return "Rate limited by the server — wait a moment and try again.";
    if (err.status >= 500) return `The server hiccuped (${err.status}) — please retry.`;
    return err.detail ?? err.message;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("failed to fetch") || msg.includes("networkerror")) {
      return "Network problem — check your connection and try again.";
    }
    return err.message;
  }
  return "Could not compute a route.";
}

/** Build a Route from a successful RouteResponse. */
export function routeFromResponse(body: RouteResponse): Route {
  if (body.status !== "ok" || !body.route) {
    throw new Error("routeFromResponse called with a non-ok response");
  }
  return body.route;
}
