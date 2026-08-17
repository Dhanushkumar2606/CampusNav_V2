/**
 * Minimal local JWT inspection: payload decoding + expiry check only.
 *
 * The server remains the single authority on validity (signature, issuer,
 * user existence). This is used exclusively to avoid sending a token whose
 * `exp` has already passed — the UI can then ask for a fresh login instead
 * of surfacing a raw "401 Unauthorized".
 */

export interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  iss?: string;
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  try {
    return decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  } catch {
    return atob(padded);
  }
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

/** True when the token carries an `exp` that has already passed (skew-safe). */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
}