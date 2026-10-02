import type { Pool, PoolClient } from "pg";
import {
  capabilityActivationOrder,
  capabilityDeactivationOrder,
  INSTALLATION_CAPABILITIES,
} from "./installation-capabilities.ts";
import {
  runInstallationHealthCheck,
  type InstallationHealthResult,
} from "./installation-health.ts";
import type { InstallationOperationForOrchestrator } from "./installation-types.ts";

type OrchestratorSettings = {
  response_policy?: unknown;
  member_message_policy?: unknown;
  command_policy?: unknown;
  command_mode?: unknown;
  automation_enabled?: unknown;
  security_mode?: unknown;
  audit_enabled?: unknown;
};

export type InstallationOrchestratorResult = {
  version: string;
  permissionSnapshot: Record<string, unknown>;
  health: InstallationHealthResult;
};

function settingsPatch(
  settings: unknown,
  reset = false,
): OrchestratorSettings {
  const source =
    settings &&
    typeof settings === "object" &&
    !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};

  const patch: OrchestratorSettings = {};

  const stringKeys = [
    "response_policy",
    "member_message_policy",
    "command_policy",
    "command_mode",
    "security_mode",
  ] as const;

  for (const key of stringKeys) {
    if (typeof source[key] === "string") {
      patch[key] = source[key];
    }
  }

  for (const key of ["automation_enabled", "audit_enabled"] as const) {
    if (typeof source[key] === "boolean") {
      patch[key] = source[key];
    }
  }

  if (reset) {
    patch.response_policy = "standard";
    patch.member_message_policy = "silent";
    patch.command_policy = "enabled";
    patch.command_mode = "plain";
    patch.automation_enabled = false;
    patch.security_mode = "standard";
    patch.audit_enabled = true;
  }

  return patch;
}

async function markGroupMigration(
  client: PoolClient,
  groupId: number,
  targetVersion: string,
) {
  await client.query(
    "INSERT INTO bot_installation_orchestrator_migrations(" +
      "group_id,migration_id,version,status,metadata" +
      ") VALUES($1,$2,$3,'APPLIED',$4::jsonb) " +
      "ON CONFLICT(group_id,migration_id) DO UPDATE SET " +
      "version=EXCLUDED.version,status='APPLIED',applied_at=NOW(),metadata=EXCLUDED.metadata",
    [
      String(groupId),
      "installation-orchestrator-v1",
      targetVersion,
      JSON.stringify({ source: "stage8" }),
    ],
  );
}

async function setCapabilitiesInstalling(
  client: PoolClient,
  groupId: number,
) {
  for (const definition of INSTALLATION_CAPABILITIES) {
    await client.query(
      "INSERT INTO bot_installation_capabilities(" +
        "group_id,capability_id,status,version,dependencies,metadata" +
        ") VALUES($1,$2,'INSTALLING',$3,$4::jsonb,$5::jsonb) " +
        "ON CONFLICT(group_id,capability_id) DO UPDATE SET " +
        "status='INSTALLING',version=EXCLUDED.version,dependencies=EXCLUDED.dependencies," +
        "updated_at=NOW(),failure_code=NULL,failure_message=NULL",
      [
        String(groupId),
        definition.id,
        definition.version,
        JSON.stringify(definition.dependencies),
        JSON.stringify({ label: definition.label, required: definition.required }),
      ],
    );
  }
}

async function activateCapabilities(
  client: PoolClient,
  groupId: number,
) {
  const order = capabilityActivationOrder();

  for (const definition of order) {
    if (definition.dependencies.length) {
      const dependencies = await client.query(
        "SELECT capability_id,status FROM bot_installation_capabilities " +
          "WHERE group_id=$1 AND capability_id = ANY($2::text[])",
        [String(groupId), definition.dependencies],
      );
      const state = new Map(
        dependencies.rows.map((row) => [
          String(row.capability_id),
          String(row.status),
        ]),
      );
      for (const dependency of definition.dependencies) {
        if (state.get(dependency) !== "INSTALLED") {
          throw new Error(
            "Dependency فعال نشده است: " +
              definition.id +
              " -> " +
              dependency,
          );
        }
      }
    }

    await client.query(
      "UPDATE bot_installation_capabilities SET " +
        "status='INSTALLED',activated_at=COALESCE(activated_at,NOW()),disabled_at=NULL," +
        "updated_at=NOW() WHERE group_id=$1 AND capability_id=$2",
      [String(groupId), definition.id],
    );
  }
}

