import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin ProjectHub business API. Every request resolves the ProjectHub
 * actor from live N3 BasicInfo before any database or N3 access.
 */
const handle = async ({ params, request }: { params: unknown; request: Request }) => {
  const { handleProjectHubRequest } = await import("@/lib/projecthub-api.server");
  return handleProjectHubRequest(request, (params as { _splat?: string })._splat ?? "");
};

export const Route = createFileRoute("/api/projecthub/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PATCH: handle,
      PUT: handle,
      DELETE: handle,
    },
  },
});
