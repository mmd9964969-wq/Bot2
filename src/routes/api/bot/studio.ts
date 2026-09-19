import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { cloneStudioDefaults, type StudioDocument } from "@/lib/bot/studio";

export const Route = createFileRoute("/api/bot/studio")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sql = await getSql();
          const rows = await sql.query<{ config: StudioDocument }>(
            "select config from bot_studio_panel where id = 1 limit 1",
          );
          const stored = rows[0]?.config;
          return Response.json({
            ok: true,
            document: mergeDocument(stored),
          });
        } catch (error) {
          console.error("[studio] GET failed", error);
          return Response.json(
            { ok: false, error: "studio_read_failed" },
            { status: 500 },
          );
        }
      },

      PUT: async ({ request }) => {
        try {
          const body = (await request.json()) as Partial<StudioDocument>;
          const current = cloneStudioDefaults();
          const document = mergeDocument({
            ...current,
            ...body,
            settings: {
              ...current.settings,
              ...(body.settings ?? {}),
            },
            capabilities: Array.isArray(body.capabilities)
              ? body.capabilities
              : current.capabilities,
            commands: Array.isArray(body.commands)
              ? body.commands
              : current.commands,
            updatedAt: new Date().toISOString(),
          });

          const sql = await getSql();
          await sql.query(
            "insert into bot_studio_panel (id, config, updated_at) values (1, $1::jsonb, current_timestamp) on conflict (id) do update set config = excluded.config, updated_at = current_timestamp",
            [JSON.stringify(document)],
          );

          return Response.json({ ok: true, document });
        } catch (error) {
          console.error("[studio] PUT failed", error);
          return Response.json(
            { ok: false, error: "studio_write_failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});

function mergeDocument(stored?: Partial<StudioDocument> | null): StudioDocument {
  const base = cloneStudioDefaults();

  if (!stored) return base;

  return {
    ...base,
    ...stored,
    settings: {
      ...base.settings,
      ...(stored.settings ?? {}),
    },
    capabilities: Array.isArray(stored.capabilities)
      ? stored.capabilities
      : base.capabilities,
    commands: base.commands.map((b) => ({
      ...b,
      ...(Array.isArray(stored.commands)
        ? stored.commands.find((x) => x.id === b.id)
        : undefined),
    })),
    updatedAt: stored.updatedAt || base.updatedAt,
  };
}
