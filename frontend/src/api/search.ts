/**
 * Typed wrappers around the discovery / search endpoints.
 */

import type {
  SearchResult,
  CategoryOut,
  BuildingDetailOut,
  FavoriteIn,
  FavoriteOut,
  PreferencesIn,
  PreferencesOut,
} from "@/lib/navigation-types";
import { NavigationApiError } from "./navigation";
import { API_BASE } from "@/lib/apiBase";

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

/* ----- Search ----- */

export async function searchCampus(
  query: string,
  campusSlug?: string,
  limit = 20,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (campusSlug) params.set("campus", campusSlug);
  return unwrap<SearchResult[]>(await fetch(`${API_BASE}/api/search?${params.toString()}`));
}

export async function getCampusCategories(
  campusSlug: string,
): Promise<CategoryOut[]> {
  return unwrap<CategoryOut[]>(await fetch(`${API_BASE}/api/campuses/${encodeURIComponent(campusSlug)}/categories`));
}

export async function getBuildingDetail(buildingId: string): Promise<BuildingDetailOut> {
  return unwrap<BuildingDetailOut>(await fetch(`${API_BASE}/api/buildings/${encodeURIComponent(buildingId)}`));
}

/* ----- Favorites ----- */

export async function listFavorites(token: string): Promise<FavoriteOut[]> {
  return unwrap<FavoriteOut[]>(await fetch(`${API_BASE}/api/favorites`, { headers: authHeaders(token) }));
}

export async function addFavorite(
  token: string,
  payload: FavoriteIn,
): Promise<FavoriteOut> {
  return unwrap<FavoriteOut>(
    await fetch(`${API_BASE}/api/favorites`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    }),
  );
}

export async function removeFavorite(token: string, favoriteId: string): Promise<void> {
  await unwrap<void>(await fetch(`${API_BASE}/api/favorites/${encodeURIComponent(favoriteId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  }));
}

/* ----- Preferences ----- */

export async function getPreferences(token: string): Promise<PreferencesOut> {
  return unwrap<PreferencesOut>(await fetch(`${API_BASE}/api/preferences`, { headers: authHeaders(token) }));
}

export async function updatePreferences(
  token: string,
  payload: PreferencesIn,
): Promise<PreferencesOut> {
  return unwrap<PreferencesOut>(
    await fetch(`${API_BASE}/api/preferences`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    }),
  );
}