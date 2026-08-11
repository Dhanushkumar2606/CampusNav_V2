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
}

export interface Route {
  source: string;
  destination: string;
  steps: RouteStep[];
  total_distance_m: number;
  estimated_walk_time_min: number;
  step_count: number;
  all_estimated: boolean;
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
}

export interface RouteRequest {
  source_id: string;
  destination_id: string;
  require_accessible: boolean;
  heuristic: "haversine" | "euclidean" | "zero";
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
