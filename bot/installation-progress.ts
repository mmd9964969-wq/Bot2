import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";
import {
  prepareRichDocument,
  type RichDocument,
} from "../src/lib/bot/rich-message.ts";

export type InstallationProgressOperation =
  | "install"
  | "update"
  | "repair"
  | "reinstall"
  | "uninstall";

export type InstallationProgressPhase =
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED";

export type InstallationProgressStatus =
  | "PENDING"
  | "RUNNING"
  | "VERIFYING"
  | "RECOVERING"
  | "STALE"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type InstallationStepStatus =
  | "NOT_STARTED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type InstallationProgressSnapshot = {
  execution_id: string;
  group_id: string;
  actor_id: string;
  operation: InstallationProgressOperation;
  phase: InstallationProgressPhase;
  status: InstallationProgressStatus;
  current_step: string | null;
  current_step_index: number;
  total_steps: number;
  completed_steps: number;
  progress: number;
  started_at: string;
  updated_at: string;
  heartbeat_at: string;
  completed_at: string | null;
  last_message_id: number | null;
  last_render_at: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

type InstallationStepDefinition = {
  id: string;
  label: string;
  weight: number;
};

type InstallationChat = {
  id: number;
  title?: string;
};

type StepProgressResult = {
  snapshot: InstallationProgressSnapshot;
  alreadyCompleted: boolean;
};

const STALE_AFTER_MS = 60_000;
const HEARTBEAT_MS = 5_000;
const MIN_RENDER_INTERVAL_MS = 3_000;
const MIN_RENDER_PROGRESS_DELTA = 5;

function nowIso() {
  return new Date().toISOString();
}

function operationLabel(operation: InstallationProgressOperation) {
  const labels: Record<InstallationProgressOperation, string> = {
    install: "نصب اولیه",
    update: "به‌روزرسانی",
    repair: "تعمیر نصب",
    reinstall: "نصب مجدد",
    uninstall: "حذف نصب",
  };
  return labels[operation];
}

function stepDefinitions(operation: InstallationProgressOperation): InstallationStepDefinition[] {
  const definitions: Record<InstallationProgressOperation, InstallationStepDefinition[]> = {
    install: [
      { id: "prepare", label: "آماده‌سازی", weight: 10 },
      { id: "apply", label: "اجرای عملیات اصلی", weight: 50 },
      { id: "persist", label: "ثبت وضعیت", weight: 15 },
      { id: "verify", label: "اعتبارسنجی", weight: 20 },
      { id: "finalize", label: "نهایی‌سازی", weight: 5 },
    ],
    update: [
      { id: "prepare", label: "آماده‌سازی", weight: 10 },
      { id: "apply", label: "به‌روزرسانی نسخه و تنظیمات", weight: 50 },
      { id: "persist", label: "ثبت وضعیت", weight: 15 },
      { id: "verify", label: "اعتبارسنجی", weight: 20 },
      { id: "finalize", label: "نهایی‌سازی", weight: 5 },
    ],
    repair: [
      { id: "prepare", label: "تشخیص و آماده‌سازی", weight: 10 },
      { id: "apply", label: "ترمیم وضعیت", weight: 50 },
      { id: "persist", label: "ثبت وضعیت", weight: 15 },
      { id: "verify", label: "اعتبارسنجی", weight: 20 },
      { id: "finalize", label: "نهایی‌سازی", weight: 5 },
    ],
    reinstall: [
      { id: "prepare", label: "آماده‌سازی", weight: 10 },
      { id: "apply", label: "بازسازی نصب", weight: 50 },
      { id: "persist", label: "ثبت وضعیت", weight: 15 },
      { id: "verify", label: "اعتبارسنجی", weight: 20 },
      { id: "finalize", label: "نهایی‌سازی", weight: 5 },
    ],
    uninstall: [
      { id: "prepare", label: "آماده‌سازی", weight: 10 },
      { id: "apply", label: "غیرفعال‌سازی نصب", weight: 50 },
      { id: "persist", label: "ثبت وضعیت", weight: 15 },
      { id: "verify", label: "اعتبارسنجی", weight: 20 },
      { id: "finalize", label: "نهایی‌سازی", weight: 5 },
    ],
  };

  return definitions[operation];
}

