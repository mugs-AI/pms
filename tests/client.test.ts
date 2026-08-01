/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearToken,
  emailFromJwt,
  fetchN3Session,
  getToken,
  N3Error,
  setToken,
} from "@/lib/n3-client";

afterEach(() => {
  clearToken();
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

describe("browser session semantics", () => {
  it("11. N3 401 clears the browser token; N3 403 does not clear it", async () => {
    setToken("token-401");
    stubFetch(401, { code: "PROXY", message: "expired" });
    await expect(fetchN3Session()).rejects.toBeInstanceOf(N3Error);
    expect(getToken()).toBeNull();

    setToken("token-403");
    stubFetch(403, { code: "PROXY", message: "not owner" });
    await expect(fetchN3Session()).rejects.toBeInstanceOf(N3Error);
    expect(getToken()).toBe("token-403");
  });

  it("expired stored expiration invalidates the token", () => {
    setToken("stale", new Date(Date.now() - 1000).toISOString());
    expect(getToken()).toBeNull();
    setToken("fresh", new Date(Date.now() + 60_000).toISOString());
    expect(getToken()).toBe("fresh");
  });

  it("10b. JWT email decodes safely as a display-only fallback", () => {
    // {"email":"person@acme.test"} base64url without padding
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6InBlcnNvbkBhY21lLnRlc3QifQ.sig";
    expect(emailFromJwt(token)).toBe("person@acme.test");
    // {"email":["","team@acme.test"]}
    const arrayToken = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6WyIiLCJ0ZWFtQGFjbWUudGVzdCJdfQ.sig";
    expect(emailFromJwt(arrayToken)).toBe("team@acme.test");
    expect(emailFromJwt("garbage")).toBeNull();
    expect(emailFromJwt("a.!!!!.c")).toBeNull();
  });
});
