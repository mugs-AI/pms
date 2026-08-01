import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin read-only boundary to N3 Open API.
 * Path shape: /api/public/n3/main/<allowlisted open-api path>?<bounded odata>
 * Only GET is allowed and only allowlisted operations can ever reach N3.
 */
export const Route = createFileRoute("/api/public/n3/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { handleN3ProxyRequest, handleSessionRequest } =
          await import("@/lib/n3-proxy.server");
        const splat = (params as { _splat?: string })._splat ?? "";
        if (splat === "session") return handleSessionRequest(request);
        return handleN3ProxyRequest(request, splat);
      },
      POST: async () => (await import("@/lib/n3-proxy.server")).methodNotAllowed(),
      PUT: async () => (await import("@/lib/n3-proxy.server")).methodNotAllowed(),
      PATCH: async () => (await import("@/lib/n3-proxy.server")).methodNotAllowed(),
      DELETE: async () => (await import("@/lib/n3-proxy.server")).methodNotAllowed(),
    },
  },
});