async function insertEvent(
  pool: Pool,
  executionId: string,
  groupId: string | number,
  actorId: string | number,
  eventType: string,
  metadata: Record<string, unknown> = {},
  stepId?: string | null,
  progress?: number | null,
) {
  try {
    await pool.query(
      "INSERT INTO bot_installation_progress_events(" +
        "execution_id,group_id,actor_id,event_type,step_id,progress,metadata" +
        ") VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [
        executionId,
        String(groupId),
        String(actorId),
        eventType,
        stepId ?? null,
        progress ?? null,
        JSON.stringify(metadata),
      ],
    );
    return true;
  } catch (error) {
    console.error("[installation-progress] event log failed:", {
      execution_id: executionId,
      event_type: eventType,
      step_id: stepId ?? null,
      error: String((error as any)?.message ?? error),
    });
    return false;
  }
}

async function rowToSnapshot(row: any): Promise<InstallationProgressSnapshot> {
  return {
    execution_id: String(row.execution_id),
    group_id: String(row.group_id),
    actor_id: String(row.actor_id),
    operation: String(row.operation) as InstallationProgressOperation,
    phase: String(row.phase) as InstallationProgressPhase,
    status: String(row.status) as InstallationProgressStatus,
    current_step: row.current_step == null ? null : String(row.current_step),
    current_step_index: Number(row.current_step_index ?? 0),
    total_steps: Number(row.total_steps ?? 0),
    completed_steps: Number(row.completed_steps ?? 0),
    progress: Math.max(0, Math.min(100, Number(row.progress ?? 0))),
    started_at: new Date(row.started_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    heartbeat_at: new Date(row.heartbeat_at).toISOString(),
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    last_message_id: row.last_message_id == null ? null : Number(row.last_message_id),
    last_render_at: row.last_render_at ? new Date(row.last_render_at).toISOString() : null,
    error_code: row.error_code == null ? null : String(row.error_code),
    error_message: row.error_message == null ? null : String(row.error_message),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
  };
}

export async function ensureInstallationProgressSchema(pool: Pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_progress (" +
      "execution_id TEXT PRIMARY KEY," +
      "group_id BIGINT NOT NULL," +
      "actor_id BIGINT NOT NULL," +
      "operation TEXT NOT NULL," +
      "phase TEXT NOT NULL," +
      "status TEXT NOT NULL," +
      "current_step TEXT," +
      "current_step_index INTEGER NOT NULL DEFAULT 0," +
      "total_steps INTEGER NOT NULL DEFAULT 0," +
      "completed_steps INTEGER NOT NULL DEFAULT 0," +
      "progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100)," +
      "started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "completed_at TIMESTAMPTZ," +
      "last_message_id BIGINT," +
      "last_render_at TIMESTAMPTZ," +
      "last_rendered_progress INTEGER NOT NULL DEFAULT 0," +
      "error_code TEXT," +
      "error_message TEXT," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb" +
      ")",
  );

  await pool.query(
    "ALTER TABLE bot_installation_progress " +
      "ADD COLUMN IF NOT EXISTS last_rendered_progress INTEGER NOT NULL DEFAULT 0",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_progress_steps (" +
      "execution_id TEXT NOT NULL REFERENCES bot_installation_progress(execution_id) ON DELETE CASCADE," +
      "step_id TEXT NOT NULL," +
      "step_index INTEGER NOT NULL," +
      "label TEXT NOT NULL," +
      "weight INTEGER NOT NULL CHECK(weight > 0)," +
      "status TEXT NOT NULL DEFAULT 'NOT_STARTED'," +
      "progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100)," +
      "attempts INTEGER NOT NULL DEFAULT 0," +
      "started_at TIMESTAMPTZ," +
      "completed_at TIMESTAMPTZ," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "PRIMARY KEY(execution_id,step_id)" +
      ")",
  );

  await pool.query(
    "CREATE TABLE IF NOT EXISTS bot_installation_progress_events (" +
      "id BIGSERIAL PRIMARY KEY," +
      "execution_id TEXT NOT NULL," +
      "group_id BIGINT NOT NULL," +
      "actor_id BIGINT NOT NULL," +
      "event_type TEXT NOT NULL," +
      "step_id TEXT," +
      "progress INTEGER," +
      "metadata JSONB NOT NULL DEFAULT '{}'::jsonb," +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ")",
  );

  // Compatibility migration: older Progress schemas may already exist with
  // a subset of the current columns. Keep runtime execution independent of
  // whether the database was created by an older release.
  await pool.query(
    "ALTER TABLE bot_installation_progress " +
      "ADD COLUMN IF NOT EXISTS current_step TEXT," +
      "ADD COLUMN IF NOT EXISTS current_step_index INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS completed_steps INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()," +
      "ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ," +
      "ADD COLUMN IF NOT EXISTS last_message_id BIGINT," +
      "ADD COLUMN IF NOT EXISTS last_render_at TIMESTAMPTZ," +
      "ADD COLUMN IF NOT EXISTS last_rendered_progress INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS error_code TEXT," +
      "ADD COLUMN IF NOT EXISTS error_message TEXT," +
      "ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
  );

  await pool.query(
    "ALTER TABLE bot_installation_progress_steps " +
      "ADD COLUMN IF NOT EXISTS step_index INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'مرحله'," +
      "ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1," +
      "ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'NOT_STARTED'," +
      "ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0," +
      "ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ," +
      "ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ," +
      "ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
  );

  await pool.query(
    "ALTER TABLE bot_installation_progress_events " +
      "ADD COLUMN IF NOT EXISTS step_id TEXT," +
      "ADD COLUMN IF NOT EXISTS progress INTEGER," +
      "ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_progress_group " +
      "ON bot_installation_progress(group_id,updated_at DESC)",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_progress_heartbeat " +
      "ON bot_installation_progress(status,heartbeat_at)",
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_bot_installation_progress_events_execution " +
      "ON bot_installation_progress_events(execution_id,created_at DESC)",
  );

  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_bot_installation_progress_active_group " +
      "ON bot_installation_progress(group_id) " +
      "WHERE status IN ('PENDING','RUNNING','VERIFYING','RECOVERING','STALE')",
  );
}

export function getInstallationProgressSteps(
  operation: InstallationProgressOperation,
) {
  return stepDefinitions(operation);
}

export async function getInstallationProgress(
  pool: Pool,
  executionId: string,
): Promise<InstallationProgressSnapshot | null> {
  const result = await pool.query(
    "SELECT * FROM bot_installation_progress WHERE execution_id=$1 LIMIT 1",
    [executionId],
  );
  const row = result.rows[0];
  return row ? rowToSnapshot(row) : null;
}

export async function getActiveInstallationProgress(
  pool: Pool,
  groupId: number | string,
): Promise<InstallationProgressSnapshot | null> {
  const result = await pool.query(
    "SELECT * FROM bot_installation_progress " +
      "WHERE group_id=$1 AND status IN ('PENDING','RUNNING','VERIFYING','RECOVERING','STALE') " +
      "ORDER BY updated_at DESC LIMIT 1",
    [String(groupId)],
  );
  const row = result.rows[0];
  return row ? rowToSnapshot(row) : null;
}

export async function createInstallationProgress(
  pool: Pool,
  params: {
    groupId: number;
    actorId: number;
    operation: InstallationProgressOperation;
    messageId: number;
    metadata?: Record<string, unknown>;
  },
): Promise<InstallationProgressSnapshot> {
  const definitions = stepDefinitions(params.operation);
  const executionId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : "exec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["installation-progress:" + String(params.groupId)],
    );

    const active = await client.query(
      "SELECT execution_id,status FROM bot_installation_progress " +
        "WHERE group_id=$1 AND status IN ('PENDING','RUNNING','VERIFYING','RECOVERING','STALE') " +
        "LIMIT 1",
      [String(params.groupId)],
    );
    if (active.rows[0]) {
      const error = new Error("یک عملیات نصب برای این گروه در حال اجراست.");
      (error as any).code = "INSTALLATION_EXECUTION_ACTIVE";
      (error as any).executionId = String(active.rows[0].execution_id);
      throw error;
    }

    await client.query(
      "INSERT INTO bot_installation_progress(" +
        "execution_id,group_id,actor_id,operation,phase,status,current_step,current_step_index,total_steps,progress,last_message_id,metadata" +
      ") VALUES($1,$2,$3,$4,'EXECUTING','PENDING',NULL,0,$5,0,$6,$7::jsonb)",
      [
        executionId,
        String(params.groupId),
        String(params.actorId),
        params.operation,
        definitions.length,
        String(params.messageId),
        JSON.stringify(params.metadata ?? {}),
      ],
    );

    for (let i = 0; i < definitions.length; i += 1) {
      const step = definitions[i];
      await client.query(
        "INSERT INTO bot_installation_progress_steps(" +
          "execution_id,step_id,step_index,label,weight,status,progress" +
        ") VALUES($1,$2,$3,$4,$5,'NOT_STARTED',0)",
        [executionId, step.id, i + 1, step.label, step.weight],
      );
    }

    await client.query("UPDATE bot_installation_progress SET status='RUNNING',updated_at=NOW(),heartbeat_at=NOW() WHERE execution_id=$1", [executionId]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    throw error;
  }

  client.release();

  await insertEvent(
    pool,
    executionId,
    params.groupId,
    params.actorId,
    "operation_started",
    { operation: params.operation, message_id: params.messageId },
  );

  return (await getInstallationProgress(pool, executionId))!;
}

