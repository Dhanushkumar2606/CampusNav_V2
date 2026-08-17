/**
 * Nova auth-chain tests (AUTH-NOVA-06/07):
 * - the request carries the app-wide `Authorization: Bearer <JWT>` header;
 * - an already-expired local token never reaches the network — the caller
 *   gets a clear session message instead of a raw 401;
 * - a server-side 401/403 maps to the same graceful session error;
 * - the request body carries no provider credential material.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { assistantQuery, SessionExpiredError } from "@/api/assistant";
import { decodeJwtPayload, isJwtExpired } from "@/lib/jwt";

/** JWT with sub + iat + exp. `ttlSeconds` offsets from now by the sign. */
function makeToken(opts: { ttlSeconds?: number } = {}): string {
  const { ttlSeconds = 3600 } = opts;
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(
    JSON.stringify({ sub: "11111111-1111-1111-1111-111111111111", iat: now, exp: now + ttlSeconds }),
  ).replace(/=+$/, "");
  return `${header}.${payload}.fakesig`;
}

describe("AUTH-NOVA-06 shared authenticated API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches Authorization: Bearer <JWT> on every Nova request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "info", text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = makeToken();
    await assistantQuery(token, "main gate to library", "srm");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/assistant/query");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });
});

describe("AUTH-NOVA-05 expired-token handling (client side)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects an expired JWT payload", () => {
    const dead = makeToken({ ttlSeconds: -60 });
    expect(decodeJwtPayload(dead)?.exp).toBeLessThan(Date.now() / 1000);
    expect(isJwtExpired(dead)).toBe(true);
  });

  it("never sends an expired token: fails fast with a session message", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const dead = makeToken({ ttlSeconds: -60 });
    await expect(assistantQuery(dead, "hello nova")).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a server-side 401 to a graceful session error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Could not validate credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(assistantQuery(makeToken(), "where is the library?")).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});

describe("AUTH-NOVA-07 no provider credentials in the request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the request body is the typed assistant payload only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: "search", text: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await assistantQuery(makeToken(), "test query", "srm-slug", "node-uuid", 15, 12.9, 80.2);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "campus_slug",
      "query",
      "time_constraint_min",
      "user_lat",
      "user_lng",
      "user_location",
    ]);
    const raw = String(init.body);
    expect(raw).not.toMatch(/sk-/i);
    expect(raw).not.toMatch(/api_?key|secret|password/i);
  });
});