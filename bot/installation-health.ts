import type { PoolClient } from "pg";
import {
  INSTALLATION_CAPABILITIES,
  capabilityActivationOrder,
  type CapabilityStatus,
  type InstallationCapabilityDefinition,
} from "./installation-capabilities.ts";
import type { InstallationOperationForOrchestrator } from "./installation-types.ts";

export type InstallationHealthResult = {
  ok: boolean;
  status: "HEALTHY" | "DEGRADED" | "FAILED";
  issues: string[];
  checkedAt: string;
};

async function loadCapabilities(client: PoolClient, groupId: number) {
  const result = await client.query(
    "SELECT capability_id,status,version FROM bot_installation_capabilities " +
      "WHERE group_id=$1",
    [String(groupId)],
  );

  return new Map(
    result.rows.map((row) => [
      String(row.capability_id),
      {
        status: String(row.status) as CapabilityStatus,
        version: String(row.version ?? ""),
      },
    ]),
  );
}

async function requiredTablesReady(client: PoolClient) {
  const names = [
    "bot_group_installations",
    "bot_installation_events",
    "bot_installation_sessions",
    "bot_installation_progress",
    "bot_installation_capabilities",
    "bot_installation_runtime",
    "bot_installation_orchestrator_migrations",
  ];

  const result = await client.query(
    "SELECT name, to_regclass(name) AS regclass " +
      "FROM unnest($1::text[]) AS t(name)",
    [names],
  );

  return result.rows
    .filter((row) => !row.regclass)
    .map((row) => String(row.name));
}

export async function runInstallationHealthCheck(
  client: PoolClient,
  params: {
    groupId: number;
    operation: InstallationOperationForOrchestrator;
    targetVersion: string;
  },
): Promise<InstallationHealthResult> {
  const issues: string[] = [];

  const missingTables = await requiredTablesReady(client);
  if (missingTables.length) {
    issues.push("جداول Orchestrator ناقص هستند: " + missingTables.join("، "));
  }

  const group = (
    await client.query(
      "SELECT installed,installation_version,command_policy,automation_enabled " +
        "FROM bot_group_installations WHERE group_id=$1 LIMIT 1",
      [String(params.groupId)],
    )
  ).rows[0];

  if (!group) {
    issues.push("رکورد نصب گروه وجود ندارد.");
  }

  const runtime = (
    await client.query(
      "SELECT status,version FROM bot_installation_runtime " +
        "WHERE group_id=$1 LIMIT 1",
      [String(params.groupId)],
    )
  ).rows[0];

  const capabilities = await loadCapabilities(client, params.groupId);
  const ordered = capabilityActivationOrder(INSTALLATION_CAPABILITIES);

  if (["install", "update", "repair", "reinstall"].includes(params.operation)) {
    if (!runtime) {
      issues.push("Runtime registration برای گروه وجود ندارد.");
    } else if (String(runtime.status) !== "HEALTHY") {
      issues.push(
        "Runtime باید HEALTHY باشد؛ وضعیت فعلی: " + String(runtime.status),
      );
    } else if (String(runtime.version) !== params.targetVersion) {
      issues.push(
        "نسخهٔ Runtime با نسخهٔ هدف یکسان نیست: " +
          String(runtime.version) +
          " / " +
          params.targetVersion,
      );
    }

    for (const definition of ordered) {
      const row = capabilities.get(definition.id);
      if (!row || row.status !== "INSTALLED") {
        if (definition.required) {
          issues.push("Capability فعال نیست: " + definition.label);
        }
        continue;
      }

      for (const dependency of definition.dependencies) {
        const dependencyRow = capabilities.get(dependency);
        if (!dependencyRow || dependencyRow.status !== "INSTALLED") {
          issues.push(
            "Dependency غیرفعال است: " +
              definition.id +
              " -> " +
              dependency,
          );
        }
      }

      if (row.version !== definition.version) {
        issues.push(
          "نسخهٔ Capability نامعتبر است: " +
            definition.id +
            " / " +
            row.version +
            " / " +
            definition.version,
        );
      }
    }

    if (!group) {
      return {
        ok: false,
        status: "FAILED",
        issues,
        checkedAt: new Date().toISOString(),
      };
    }
  } else {
    if (!runtime) {
      issues.push("Runtime registration برای حذف نصب وجود ندارد.");
    } else if (String(runtime.status) !== "DETACHED") {
      issues.push(
        "Runtime باید DETACHED باشد؛ وضعیت فعلی: " + String(runtime.status),
      );
    }

    for (const definition of INSTALLATION_CAPABILITIES) {
      const row = capabilities.get(definition.id);
      if (row && row.status !== "DISABLED") {
        issues.push("Capability هنوز غیرفعال نشده است: " + definition.label);
      }
    }

    if (group && String(group.command_policy) !== "disabled") {
      issues.push("command_policy هنوز disabled نشده است.");
    }

    if (group && Boolean(group.automation_enabled)) {
      issues.push("automation_enabled هنوز false نشده است.");
    }
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "HEALTHY" : "FAILED",
    issues,
    checkedAt: new Date().toISOString(),
  };
}