async function recalculateSnapshot(
  pool: Pool,
  executionId: string,
) {
  const result = await pool.query(
    "SELECT p.*, " +
      "COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.weight ELSE 0 END),0) AS completed_weight, " +
      "COALESCE(SUM(s.weight),0) AS total_weight, " +
      "COALESCE(SUM(s.weight * s.progress) / NULLIF(SUM(s.weight),0),0) AS weighted_progress, " +
      "COUNT(*) FILTER (WHERE s.status='COMPLETED') AS completed_steps_calc " +
      "FROM bot_installation_progress p " +
      "JOIN bot_installation_progress_steps s ON s.execution_id=p.execution_id " +
      "WHERE p.execution_id=$1 " +
      "GROUP BY p.execution_id",
    [executionId],
  );

  const row = result.rows[0];
  if (!row) throw new Error("رکورد پیشرفت عملیات پیدا نشد.");

  const weightedProgress = Math.max(
    0,
    Math.min(100, Math.round(Number(row.weighted_progress ?? 0) / 1)),
  );
  const progress = String(row.status) === "COMPLETED"
    ? 100
    : Math.min(99, weightedProgress);

  await pool.query(
    "UPDATE bot_installation_progress SET " +
      "completed_steps=$2,current_step_index=COALESCE(" +
        "(SELECT step_index FROM bot_installation_progress_steps WHERE execution_id=$1 AND status='RUNNING' ORDER BY step_index LIMIT 1)," +
        "(SELECT step_index FROM bot_installation_progress_steps WHERE execution_id=$1 AND status='COMPLETED' ORDER BY step_index DESC LIMIT 1),0)," +
      "),progress=$3,updated_at=NOW(),heartbeat_at=NOW() " +
      "WHERE execution_id=$1",
    [
      executionId,
      Number(row.completed_steps_calc ?? 0),
      progress,
    ],
  );

  return getInstallationProgress(pool, executionId);
}