async function disableCapabilities(
  client: PoolClient,
  groupId: number,
) {
  for (const definition of capabilityDeactivationOrder()) {
    await client.query(
      "UPDATE bot_installation_capabilities SET " +
        "status='DISABLING',updated_at=NOW() " +
        "WHERE group_id=$1 AND capability_id=$2",
      [String(groupId), definition.id],
    );

    await client.query(
      "UPDATE bot_installation_capabilities SET " +
        "status='DISABLED',disabled_at=NOW(),updated_at=NOW() " +
        "WHERE group_id=$1 AND capability_id=$2",
      [String(groupId), definition.id],
    );
  }
}

async function attachRuntime(
  client: PoolClient,
  groupId: number,
  version: string,
  executionId?: string,
) {
  await client.query(
    "INSERT INTO bot_installation_runtime(" +
      "group_id,status,version,execution_id,attached_at,detached_at,metadata" +
      ") VALUES($1,'HEALTHY',$2,$3,NOW(),NULL,$4::jsonb) " +
      "ON CONFLICT(group_id) DO UPDATE SET " +
      "status='HEALTHY',version=EXCLUDED.version,execution_id=EXCLUDED.execution_id," +
      "attached_at=NOW(),detached_at=NULL,metadata=EXCLUDED.metadata",
    [
      String(groupId),
      version,
      executionId ?? null,
      JSON.stringify({ source: "installation-orchestrator" }),
    ],
  );
}

async function detachRuntime(
  client: PoolClient,
  groupId: number,
  executionId?: string,
) {
  await client.query(
    "INSERT INTO bot_installation_runtime(" +
      "group_id,status,version,execution_id,attached_at,detached_at,metadata" +
      ") VALUES($1,'DETACHED','', $2,NULL,NOW(),$3::jsonb) " +
      "ON CONFLICT(group_id) DO UPDATE SET " +
      "status='DETACHED',execution_id=EXCLUDED.execution_id,detached_at=NOW()," +
      "metadata=EXCLUDED.metadata",
    [
      String(groupId),
      executionId ?? null,
      JSON.stringify({ source: "installation-orchestrator" }),
    ],
  );
}

async function applyConfiguration(
  client: PoolClient,
  groupId: number,
  operation: InstallationOperationForOrchestrator,
  targetVersion: string,
  permissionSnapshot: Record<string, unknown>,
  session: any,
) {
  const patch = settingsPatch(
    session.settings,
    operation === "reinstall" || operation === "repair",
  );

  const query = [
    "UPDATE bot_group_installations SET installation_version=$2",
    "bot_permission_snapshot=$3::jsonb",
    "response_policy=COALESCE($4,response_policy)",
    "member_message_policy=COALESCE($5,member_message_policy)",
    "command_policy=COALESCE($6,command_policy)",
    "command_mode=COALESCE($7,command_mode)",
    "automation_enabled=COALESCE($8,automation_enabled)",
    "security_mode=COALESCE($9,security_mode)",
    "audit_enabled=COALESCE($10,audit_enabled)",
    "updated_at=NOW()",
    "WHERE group_id=$1",
  ].join(",");

  if (operation === "repair" || operation === "reinstall") {
    await client.query(
      query,
      [
        String(groupId),
        targetVersion,
        JSON.stringify(permissionSnapshot),
        patch.response_policy ?? "standard",
        patch.member_message_policy ?? "silent",
        patch.command_policy ?? "enabled",
        patch.command_mode ?? "plain",
        patch.automation_enabled ?? false,
        patch.security_mode ?? "standard",
        patch.audit_enabled ?? true,
      ],
    );
    return;
  }

  await client.query(
    query,
    [
      String(groupId),
      targetVersion,
      JSON.stringify(permissionSnapshot),
      patch.response_policy ?? null,
      patch.member_message_policy ?? null,
      patch.command_policy ?? null,
      patch.command_mode ?? null,
      patch.automation_enabled ?? null,
      patch.security_mode ?? null,
      patch.audit_enabled ?? null,
    ],
  );
}

