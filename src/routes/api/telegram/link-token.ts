import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { db } from "../../../lib/db.ts";

export const Route = createFileRoute("/api/telegram/link-token")({
  server: {
    handlers: {
      POST: async ({ context }) => {
        const userId = context.userId;

        if (!userId) {
          return Response.json(
            {
              ok: false,
              error: "UNAUTHORIZED",
            },
            { status: 401 },
          );
        }

        const token = randomBytes(4)
          .toString("hex")
          .toUpperCase();

        const id = crypto.randomUUID();

        await db.execute(`
          delete from telegram_link_tokens
          where user_id = '${userId}'
             or expires_at < current_timestamp
        `);

        await db.execute(`
          insert into telegram_link_tokens
            (id, user_id, token, expires_at)
          values
            (
              '${id}',
              '${userId}',
              '${token}',
              current_timestamp + interval '10 minutes'
            )
        `);

        return Response.json({
          ok: true,
          token,
          expiresIn: 600,
        });
      },
    },
  },
});
