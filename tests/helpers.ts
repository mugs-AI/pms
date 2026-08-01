import { vi } from "vitest";

export const OWNER_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc";
export const USER_TOKEN = "dddddddddddddddddddddddd.eeeeeeeeeeee.ffffffffffff";

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function basicInfo(overrides: Record<string, unknown> = {}) {
  return {
    code: "0000",
    success: true,
    data: {
      companyName: "Acme Builders Sdn Bhd",
      tenantCode: "ACME",
      tenantId: "11111111-2222-3333-4444-555555555555",
      userId: "user-guid-1",
      email: "owner@acme.test",
      isOwner: true,
      ...overrides,
    },
  };
}

/** Records every upstream call so tests can assert nothing reached N3. */
export function mockUpstream(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}
