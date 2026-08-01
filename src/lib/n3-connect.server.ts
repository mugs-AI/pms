/**
 * DEV ONLY — Path B API-key connect. The key is exchanged server-side, never
 * stored and never logged. Returns 404 when NODE_ENV === "production".
 */
import { z } from "zod";
import { getBaseUrl, isDevRuntime, newCorrelationId, UPSTREAM_TIMEOUT_MS } from "./n3-api.server";

const BodySchema = z.object({ apiKey: z.string().min(8).max(512) });

type JwtTokenData = { token?: string; expiration?: string };

export async function handleConnectRequest(request: Request): Promise<Response> {
  if (!isDevRuntime()) {
    return new Response("Not found", { status: 404 });
  }
  const correlationId = newCorrelationId();

  let apiKey: string;
  try {
    apiKey = BodySchema.parse(await request.json()).apiKey;
  } catch {
    return Response.json(
      { code: "PROXY", success: false, message: "An API key is required", correlationId },
      { status: 400 },
    );
  }

  const url = `${getBaseUrl("main")}/api/auth/connect?api-key=${encodeURIComponent(apiKey)}`;
  apiKey = "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
      data?: JwtTokenData;
    } | null;

    if (!body || body.code !== "0000" || !body.data?.token) {
      return Response.json(
        {
          code: "PROXY",
          success: false,
          message: "Connect failed — check the API key",
          correlationId,
        },
        { status: res.ok ? 400 : res.status },
      );
    }

    return Response.json({
      token: body.data.token,
      expiration: body.data.expiration ?? null,
      correlationId,
    });
  } catch {
    return Response.json(
      { code: "PROXY", success: false, message: "N3 Open API unreachable", correlationId },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
