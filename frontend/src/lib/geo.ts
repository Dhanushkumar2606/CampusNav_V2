/**
 * True when the browser can create a WebGL2 context.
 * maplibre-gl v4 requires WebGL2 — a WebGL1-only browser must NOT be sent
 * down the MapLibre path (it would fail at construction and leave a blank
 * map), so this probes webgl2 only.
 */
export function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false };
    const ctx = canvas.getContext("webgl2", attrs);
    if (!ctx) return false;
    // Extra check: some drivers return a context but can't actually render.
    // A draw call that produces zero dimensions is a dead giveaway.
    const ext = ctx.getExtension("WEBGL_lose_context");
    const supported = ctx.drawingBufferWidth >= 0;
    ext?.loseContext();
    return supported;
  } catch {
    return false;
  }
}

/**
 * True when the browser is Safari (WebKit without the Chromium/Firefox
 * markers that also appear in Safari UA strings).
 * MapLibre silently fails to paint on some Safari/WebGL2 combinations
 * (no error events, blank canvas), so Safari gets the WebGL-free Leaflet
 * renderer instead — it's plain DOM, guaranteed to paint.
 */
export function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    ua.includes("Safari") &&
    !ua.includes("Chrome") &&
    !ua.includes("CriOS") &&
    !ua.includes("Firefox") &&
    !ua.includes("Edg")
  );
}

/** Extra-small [lngLat] convenience: min/max box from node coords, or null. */
export function boundsFromNodes(
  nodes: { lat: number; lng: number }[],
): [[number, number], [number, number]] | null {
  if (nodes.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const n of nodes) {
    if (n.lng < minLng) minLng = n.lng;
    if (n.lng > maxLng) maxLng = n.lng;
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * Small bounds box around a campus catalog center — used before the campus
 * graph has loaded (or when a campus has no graph yet) so the map opens on
 * the right part of the world for ANY campus, not just the hardcoded
 * default. ~±0.006° ≈ a 1.3 km box at zoom ~15.
 */
export function boundsFromCenter(
  center: { center_lat: number | null; center_lng: number | null } | null | undefined,
  spanDeg = 0.006,
): [[number, number], [number, number]] | null {
  if (!center || center.center_lat == null || center.center_lng == null) return null;
  return [
    [center.center_lng - spanDeg, center.center_lat - spanDeg],
    [center.center_lng + spanDeg, center.center_lat + spanDeg],
  ];
}

/** Haversine distance in meters between two coordinates. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial bearing in degrees (0..360) from point 1 to point 2. */
export function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}