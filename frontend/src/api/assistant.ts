/**
 * Typed wrappers around the assistant endpoint.
 *
 * Auth follows the app-wide pattern: the caller passes the JWT from
 * `useAuth().getToken()` and it is attached as `Authorization: Bearer …`.
 * The token is never touched by localStorage directly here and no provider
 * key ever leaves the server.
 */

import type { AssistantResponseOut } from "@/lib/navigation-types";
import { isJwtExpired } from "@/lib/jwt";
import { NavigationApiError } from "./navigation";

/** Raised when the session is gone (expired locally or rejected server-side).
 *  Never a fabricated credential — just an honest "sign in again". */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired or is no longer valid — please sign in again.");
    this.name = "SessionExpiredError";
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new SessionExpiredError();
    }
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

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function assistantQuery(
  token: string,
  query: string,
  campusSlug?: string,
  userLocation?: string,
  timeConstraintMin?: number,
  userLat?: number,
  userLng?: number,
): Promise<AssistantResponseOut> {
  // Never send an already-expired token to the server: fail fast with a
  // clear session message instead of a generic "401 Unauthorized".
  if (isJwtExpired(token)) throw new SessionExpiredError();

  const body = {
    query,
    campus_slug: campusSlug,
    user_location: userLocation,
    time_constraint_min: timeConstraintMin,
    user_lat: userLat,
    user_lng: userLng,
  };
  return unwrap<AssistantResponseOut>(
    await fetch("/api/assistant/query", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    }),
  );
}