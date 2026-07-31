import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ apiKey: z.string().min(8).max(512) });

type JwtTokenData = {
  token?: string;
  expiration?: string;
  company?: string;
  tenantCode?: string;
  email?: string;
};

/**
 * DEV ONLY — Path B API-key connect. Proxies the connect exchange server-side.
 * Returns 404 when NODE_ENV === 'production'.
 */
export const Route = createFileRoute("/api/public/auth/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getBaseUrl, isDevRuntime } = await import("@/lib/n3-api.server");
        if (!isDevRuntime()) {
          return new Response("Not found", { status: 404 });
        }

        let parsed;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return Response.json(
            { code: "PROXY", success: false, message: "An API key is required" },
            { status: 400 },
          );
        }

        const url = `${getBaseUrl("main")}/api/auth/connect?api-key=${encodeURIComponent(parsed.apiKey)}`;
        parsed = { apiKey: "" };

        try {
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          const body = (await res.json().catch(() => null)) as {
            code?: string;
            message?: string;
            data?: JwtTokenData;
          } | null;

          if (!body || body.code !== "0000" || !body.data?.token) {
            return Response.json(
              {
                code: body?.code ?? "PROXY",
                success: false,
                message: body?.message ?? "Connect failed — check the API key",
              },
              { status: res.ok ? 400 : res.status },
            );
          }

          const d = body.data;
          return Response.json({
            token: d.token,
            expiration: d.expiration ?? null,
            company: d.company ?? null,
            tenantCode: d.tenantCode ?? null,
            email: d.email ?? null,
          });
        } catch {
          return Response.json(
            { code: "PROXY", success: false, message: "N3 Open API unreachable" },
            { status: 502 },
          );
        }
      },
    },
  },
});