import { createFileRoute } from "@tanstack/react-router";

/** DEV ONLY — Path B API-key connect. 404 in production. */
export const Route = createFileRoute("/api/public/auth/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleConnectRequest } = await import("@/lib/n3-connect.server");
        return handleConnectRequest(request);
      },
    },
  },
});