export async function setInstallationStepProgress(
  pool: Pool,
  executionId: string,
  stepId: string,
  progress: number,
  status?: InstallationStepStatus,
  metadata: Record<string, unknown> = {},
): Promise<StepProgressResult> {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const existing = await pool.query(
    "SELECT status FROM bot_installation_progress_steps WHERE execution_id=$1 AND step_id=$2 LIMIT 1",
    [executionId, stepId],
  );
  if (!existing.rows[0]) {
    throw new Error("مرحلهٔ پیشرفت پیدا نشد: " + stepId);
  }

  const alreadyCompleted = String(existing.rows[0].status) === "COMPLETED";
  if (alreadyCompleted && status !== "FAILED") {
    const snapshot = (await getInstallationProgress(pool, executionId))!;
    return { snapshot, alreadyCompleted: true };
  }

  const nextStatus = status ?? (safeProgress >= 100 ? "COMPLETED" : "RUNNING");
  await pool.query(
    "UPDATE bot_installation_progress_steps SET " +
      "status=$3,progress=$4,attempts=CASE WHEN $3='RUNNING' AND status='NOT_STARTED' THEN attempts+1 ELSE attempts END," +
      "started_at=CASE WHEN $3='RUNNING' AND started_at IS NULL THEN NOW() ELSE started_at END," +
      "completed_at=CASE WHEN $3='COMPLETED' THEN NOW() ELSE completed_at END," +
      "metadata=$5::jsonb WHERE execution_id=$1 AND step_id=$2",
    [
      executionId,
      stepId,
      nextStatus,
      safeProgress,
      JSON.stringify(metadata),
    ],
  );

  const snapshot = (await recalculateSnapshot(pool, executionId))!;
  await pool.query(
    "UPDATE bot_installation_progress SET current_step=$2,updated_at=NOW(),heartbeat_at=NOW() WHERE execution_id=$1",
    [executionId, stepId],
  );

  await insertEvent(
    pool,
    executionId,
    snapshot.group_id,
    snapshot.actor_id,
    nextStatus === "RUNNING"
      ? "step_started"
      : nextStatus === "COMPLETED"
        ? "step_completed"
        : nextStatus === "FAILED"
          ? "step_failed"
          : "step_updated",
    metadata,
    stepId,
    snapshot.progress,
  );

  return {
    snapshot: (await getInstallationProgress(pool, executionId))!,
    alreadyCompleted: false,
  };
}

