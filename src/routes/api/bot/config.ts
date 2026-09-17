import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/bot/config")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          ok: true,
          message: "Bot config API is working",
        });
      },
    },
  },
});
