import type { Pool } from "pg";
import {
  INSTALLATION_CAPABILITIES,
  capabilityMap,
} from "./installation-capabilities.ts";
import { ensureInstallationOrchestratorSchema } from "./installation-orchestrator.ts";

export type InstallationReconcileResult = {
  scanned: number;
  reconciled: number;
  healthy: number;
  degraded: number;
};

export async function reconcileInstallationState(pool: Pool): Promise<InstallationReconcileResult> {
  await ensureInstallationOrchestratorSchema(pool);

  const groups = await pool.query<{
    group_id: string;
    installed: boolean;
    installation_version: string;
  }>(
    "SELECT group_id,installed,installation_version " +
      "FROM bot_group_installations ORDER BY group_id",
  );

  const result: InstallationReconcileResult = {
    scanned: groups.rows.length,
    reconciled: 0,
    healthy: 0,
    degraded: 0,
  };

  const definitions = capabilityMap();

  for (const group of groups.rows) {
    const groupId = String(group.group_id);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        ["installation-reconcile:" + groupId],
      );

      if (Boolean(group.installed)) {
        let changed = false;

        for (const definition of INSTALLATION_CAPABILITIES) {
          const existing = await client.query(
            "SELECT status,version FROM bot_installation_capabilities " +
              "WHERE group_id=$1 AND capability_id=$2 LIMIT 1",
            [groupId, definition.id],
          );

          if (!existing.rows[0]) {
            await client.query(
              "INSERT INTO bot_installation_capabilities(" +
                "group_id,capability_id,status,version,dependencies,metadata" +
                ") VALUES($1,$2,'INSTALLED',$3,$4::jsonb,$5::jsonb)",
              [
                groupId,
                definition.id,
                definition.version,
                JSON.stringify(definition.dependencies),
                JSON.stringify({
                  label: definition.label,
                  required: definition.required,
                  source: "legacy-reconcile",
                }),
              ],
            );
            changed = true;
          } else if (
            String(existing.rows[0].status) !== "INSTALLED" ||
            String(existing.rows[0].version) !== definition.version
          ) {
            // Never downgrade a known working state during reconciliation.
            // Record the discrepancy instead of rewriting an active capability.
            await client.query(
              "UPDATE bot_installation_capabilities SET " +
                "failure_code='LEGACY_STATE_MISMATCH',failure_message=$3,updated_at=NOW() " +
                "WHERE group_id=$1 AND capability_id=$2",
              [
                groupId,
                definition.id,
                "Legacy installed state is inconsistent with the Orchestrator registry.",
              ],
            );
          }
        }

        const runtime = await client.query(
          "SELECT status,version FROM bot_installation_runtime " +
            "WHERE group_id=$1 LIMIT 1",
          [groupId],
        );

        if (!runtime.rows[0]) {
          await client.query(
            "INSERT INTO bot_installation_runtime(" +
              "group_id,status,version,metadata" +
              ") VALUES($1,'LEGACY',$2,$3::jsonb)",
            [
              groupId,
              String(group.installation_version || ""),
              JSON.stringify({
                source: "legacy-reconcile",
                requires_health_check: true,
              }),
            ],
          );
          changed = true;
        }

        await client.query(
          "INSERT INTO bot_installation_orchestrator_migrations(" +
            "group_id,migration_id,version,status,metadata" +
            ") VALUES($1,'installation-orchestrator-v1',$2,'RECONCILED',$3::jsonb) " +
            "ON CONFLICT(group_id,migration_id) DO NOTHING",
          [
            groupId,
            String(group.installation_version || ""),
            JSON.stringify({ source: "stage9", changed }),
          ],
        );

        if (changed) result.reconciled += 1;
        if (runtime.rows[0] && String(runtime.rows[0].status) === "HEALTHY") {
          result.healthy += 1;
        } else {
          result.degraded += 1;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[installation-reconcile] failed:", {
        group_id: groupId,
        error: String((error as any)?.message ?? error),
      });
      result.degraded += 1;
    } finally {
      client.release();
    }
  }

  // Keep the import useful as a runtime registry integrity assertion.
  if (definitions.size !== INSTALLATION_CAPABILITIES.length) {
    throw new Error("Capability Registry integrity check failed.");
  }

  return result;
}