export async function setInstallationPhase(
  pool: Pool,
  executionId: string,
  phase: InstallationProgressPhase,
  status: InstallationProgressStatus,
  metadata: Record<string, unknown> = {},
) {
  const snapshot = await getInstallationProgress(pool, executionId);
  if (!snapshot) return null;

  await pool.query(
    "UPDATE bot_installation_progress SET phase=$2,status=$3,progress=CASE WHEN $3='COMPLETED' THEN 100 ELSE progress END," +
      "updated_at=NOW(),heartbeat_at=NOW(),completed_at=CASE WHEN $3 IN ('COMPLETED','FAILED','CANCELLED') THEN NOW() ELSE completed_at END WHERE execution_id=$1",
    [executionId, phase, status],
  );

  await insertEvent(
    pool,
    executionId,
    snapshot.group_id,
    snapshot.actor_id,
    "phase_changed",
    { phase, status, ...metadata },
    snapshot.current_step,
    snapshot.progress,
  );

  return getInstallationProgress(pool, executionId);
}

export async function recordInstallationProgressError(
  pool: Pool,
  executionId: string,
  code: string,
  message: string,
  metadata: Record<string, unknown> = {},
) {
  const snapshot = await getInstallationProgress(pool, executionId);
  if (!snapshot) return null;

  await pool.query(
    "UPDATE bot_installation_progress SET phase='FAILED',status='FAILED',error_code=$2,error_message=$3,completed_at=NOW(),updated_at=NOW(),heartbeat_at=NOW() WHERE execution_id=$1",
    [executionId, code, message],
  );

  await insertEvent(
    pool,
    executionId,
    snapshot.group_id,
    snapshot.actor_id,
    "operation_failed",
    { ...metadata, error_code: code, detail: message },
    snapshot.current_step,
    snapshot.progress,
  );

  return getInstallationProgress(pool, executionId);
}

