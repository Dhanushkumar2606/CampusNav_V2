/**
 * Typed wrappers around the navigation + auth endpoints.
 *
 * Every function throws `NavigationApiError` on a non-2xx response. The
 * Vite dev proxy (`/api/*` -> `http://localhost:8000`) strips the `/api`
 * prefix, so the backend sees `/navigation/...` and `/auth/...` directly.
 */
import type {
  Campus,
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

export async function getGraph(slug: string): Promise<GraphPayload> {
  return unwrap<GraphPayload>(
    await fetch(`/api/navigation/campuses/${encodeURIComponent(slug)}/graph`),
  );
}

export async function postRoute(slug: string, req: RouteRequest): Promise<RouteResponse> {
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

/** Build a Route from a successful RouteResponse. */
export function routeFromResponse(body: RouteResponse): Route {
  if (body.status !== "ok" || !body.route) {
    throw new Error("routeFromResponse called with a non-ok response");
  }
  return body.route;
}
