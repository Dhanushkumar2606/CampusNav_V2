/**
 * Formatters for displaying route metrics in the UI.
 *
 * Keep this small — anything more elaborate (e.g. i18n) belongs in
 * a dedicated i18n module added later.
 */

/** Format a distance in meters: <1 km -> "XYZ m", otherwise "X.Y km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

/** Format a walk-time in minutes: <1 -> "Xs", otherwise "X min" or "Xh Ym". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