export async function attachInstallationProgressMessage(
  pool: Pool,
  executionId: string,
  messageId: number,
) {
  await pool.query(
    "UPDATE bot_installation_progress SET last_message_id=$2,updated_at=NOW() WHERE execution_id=$1",
    [executionId, String(messageId)],
  );
}

export async function shouldRenderInstallationProgress(
  pool: Pool,
  executionId: string,
  snapshot: InstallationProgressSnapshot,
  force = false,
) {
  if (force) return true;

  const row = await pool.query(
    "SELECT progress,last_render_at,last_rendered_progress,current_step FROM bot_installation_progress WHERE execution_id=$1 LIMIT 1",
    [executionId],
  );
  const current = row.rows[0];
  if (!current) return true;

  const previousProgress = Number(current.last_rendered_progress ?? 0);
  const previousStep = current.current_step == null ? null : String(current.current_step);
  const lastRenderAt = current.last_render_at ? new Date(current.last_render_at).getTime() : 0;
  const elapsed = Date.now() - lastRenderAt;

  if (previousStep !== snapshot.current_step) return true;
  if (Math.abs(previousProgress - snapshot.progress) >= MIN_RENDER_PROGRESS_DELTA) return true;
  return elapsed >= MIN_RENDER_INTERVAL_MS;
}

export async function markInstallationProgressRendered(
  pool: Pool,
  executionId: string,
) {
  await pool.query(
    "UPDATE bot_installation_progress SET last_render_at=NOW(),last_rendered_progress=progress,updated_at=NOW() WHERE execution_id=$1",
    [executionId],
  );
}

export function startInstallationHeartbeat(
  pool: Pool,
  executionId: string,
) {
  const timer = setInterval(() => {
    void pool.query(
      "UPDATE bot_installation_progress SET heartbeat_at=NOW(),updated_at=NOW() " +
        "WHERE execution_id=$1 AND status IN ('PENDING','RUNNING','VERIFYING','RECOVERING')",
      [executionId],
    ).catch((error) => {
      console.error("[installation-progress] heartbeat failed:", error);
    });
  }, HEARTBEAT_MS);

  timer.unref?.();
  return () => clearInterval(timer);
}

export async function getLatestInstallationProgressForGroup(
  pool: Pool,
  groupId: number | string,
): Promise<InstallationProgressSnapshot | null> {
  const result = await pool.query(
    "SELECT * FROM bot_installation_progress WHERE group_id=$1 ORDER BY started_at DESC LIMIT 1",
    [String(groupId)],
  );
  const row = result.rows[0];
  return row ? rowToSnapshot(row) : null;
}

export async function ensureInstallationProgressSteps(
  pool: Pool,
  executionId: string,
  operation: InstallationProgressOperation,
) {
  const definitions = stepDefinitions(operation);
  const progress = await getInstallationProgress(pool, executionId);
  if (!progress) throw new Error("رکورد پیشرفت عملیات پیدا نشد: " + executionId);

  for (let i = 0; i < definitions.length; i += 1) {
    const step = definitions[i];
    await pool.query(
      "INSERT INTO bot_installation_progress_steps(" +
        "execution_id,step_id,step_index,label,weight,status,progress" +
      ") VALUES($1,$2,$3,$4,$5,'NOT_STARTED',0) " +
      "ON CONFLICT(execution_id,step_id) DO NOTHING",
      [executionId, step.id, i + 1, step.label, step.weight],
    );
  }

  return getInstallationProgressStepStatuses(pool, executionId);
}

