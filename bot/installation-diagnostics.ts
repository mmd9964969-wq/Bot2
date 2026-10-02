import type { Pool } from "pg";
import {
  INSTALLATION_CAPABILITIES,
  capabilityActivationOrder,
} from "./installation-capabilities.ts";
import {
  runInstallationHealthCheck,
  type InstallationHealthResult,
} from "./installation-health.ts";

export type InstallationDiagnostic = {
  health: InstallationHealthResult;
  installed: boolean;
  version: string;
  runtimeStatus: string;
  capabilityCounts: {
    installed: number;
    disabled: number;
    installing: number;
    failed: number;
    other: number;
  };
};

export async function diagnoseInstallation(
  pool: Pool,
  groupId: number,
): Promise<InstallationDiagnostic> {
  const row = (
    await pool.query(
      "SELECT installed,installation_version FROM bot_group_installations " +
        "WHERE group_id=$1 LIMIT 1",
      [String(groupId)],
    )
  ).rows[0];

  if (!row) {
    throw new Error("رکورد نصب گروه پیدا نشد.");
  }

  const runtime = (
    await pool.query(
      "SELECT status,version FROM bot_installation_runtime " +
        "WHERE group_id=$1 LIMIT 1",
      [String(groupId)],
    )
  ).rows[0];

  const counts = {
    installed: 0,
    disabled: 0,
    installing: 0,
    failed: 0,
    other: 0,
  };

  const rows = await pool.query(
    "SELECT capability_id,status FROM bot_installation_capabilities " +
      "WHERE group_id=$1",
    [String(groupId)],
  );

  for (const item of rows.rows) {
    const status = String(item.status);
    if (status === "INSTALLED") counts.installed += 1;
    else if (status === "DISABLED") counts.disabled += 1;
    else if (status === "INSTALLING") counts.installing += 1;
    else if (status === "FAILED") counts.failed += 1;
    else counts.other += 1;
  }

  const health = await runHealth(pool, groupId, Boolean(row.installed), String(row.installation_version || ""));

  return {
    health,
    installed: Boolean(row.installed),
    version: String(row.installation_version || ""),
    runtimeStatus: String(runtime?.status || "NOT_REGISTERED"),
    capabilityCounts: counts,
  };
}

async function runHealth(
  pool: Pool,
  groupId: number,
  installed: boolean,
  version: string,
) {
  const client = await pool.connect();
  try {
    const operation = installed ? "repair" : "uninstall";
    const health = await runInstallationHealthCheck(client, {
      groupId,
      operation,
      targetVersion: version,
    });

    // For legacy installed groups, HEALTHY is intentionally not assumed.
    // The reconciliation layer uses LEGACY until a real installation operation
    // registers a verified runtime.
    return health;
  } finally {
    client.release();
  }
}

export function installationDiagnosticDocument(
  chatTitle: string,
  diagnostic: InstallationDiagnostic,
) {
  const health = diagnostic.health;
  const capabilityTotal = INSTALLATION_CAPABILITIES.length;
  const order = capabilityActivationOrder();
  const issues = health.issues.length ? health.issues : ["هیچ ایراد فعالی ثبت نشده است."];

  return {
    version: 1,
    is_rtl: true,
    blocks: [
      {
        type: "heading",
        text: "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Dɪᴀɢɴᴏsᴛɪᴄs",
        size: 1,
      },
      { type: "divider" },
      {
        type: "table",
        caption: "وضعیت سلامت نصب",
        is_bordered: true,
        is_striped: true,
        is_compact: true,
        cells: [
          [
            { text: "شاخص", is_header: true, align: "right", valign: "middle" },
            { text: "مقدار", is_header: true, align: "right", valign: "middle" },
          ],
          [
            { text: "گروه", align: "right", valign: "middle" },
            { text: chatTitle || "گروه بدون نام", align: "right", valign: "middle" },
          ],
          [
            { text: "نصب", align: "right", valign: "middle" },
            { text: diagnostic.installed ? "● فعال" : "○ نصب نشده", align: "right", valign: "middle" },
          ],
          [
            { text: "نسخه", align: "right", valign: "middle" },
            { text: diagnostic.version || "—", align: "right", valign: "middle" },
          ],
          [
            { text: "Runtime", align: "right", valign: "middle" },
            { text: diagnostic.runtimeStatus, align: "right", valign: "middle" },
          ],
          [
            { text: "Health", align: "right", valign: "middle" },
            {
              text: health.status === "HEALTHY" ? "● سالم" : "■ نیازمند بررسی",
              align: "right",
              valign: "middle",
            },
          ],
          [
            { text: "Capability", align: "right", valign: "middle" },
            { text: diagnostic.capabilityCounts.installed + " / " + capabilityTotal + " فعال", align: "right", valign: "middle" },
          ],
        ],
      },
      { type: "divider" },
      {
        type: "details",
        summary: "Capability Registry",
        is_open: false,
        blocks: [
          {
            type: "list",
            items: [
              ...order.map((item) => ({
                blocks: [
                  {
                    type: "paragraph",
                    text: "⛂ - " + item.label + " · dependency: " +
                      (item.dependencies.length ? item.dependencies.join("، ") : "—"),
                  },
                ],
              })),
            ],
          },
        ],
      },
      {
        type: "details",
        summary: "موارد بررسی",
        is_open: health.issues.length > 0,
        blocks: [
          {
            type: "list",
            items: issues.map((issue) => ({
              blocks: [{ type: "paragraph", text: "■ " + issue }],
            })),
          },
        ],
      },
      { type: "divider" },
      {
        type: "footer",
        text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Iɴsᴛᴀʟʟ Dɪᴀɢɴᴏsᴛɪᴄs",
      },
    ],
  };
}
