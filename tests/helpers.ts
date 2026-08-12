import { vi } from "vitest";

/** Mints a synthetic, unsigned N3-shaped token. Never a real credential. */
export function syntheticToken(payload: Record<string, unknown>) {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signaturesignature`;
}

/** Bound to the synthetic tenant code used by `basicInfo`, with exact sys-admin. */
export const OWNER_TOKEN = syntheticToken({ tenantCode: "ACME", roles: "sys-admin" });
export const USER_TOKEN = syntheticToken({ tenantCode: "ACME", roles: "user" });

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

// ---------------------------------------------------------------------------
// Chainable Supabase test double
// ---------------------------------------------------------------------------

export type DbCall = {
  table: string;
  op: string;
  row?: unknown;
  filters?: Record<string, unknown>;
};

type TableFixture = {
  /** Rows returned by select reads on this table. */
  rows?: unknown[];
  /** Row returned by insert/upsert ... select().single()/maybeSingle(). */
  returning?: unknown;
  /** When set, every operation on this table fails with this error. */
  error?: { message: string } | null;
};

export type MockSupabase = {
  client: { from: (table: string) => unknown; rpc: (fn: string, args: unknown) => unknown };
  calls: DbCall[];
  fixtures: Record<string, TableFixture>;
  rpcResults: Record<string, { data?: unknown; error?: { message: string } | null }>;
  reset: () => void;
};

/**
 * A small, faithful stand-in for the PostgREST builder: every filter and
 * modifier returns the same thenable chain, so production code can call
 * `.select().eq().order().limit().maybeSingle()` in any order.
 */
export function createMockSupabase(
  fixtures: Record<string, TableFixture> = {},
  rpcResults: Record<string, { data?: unknown; error?: { message: string } | null }> = {},
): MockSupabase {
  const calls: DbCall[] = [];
  const state: MockSupabase = {
    calls,
    fixtures,
    rpcResults,
    client: { from: () => ({}), rpc: () => ({}) },
    reset: () => {
      calls.length = 0;
    },
  };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "select";
    let row: unknown;

    const fixture = () => state.fixtures[table] ?? {};
    const listResult = () => ({
      data: fixture().rows ?? [],
      error: fixture().error ?? null,
      count: (fixture().rows ?? []).length,
    });
    const singleResult = () => ({
      data: op === "select" ? ((fixture().rows ?? [])[0] ?? null) : (fixture().returning ?? null),
      error: fixture().error ?? null,
    });

    const record = () => calls.push({ table, op, row, filters: { ...filters } });

    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      or: () => chain,
      not: () => chain,
      maybeSingle: async () => {
        record();
        return singleResult();
      },
      single: async () => {
        record();
        return singleResult();
      },
      then: (resolve: (value: unknown) => unknown) => {
        record();
        return Promise.resolve(listResult()).then(resolve);
      },
    };

    for (const filter of ["eq", "neq", "in", "gte", "lte", "ilike", "is"]) {
      chain[filter] = (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      };
    }
    for (const write of ["insert", "upsert", "update", "delete"]) {
      chain[write] = (value?: unknown) => {
        op = write;
        row = value;
        return chain;
      };
    }
    return chain;
  };

  state.client = {
    from,
    rpc: async (fn: string, args: unknown) => {
      calls.push({ table: `rpc:${fn}`, op: "rpc", row: args });
      return state.rpcResults[fn] ?? { data: null, error: null };
    },
  };
  return state;
}
