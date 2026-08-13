/**
 * TS mirrors of the backend Pydantic schemas in
 * `backend/app/schemas/navigation.py`. Keep these in sync if the backend
 * changes (the router-level response_model is the source of truth).
 *
 * The strict `mode: "json"` rendering that FastAPI applies means every
 * UUID arrives as a string — that's the shape this file models.
 */

export interface Campus {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface Building {
  id: string;
  campus_id: string;
  name: string;
  code: string;
  num_floors: number;
  has_elevator: boolean;
  is_accessible: boolean;
  lng: number | null;
  lat: number | null;
}

export type PathNodeKind =
  | "junction"
  | "entrance"
  | "poi"
  | "transition"
  | "landmark"
  | "transit";

export interface PathNode {
  id: string;
  label: string;
  type: PathNodeKind;
  lat: number;
  lng: number;
  building_id: string | null;
  metadata: Record<string, unknown>;
}

export interface PathEdge {
  id: string;
  from_id: string;
  to_id: string;
  distance_m: number;
  estimated: boolean;
  accessible: boolean;
  type: string;
  walk_time_min: number | null;
  has_stairs: boolean;
  is_restricted: boolean;
  is_indoor: boolean;
  is_outdoor: boolean;
  surface_type: string | null;
  slope: number | null;
  accessibility_verified: boolean;
}

export interface GraphPayload {
  campus: Campus;
  nodes: PathNode[];
  edges: PathEdge[];
  /** label -> node id (matches the seed JSON's `id` field). */
  labels: Record<string, string>;
}

export interface RouteStep {
  from_node_id: string;
  to_node_id: string;
  edge_id: string;
  distance_m: number;
  estimated: boolean;
  walk_time_min: number | null;
  instruction: string | null;
}

export interface Route {
  source: string;
  destination: string;
  steps: RouteStep[];
  total_distance_m: number;
  estimated_walk_time_min: number;
  step_count: number;
  all_estimated: boolean;
  summary: string | null;
}

export type RouteStatus =
  | "ok"
  | "unknown_node"
  | "source_equals_destination"
  | "no_path"
  | "invalid_graph";

export interface RouteResponse {
  status: RouteStatus;
  error: string | null;
  route: Route | null;
  alternatives: Route[] | null;
}

export type RouteMode = "shortest" | "fastest";

export interface RouteRequest {
  source_id: string;
  destination_id: string;
  require_accessible: boolean;
  heuristic: "haversine" | "euclidean" | "zero";
  mode: RouteMode;
  avoid_stairs: boolean;
  alternatives: number;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "staff" | "admin";
  created_at: string;
  disabled_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}

/* ----- Discovery / Search ----- */

export interface SearchResult {
  id: string;
  label: string;
  type: "building" | "node" | "poi";
  category: string;
  lat: number;
  lng: number;
  campus_id: string;
  campus_slug: string;
  campus_name: string;
  building_id: string | null;
  subtitle: string | null;
  score: number;
}

export interface CategoryOut {
  key: string;
  label: string;
  count: number;
}

export interface EntranceOut {
  id: string;
  label: string;
  lat: number;
  lng: number;
  is_accessible: boolean;
  has_stairs: boolean;
}

export interface FloorOut {
  id: string;
  level: number;
  label: string;
  rooms_count: number;
}

export interface BuildingDetailOut {
  id: string;
  campus_id: string;
  name: string;
  code: string;
  num_floors: number;
  has_elevator: boolean;
  is_accessible: boolean;
  lat: number | null;
  lng: number | null;
  entrances: EntranceOut[];
  floors: FloorOut[];
  connecting_nodes: Record<string, unknown>[];
}

/* ----- Favorites ----- */

export interface FavoriteIn {
  target_type: "building" | "node";
  target_id: string;
  note: string | null;
}

export interface FavoriteOut {
  id: string;
  target_type: string;
  target_id: string;
  note: string | null;
  created_at: string;
  label: string | null;
  category: string | null;
}

/* ----- Preferences ----- */

export interface PreferencesIn {
  units?: "metric" | "imperial";
  default_mode?: "shortest" | "fastest";
  default_avoid_stairs?: boolean;
  default_require_accessible?: boolean;
  theme?: "dark" | "light";
}

export interface PreferencesOut {
  units: "metric" | "imperial";
  default_mode: "shortest" | "fastest";
  default_avoid_stairs: boolean;
  default_require_accessible: boolean;
  theme: "dark" | "light";
}

/* ----- Assistant ----- */

export interface AssistantResponseOut {
  kind: string;
  text: string;
  data: Record<string, unknown> | null;
}
