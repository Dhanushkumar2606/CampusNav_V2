/**
 * gpsSmoke — dev-only REAL GPS smoke test.
 *
 * Probes the actual browser geolocation stack end-to-end:
 *   API presence -> secure context -> permission state -> getCurrentPosition
 *   -> watchPosition -> error callback -> clearWatch.
 *
 * This uses navigator.geolocation directly (bypassing the locationSource
 * seam on purpose): the seam is already covered by the simulated-source
 * tests, and the smoke test exists to prove the REAL browser integration —
 * the exact contract a production user hits. It never fakes a position and
 * never touches the simulator.
 *
 * Dev/test only: imported solely by the dev diagnostics panel, so Rollup
 * drops this module from production bundles.
 */
export interface GpsSmokeReport {
  ranAt: string;
  geolocationApi: { pass: boolean; detail: string };
  secureContext: { pass: boolean; detail: string };
  permission: { pass: boolean; state: string; detail: string };
  initialPosition: { pass: boolean; detail: string };
  watch: { pass: boolean; detail: string };
  cleanup: { pass: boolean; detail: string };
}

export function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (/Firefox\//.test(ua)) return "Firefox";
  return "Other";
}

export function secureContextDetail(): string {
  const secure = typeof window !== "undefined" && window.isSecureContext === true;
  return `${secure ? "YES" : "NO"} (${window.location.protocol}//${window.location.hostname}${
    window.location.port ? `:${window.location.port}` : ""
  })`;
}

function waitForPosition(timeoutMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 5000,
    });
  });
}

function waitForWatch(timeoutMs: number): Promise<{ position: GeolocationPosition; clear: () => void }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        settled = true;
        navigator.geolocation.clearWatch(id);
        resolve({ position: pos, clear: () => navigator.geolocation.clearWatch(id) });
      },
      (err) => {
        if (settled) return;
        settled = true;
        navigator.geolocation.clearWatch(id);
        reject(err);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5000 },
    );
    // Safety net: never leave a stray watcher behind if the promise chain
    // dies before a fix arrives.
    window.setTimeout(() => {
      if (!settled) {
        settled = true;
        navigator.geolocation.clearWatch(id);
        reject(new Error("watch timeout"));
      }
    }, timeoutMs + 2000);
  });
}

export async function runGpsSmokeTest(timeoutMs = 10_000): Promise<GpsSmokeReport> {
  const report: GpsSmokeReport = {
    ranAt: new Date().toISOString(),
    geolocationApi: { pass: false, detail: "" },
    secureContext: { pass: false, detail: "" },
    permission: { pass: false, state: "UNKNOWN", detail: "" },
    initialPosition: { pass: false, detail: "" },
    watch: { pass: false, detail: "" },
    cleanup: { pass: false, detail: "" },
  };

  // 1. API presence.
  const hasApi = typeof navigator !== "undefined" && "geolocation" in navigator;
  report.geolocationApi = {
    pass: hasApi,
    detail: hasApi ? "navigator.geolocation exists" : "navigator.geolocation is missing (insecure origin or unsupported browser)",
  };
  if (!hasApi) return report;

  // 2. Secure context.
  const secure = window.isSecureContext === true;
  report.secureContext = {
    pass: secure,
    detail: secureContextDetail(),
  };
  if (!secure) return report;

  // 3. Permission state (best effort — Safari may reject the query).
  try {
    if (navigator.permissions && "query" in navigator.permissions) {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      report.permission = {
        pass: true,
        state: status.state.toUpperCase(),
        detail: `Permissions API: ${status.state}`,
      };
    } else {
      report.permission = {
        pass: true,
        state: "UNKNOWN",
        detail: "Permissions API not available in this browser",
      };
    }
  } catch {
    report.permission = {
      pass: true,
      state: "UNKNOWN",
      detail: "Permissions API query rejected (Safari)",
    };
  }

  // 4. One-shot position.
  try {
    const pos = await waitForPosition(timeoutMs);
    report.initialPosition = {
      pass: true,
      detail: `lat ${pos.coords.latitude.toFixed(5)}, lng ${pos.coords.longitude.toFixed(5)}, accuracy ${Math.round(pos.coords.accuracy)} m`,
    };
  } catch (err) {
    const code = (err as GeolocationPositionError)?.code;
    report.initialPosition = {
      pass: false,
      detail: `getCurrentPosition failed (${errorLabel(code)}: ${(err as Error)?.message ?? String(err)})`,
    };
    return report;
  }

  // 5. Watch round-trip + cleanup.
  try {
    const { position } = await waitForWatch(timeoutMs);
    report.watch = {
      pass: true,
      detail: `watchPosition delivered a fix (accuracy ${Math.round(position.coords.accuracy)} m)`,
    };
    report.cleanup = { pass: true, detail: "clearWatch called after the fix" };
  } catch (err) {
    const code = (err as GeolocationPositionError)?.code;
    report.watch = {
      pass: false,
      detail: `watchPosition failed (${errorLabel(code)}: ${(err as Error)?.message ?? String(err)})`,
    };
    report.cleanup = { pass: true, detail: "stray watcher cleared by the safety net" };
  }

  return report;
}

function errorLabel(code: number | undefined): string {
  switch (code) {
    case 1:
      return "PERMISSION_DENIED";
    case 2:
      return "POSITION_UNAVAILABLE";
    case 3:
      return "TIMEOUT";
    default:
      return "UNKNOWN";
  }
}