import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin read-only proxy to N3 Open API.
 * Path shape: /api/public/n3/<main|reporting>/<open-api-path>?<odata>
 * Only GET is allowed — this starter performs no N3 writes.
 */
export const Route = createFileRoute("/api/public/n3/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { n3Get } = await import("@/lib/n3-api.server");
        const splat = (params as { _splat?: string })._splat ?? "";
        const [targetSegment, ...rest] = splat.split("/");
        const target = targetSegment === "reporting" ? "reporting" : "main";
        const path = rest.join("/");

        if (!path) {
          return Response.json(
            { code: "PROXY", success: false, message: "Missing Open API path" },
            { status: 400 },
          );
        }

        const auth = request.headers.get("authorization");
        if (!auth) {
          return Response.json(
            { code: "PROXY", success: false, message: "Missing bearer token" },
            { status: 401 },
          );
        }

        const search = new URL(request.url).search;
        try {
          const { status, body } = await n3Get(target, path, search, auth);
          return Response.json(body, { status });
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