export async function ensureInstallationOrchestratorSchema(pool: Pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_capabilities (" +
      "group_id BIGINT NOT NULL," +
      "capability_id TEXT NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'NOT_INSTALLED'," +
      "version TEXT NOT NULL DEFAULT '1'," +
      "dependencies JSONB NOT NULL DEFAULT '[]'::jsonb," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "activated_at TIMESTAMPTZ," +
      "disabled_at TIMESTAMPTZ," +
      "failure_code TEXT," +
      "failure_message TEXT," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "PRIMARY KEY(group_id,capability_id)" +
      ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_runtime (" +
      "group_id BIGINT PRIMARY KEY," +
      "status TEXT NOT NULL DEFAULT 'DETACHED'," +
      "version TEXT NOT NULL DEFAULT ''," +
      "execution_id TEXT," +
      "attached_at TIMESTAMPTZ," +
      "detached_at TIMESTAMPTZ," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_orchestrator_migrations (" +
      "group_id BIGINT NOT NULL," +
      "migration_id TEXT NOT NULL," +
      "version TEXT NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'PENDING'," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "PRIMARY KEY(group_id,migration_id)" +
      ")",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_capabilities_group " +
      "ON bot_installation_capabilities(group_id,status)",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_runtime_status " +
      "ON bot_installation_runtime(status,updated_at DESC)",
  );
}

export async function executeInstallationOrchestration(
  client: PoolClient,
  params: {
    groupId: number;
    actorId: number;
    operation: InstallationOperationForOrchestrator;
    targetVersion: string;
    permissionSnapshot: Record<string, unknown>;
    session: any;
    executionId: string;
  },
): Promise<InstallationOrchestratorResult> {
  const {
    groupId,
    actorId,
    operation,
    targetVersion,
    permissionSnapshot,
    session,
    executionId,
  } = params;

  const current = (
    await client.query(
      "SELECT * FROM bot_group_installations WHERE group_id=$1 FOR UPDATE",
      [String(groupId)],
    )
  ).rows[0];

  if (!current) {
    throw new Error("رکورد نصب گروه پیدا نشد.");
  }

  const currentlyInstalled = Boolean(current.installed);

  if (operation === "install" && currentlyInstalled) {
    throw new Error("گروه از قبل نصب شده است.");
  }

  if (
    ["update", "repair", "reinstall", "uninstall"].includes(operation) &&
    !currentlyInstalled
  ) {
    throw new Error(
      operation === "uninstall"
        ? "گروه از قبل حذف نصب شده است."
        : operation === "update"
          ? "برای به‌روزرسانی، گروه باید نصب شده باشد."
          : operation === "repair"
            ? "برای تعمیر، گروه باید نصب شده باشد."
            : "برای نصب مجدد، گروه باید نصب شده باشد.",
    );
  }

  await markGroupMigration(client, groupId, targetVersion);

  if (operation === "uninstall") {
    await client.query(
      "UPDATE bot_group_installations SET " +
        "command_policy='disabled',automation_enabled=FALSE,updated_at=NOW() " +
        "WHERE group_id=$1",
      [String(groupId)],
    );

    await disableCapabilities(client, groupId);
    await detachRuntime(client, groupId, executionId);

    const health = await runInstallationHealthCheck(client, {
      groupId,
      operation,
      targetVersion,
    });

    if (!health.ok) {
      throw new Error(
        "Health Check حذف نصب ناموفق بود: " + health.issues.join(" | "),
      );
    }

    await client.query(
      "UPDATE bot_group_installations SET " +
        "installed=FALSE,uninstalled_at=NOW(),uninstalled_by=$2," +
        "command_policy='disabled',automation_enabled=FALSE,updated_at=NOW() " +
        "WHERE group_id=$1",
      [String(groupId), String(actorId)],
    );

    return {
      version: targetVersion,
      permissionSnapshot,
      health,
    };
  }

  if (operation === "reinstall") {
    await disableCapabilities(client, groupId);
    await detachRuntime(client, groupId, executionId);
  }

  await setCapabilitiesInstalling(client, groupId);
  await applyConfiguration(
    client,
    groupId,
    operation,
    targetVersion,
    permissionSnapshot,
    session,
  );
  await activateCapabilities(client, groupId);
  await attachRuntime(client, groupId, targetVersion, executionId);

  const health = await runInstallationHealthCheck(client, {
    groupId,
    operation,
    targetVersion,
  });

  if (!health.ok) {
    throw new Error(
      "Health Check نصب ناموفق بود: " + health.issues.join(" | "),
    );
  }

  // Important: installed=true is a final state. It is intentionally written
  // only after configuration, capability activation, runtime registration,
  // and Health Check all succeed in the same database transaction.
  await client.query(
    "UPDATE bot_group_installations SET " +
      "installed=TRUE,installed_at=COALESCE(installed_at,NOW()),installed_by=COALESCE(installed_by,$2)," +
      "uninstalled_at=NULL,uninstalled_by=NULL," +
      "installation_version=$3,bot_permission_snapshot=$4::jsonb,updated_at=NOW() " +
      "WHERE group_id=$1",
    [
      String(groupId),
      String(actorId),
      targetVersion,
      JSON.stringify(permissionSnapshot),
    ],
  );

  return {
    version: targetVersion,
    permissionSnapshot,
    health,
  };
}