export async function getInstallationProgressStepStatuses(pool: Pool, executionId: string) {
  const result = await pool.query(
    "SELECT step_id,step_index,label,weight,status,progress,attempts,started_at,completed_at,metadata " +
      "FROM bot_installation_progress_steps WHERE execution_id=$1 ORDER BY step_index ASC",
    [executionId],
  );
  return result.rows.map((row) => ({
    step_id: String(row.step_id),
    step_index: Number(row.step_index),
    label: String(row.label),
    weight: Number(row.weight),
    status: String(row.status) as InstallationStepStatus,
    progress: Number(row.progress ?? 0),
    attempts: Number(row.attempts ?? 0),
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
  }));
}

export async function listRecoverableInstallationProgress(pool: Pool) {
  const result = await pool.query(
    "SELECT * FROM bot_installation_progress " +
      "WHERE status IN ('PENDING','RUNNING','VERIFYING','RECOVERING','STALE') " +
      "ORDER BY started_at ASC",
  );
  return Promise.all(result.rows.map((row) => rowToSnapshot(row)));
}

export async function claimInstallationProgressRecovery(
  pool: Pool,
  executionId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const row = (
      await client.query(
        "SELECT * FROM bot_installation_progress WHERE execution_id=$1 FOR UPDATE",
        [executionId],
      )
    ).rows[0];

    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    if (!["PENDING","RUNNING","VERIFYING","RECOVERING","STALE"].includes(String(row.status))) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      "UPDATE bot_installation_progress SET status='RECOVERING',updated_at=NOW(),heartbeat_at=NOW() WHERE execution_id=$1",
      [executionId],
    );
    await client.query("COMMIT");

    await insertEvent(
      pool,
      executionId,
      String(row.group_id),
      String(row.actor_id),
      "operation_recovering",
      { previous_status: String(row.status) },
      row.current_step == null ? null : String(row.current_step),
      Number(row.progress ?? 0),
    );

    return getInstallationProgress(pool, executionId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function markStaleInstallationProgress(pool: Pool) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const result = await pool.query(
    "UPDATE bot_installation_progress SET status='STALE',updated_at=NOW() " +
      "WHERE status IN ('PENDING','RUNNING','VERIFYING','RECOVERING') AND heartbeat_at < $1::timestamptz " +
      "RETURNING execution_id,group_id,actor_id,current_step,progress",
    [cutoff],
  );

  for (const row of result.rows) {
    await insertEvent(
      pool,
      String(row.execution_id),
      String(row.group_id),
      String(row.actor_id),
      "operation_stale",
      { heartbeat_timeout_ms: STALE_AFTER_MS },
      row.current_step == null ? null : String(row.current_step),
      Number(row.progress ?? 0),
    );
  }

  return result.rowCount ?? 0;
}

