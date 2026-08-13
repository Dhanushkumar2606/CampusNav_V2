/**
 * Typed wrappers around the assistant endpoint.
 */

import type { AssistantResponseOut } from "@/lib/navigation-types";
import { NavigationApiError } from "./navigation";

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

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function assistantQuery(
  token: string,
  query: string,
  campusSlug?: string,
  userLocation?: string,
  timeConstraintMin?: number,
): Promise<AssistantResponseOut> {
  const body = { query, campus_slug: campusSlug, user_location: userLocation, time_constraint_min: timeConstraintMin };
  return unwrap<AssistantResponseOut>(
    await fetch("/api/assistant/query", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(body),
    }),
  );
}