export function installationProgressDocument(
  chat: InstallationChat,
  snapshot: InstallationProgressSnapshot,
  detail?: string,
): RichDocument {
  const phaseLabels: Record<InstallationProgressPhase, string> = {
    EXECUTING: "در حال اجرا",
    VERIFYING: "در حال اعتبارسنجی",
    COMPLETED: "تکمیل شد",
    FAILED: "ناموفق",
  };

  const statusSymbol =
    snapshot.status === "FAILED" || snapshot.status === "STALE"
      ? "■"
      : snapshot.status === "COMPLETED"
        ? "●"
        : "●";

  const progress = Math.max(0, Math.min(100, snapshot.progress));
  const barLength = 10;
  const filled = Math.floor((progress / 100) * barLength);
  const bar = "■".repeat(filled) + "□".repeat(barLength - filled);

  const definitions = stepDefinitions(snapshot.operation);
  const current = definitions.find((item) => item.id === snapshot.current_step);
  const currentLabel = current?.label || "در حال آماده‌سازی";

  const blocks: any[] = [
    {
      type: "heading",
      text:
        snapshot.phase === "COMPLETED"
          ? "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴘᴇʀᴀᴛɪᴏɴ Cᴏᴍᴘʟᴇᴛᴇᴅ"
          : snapshot.phase === "FAILED"
            ? "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴘᴇʀᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ"
            : "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴘᴇʀᴀᴛɪᴏɴ Pʀᴏɢʀᴇss",
      size: 1,
    },
    {
      type: "divider",
    },
    {
      type: "table",
      caption: "وضعیت عملیات",
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
          { text: chat.title || "گروه بدون نام", align: "right", valign: "middle" },
        ],
        [
          { text: "عملیات", align: "right", valign: "middle" },
          { text: operationLabel(snapshot.operation), align: "right", valign: "middle" },
        ],
        [
          { text: "مرحله", align: "right", valign: "middle" },
          {
            text:
              statusSymbol + " " +
              (snapshot.phase === "COMPLETED"
                ? phaseLabels.COMPLETED
                : snapshot.phase === "FAILED"
                  ? phaseLabels.FAILED
                  : snapshot.phase === "VERIFYING"
                    ? phaseLabels.VERIFYING
                    : phaseLabels.EXECUTING),
            align: "right",
            valign: "middle",
          },
        ],
        [
          { text: "پیشرفت", align: "right", valign: "middle" },
          { text: "【 " + String(progress) + "% 】 " + bar, align: "right", valign: "middle" },
        ],
        [
          { text: "گام", align: "right", valign: "middle" },
          {
            text:
              String(snapshot.current_step_index || 0) +
              " / " +
              String(snapshot.total_steps || definitions.length) +
              " · " +
              currentLabel,
            align: "right",
            valign: "middle",
          },
        ],
      ],
    },
  ];

  if (detail) {
    blocks.push({ type: "divider" }, { type: "paragraph", text: detail });
  }

  if (snapshot.phase === "COMPLETED") {
    blocks.push(
      { type: "divider" },
      { type: "paragraph", text: "اعتبارسنجی نهایی با موفقیت انجام شد و عملیات بسته شد." },
      {
        type: "buttons",
        align: "center",
        buttons: [
          { text: "گزارش وضعیت", callback_data: "inst:op:report" },
          { text: "‹ بازگشت", callback_data: "inst:home", style: "primary" },
        ],
      },
    );
  } else if (snapshot.phase === "FAILED") {
    blocks.push(
      { type: "divider" },
      {
        type: "paragraph",
        text:
          "این خطا در گزارش عملیات ثبت شده است. اجرای مجدد فقط پس از بررسی وضعیت فعلی انجام می‌شود.",
      },
      {
        type: "buttons",
        align: "center",
        buttons: [
          { text: "بررسی مجدد", callback_data: "inst:preflight:recheck", style: "success" },
          { text: "گزارش وضعیت", callback_data: "inst:op:report" },
          { text: "‹ بازگشت", callback_data: "inst:home", style: "primary" },
        ],
      },
    );
  } else if (snapshot.status === "STALE") {
    blocks.push(
      { type: "divider" },
      { type: "paragraph", text: "اجرای عملیات متوقف به نظر می‌رسد و برای بازیابی در نشست بعدی نگه داشته شده است." },
      {
        type: "buttons",
        align: "center",
        buttons: [
          { text: "بررسی مجدد", callback_data: "inst:preflight:recheck", style: "success" },
          { text: "‹ بازگشت", callback_data: "inst:home", style: "primary" },
        ],
      },
    );
  }

  blocks.push({
    type: "footer",
    text: "Pᴇʀsɪᴀɴ ᴮᵒᵗ · Pʀᴏɢʀᴇss Cᴇɴᴛᴇʀ",
  });

  return prepareRichDocument({
    version: 1,
    is_rtl: true,
    blocks,
  });
}
