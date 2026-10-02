import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Pool } from "pg";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO = "mmd9964969-wq/Bot2";
const DEFAULT_MODEL = "gpt-5";
const OWNER_ID = "8247710529";
const WORK_ROOT = join(tmpdir(), "persian-bot-agent");
const MAX_TOOL_OUTPUT = 28000;
const MAX_READ_CHARS = 36000;
const PROTECTED_PATTERN = /(^|\/)\.(env|git-credentials|npmrc)$|(^|\/)(credentials?|secrets?|.*\.(pem|key|p12))$/i;
const DESTRUCTIVE_SQL_PATTERN = /\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\b|ALTER\s+SYSTEM|DELETE\s+FROM\s+[A-Za-z_][A-Za-z0-9_]*\s*(;|$))/i;
let workerStarted = false;

type AgentJob = {
  id: number;
  requested_by: string;
  task_type: string;
  instruction: string;
  autopilot: boolean;
  priority: number;
};

type AgentSettings = {
  enabled: boolean;
  autopilot_enabled: boolean;
  autopilot_interval_minutes: number;
  auto_deploy: boolean;
  max_iterations: number;
};

function env(name: string, fallback = ""): string {
  return String(process.env[name] ?? fallback).trim();
}

function clip(value: unknown, max = MAX_TOOL_OUTPUT): string {
  const text = String(value ?? "");
  return text.length <= max ? text : text.slice(0, max) + "\n… [خروجی کوتاه شد]";
}

function safeWorkspacePath(root: string, filePath: string): string {
  const clean = String(filePath || "").trim().replace(/^\.\//, "");
  const full = resolve(root, clean);
  const base = resolve(root) + "/";
  if (full !== resolve(root) && !full.startsWith(base)) throw new Error("path_outside_workspace");
  return full;
}

function assertWritablePath(filePath: string): void {
  const clean = String(filePath || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!clean || PROTECTED_PATTERN.test(clean)) throw new Error("protected_path");
  if (clean.startsWith(".git/") || clean.includes("/.git/")) throw new Error("git_internal_path");
}

async function runCommand(root: string, command: string, args: string[], timeout = 180000) {
  return execFileAsync(command, args, { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024 });
}

async function q(pool: Pool, sql: string, args: any[] = []) {
  return pool.query(sql, args);
}

async function getSettings(pool: Pool): Promise<AgentSettings> {
  const r = await q(pool, "SELECT enabled,autopilot_enabled,autopilot_interval_minutes,auto_deploy,max_iterations FROM agent_settings WHERE id=TRUE LIMIT 1");
  const row = r.rows[0] || {};
  return {
    enabled: row.enabled !== false,
    autopilot_enabled: row.autopilot_enabled === true,
    autopilot_interval_minutes: Math.max(5, Number(row.autopilot_interval_minutes || 360)),
    auto_deploy: row.auto_deploy !== false,
    max_iterations: Math.max(4, Math.min(48, Number(row.max_iterations || 24))),
  };
}

export async function ensureOwnerAgentSchema(pool: Pool) {
  await q(pool, "INSERT INTO agent_settings(id) VALUES(TRUE) ON CONFLICT(id) DO NOTHING");
}

export async function queueOwnerAgentJob(
  pool: Pool,
  requestedBy: number,
  taskType: string,
  instruction: string,
  autopilot = false,
) {
  if (requestedBy !== Number(OWNER_ID)) throw new Error("owner_only");
  await ensureOwnerAgentSchema(pool);
  const clean = String(instruction || "").trim();
  if (!clean) throw new Error("empty_instruction");
  const r = await q(
    "INSERT INTO agent_jobs(requested_by,task_type,instruction,autopilot) VALUES($1,$2,$3,$4) RETURNING id,created_at",
    [String(requestedBy), String(taskType || "full_auto"), clean, autopilot],
  );
  return r.rows[0];
}

async function claimNextJob(pool: Pool): Promise<AgentJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT id,requested_by,task_type,instruction,autopilot,priority FROM agent_jobs WHERE status='queued' ORDER BY priority DESC,created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!r.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const job = r.rows[0] as AgentJob;
    await client.query(
      "UPDATE agent_jobs SET status='running',started_at=NOW(),finished_at=NULL,error=NULL WHERE id=$1",
      [job.id],
    );
    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function latestAutopilotJob(pool: Pool): Promise<number> {
  const r = await q(pool, "SELECT created_at FROM agent_jobs WHERE autopilot=TRUE ORDER BY created_at DESC LIMIT 1");
  return r.rows[0]?.created_at ? new Date(r.rows[0].created_at).getTime() : 0;
}

async function maybeCreateAutopilotJob(pool: Pool, settings: AgentSettings) {
  if (!settings.autopilot_enabled) return;
  const last = await latestAutopilotJob(pool);
  if (last && Date.now() - last < settings.autopilot_interval_minutes * 60_000) return;
  const active = await q(pool, "SELECT COUNT(*)::int AS n FROM agent_jobs WHERE status IN ('queued','running')");
  if (Number(active.rows[0]?.n || 0) > 0) return;
  await q(
    "INSERT INTO agent_jobs(requested_by,task_type,instruction,autopilot,priority) VALUES($1,'autopilot',$2,TRUE,10)",
    [
      OWNER_ID,
      "سامانه را خودکار بررسی کن: خطاهای قابل مشاهده، typecheck، test، build، امنیت، وابستگی‌ها و یکپارچگی طراحی را ممیزی کن. فقط مشکلات قابل اثبات و اصلاحات کم‌ریسک را اعمال کن؛ تغییرات امنیتی ریشه‌ای، حذف داده و تغییر توکن‌ها ممنوع است.",
    ],
  );
}

async function cloneRepository(root: string) {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(dirname(root), { recursive: true });
  const repo = env("GITHUB_REPO", DEFAULT_REPO);
  const branch = env("GITHUB_BASE_BRANCH", "main");
  const token = env("GITHUB_TOKEN");
  const url = token
    ? "https://x-access-token:" + encodeURIComponent(token) + "@github.com/" + repo + ".git"
    : "https://github.com/" + repo + ".git";
  await runCommand(dirname(root), "git", ["clone", "--depth", "1", "--branch", branch, url, root], 180000);
  await runCommand(root, "git", ["config", "user.name", env("AGENT_GIT_NAME", "Persian Bot Agent")]);
  await runCommand(root, "git", ["config", "user.email", env("AGENT_GIT_EMAIL", "agent@persian-bot.local")]);
}

async function listFiles(root: string): Promise<string[]> {
  const r = await runCommand(root, "git", ["ls-files"]);
  return String(r.stdout).split("\n").map(x => x.trim()).filter(Boolean).slice(0, 1400);
}

async function searchFiles(root: string, query: string, prefix: string): Promise<string> {
  const args = ["grep", "-nI", "-F", String(query || ""), "--", prefix || "."];
  try {
    const r = await runCommand(root, "git", args, 60000);
    return clip(r.stdout);
  } catch (error: any) {
    return clip(error?.stdout || "");
  }
}

async function readFile(root: string, filePath: string, startLine: number, endLine: number): Promise<string> {
  const file = safeWorkspacePath(root, filePath);
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.split("\n");
  const start = Math.max(1, Number(startLine || 1));
  const end = Math.min(lines.length, Number(endLine || 600));
  let out = "";
  for (let i = start - 1; i < end; i++) {
    const line = lines[i];
    if (out.length + line.length + 12 > MAX_READ_CHARS) {
      out += "… [محتوا کوتاه شد]";
      break;
    }
    out += String(i + 1).padStart(5, " ") + " | " + line + "\n";
  }
  return out;
}

async function writeFile(root: string, filePath: string, content: string): Promise<string> {
  assertWritablePath(filePath);
  if (String(filePath).replaceAll("\\", "/").startsWith("migrations/") && DESTRUCTIVE_SQL_PATTERN.test(content)) {
    throw new Error("destructive_migration_blocked");
  }
  const file = safeWorkspacePath(root, filePath);
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return "ok";
}

async function gitStatus(root: string) {
  return runCommand(root, "git", ["status", "--short"]);
}

async function gitDiff(root: string) {
  return runCommand(root, "git", ["diff", "--", "."]);
}

async function runCheck(root: string, kind: string) {
  const checks: Record<string, [string, string[]]> = {
    typecheck: ["npm", ["run", "typecheck"]],
    test: ["npm", ["test"]],
    build: ["npm", ["run", "build"]],
    lint: ["npm", ["run", "lint"]],
    outdated: ["npm", ["outdated", "--json"]],
    audit: ["npm", ["audit", "--omit=dev", "--audit-level=high"]],
    diffcheck: ["git", ["diff", "--check"]],
  };
  const entry = checks[kind];
  if (!entry) throw new Error("unsupported_check");
  try {
    const r = await runCommand(root, entry[0], entry[1], kind === "build" ? 300000 : 180000);
    return { ok: true, stdout: clip(r.stdout), stderr: clip(r.stderr) };
  } catch (error: any) {
    return { ok: false, stdout: clip(error?.stdout || ""), stderr: clip(error?.stderr || error?.message || error) };
  }
}

const tools = [
  {
    type: "function", name: "list_files", description: "List tracked repository files.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true,
  },
  {
    type: "function", name: "search_files", description: "Search tracked files for exact text.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, path_prefix: { type: "string" } },
      required: ["query", "path_prefix"], additionalProperties: false,
    }, strict: true,
  },
  {
    type: "function", name: "read_file", description: "Read a bounded file line range.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } },
      required: ["path", "start_line", "end_line"], additionalProperties: false,
    }, strict: true,
  },
  {
    type: "function", name: "write_file", description: "Write complete UTF-8 source/config content. Protected paths and destructive SQL are rejected.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"], additionalProperties: false,
    }, strict: true,
  },
  {
    type: "function", name: "git_status", description: "Show working-tree changes.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true,
  },
  {
    type: "function", name: "git_diff", description: "Show current source diff.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true,
  },
  {
    type: "function", name: "run_check", description: "Run one approved repository check.",
    parameters: {
      type: "object", properties: {
        kind: { type: "string", enum: ["typecheck", "test", "build", "lint", "outdated", "audit", "diffcheck"] },
      }, required: ["kind"], additionalProperties: false,
    }, strict: true,
  },
  {
    type: "function", name: "finish", description: "End the job with a summary. deploy=true is allowed only after successful validation and safe changes.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        deploy: { type: "boolean" },
        changed_files: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "deploy", "changed_files"], additionalProperties: false,
    }, strict: true,
  },
];

const instructions = [
  "تو مهندس خودکار Pᴇʀsɪᴀɴ ᴮᵒᵗ هستی و روی یک مخزن واقعی و متصل به Production کار می‌کنی.",
  "قبل از تغییر، BOT_AGENT.md و کد مرتبط را بخوان.",
  "تغییرات باید حداقلی، قابل‌اثبات و سازگار با معماری فعلی باشند.",
  "Copy محصول فارسی‌اول است؛ پیام‌های Telegram باید Rich Message و دکمه‌ها بدون emoji باشند.",
  "هیچ راز، توکن یا Credential را بخوان و بازتولید نکن.",
  "تغییر owner identity، token، root access، حذف داده یا SQL مخرب ممنوع است.",
  "برای تغییرات مهم typecheck، test، build و git diff --check را اجرا کن.",
  "برای ممیزی طراحی، کد پنل و BOT_AGENT.md را با هم مقایسه کن.",
  "برای update وابستگی‌ها فقط تغییرات قابل‌توجیه و سازگار را انجام بده و تست کن.",
  "هر جا ریسک یا ابهام مهم وجود دارد، تغییر را متوقف کن و deploy=false بده.",
].join("\n");

async function openAI(input: any, previousResponseId?: string): Promise<any> {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY_not_configured");
  const body: any = {
    model: env("OPENAI_MODEL", DEFAULT_MODEL),
    instructions,
    input,
    tools,
    tool_choice: "auto",
    store: true,
  };
  if (previousResponseId) body.previous_response_id = previousResponseId;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error("openai_http_" + res.status + ":" + clip(json?.error?.message || "request_failed", 1400));
  return json;
}

async function modelLoop(root: string, job: AgentJob, settings: AgentSettings) {
  const initialFiles = await listFiles(root);
  let response = await openAI([
    "نوع کار: " + job.task_type,
    "دستور مالک: " + job.instruction,
    "",
    "فهرست فایل‌ها:",
    clip(initialFiles.join("\n"), 18000),
    "",
    "ابتدا BOT_AGENT.md را بخوان. سپس inspect، diagnose، edit، validate و finish را کامل انجام بده.",
  ].join("\n"));

  for (let i = 0; i < settings.max_iterations; i++) {
    const calls = (response.output || []).filter((x: any) => x?.type === "function_call");
    if (!calls.length) {
      return { summary: String(response.output_text || "Agent finished without explicit finish."), deploy: false, changed_files: [] as string[] };
    }

    const outputs: any[] = [];
    let finished: any = null;

    for (const call of calls) {
      let args: any = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }

      try {
        let result: any;
        switch (call.name) {
          case "list_files": result = await listFiles(root); break;
          case "search_files": result = await searchFiles(root, args.query, args.path_prefix); break;
          case "read_file": result = await readFile(root, args.path, args.start_line, args.end_line); break;
          case "write_file": result = await writeFile(root, args.path, args.content); break;
          case "git_status": result = await gitStatus(root); break;
          case "git_diff": result = await gitDiff(root); break;
          case "run_check": result = await runCheck(root, args.kind); break;
          case "finish":
            finished = args;
            result = { accepted: true };
            break;
          default:
            result = { error: "unknown_tool" };
        }
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: clip(JSON.stringify(result)) });
      } catch (error: any) {
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: clip(JSON.stringify({ error: String(error?.message || error) })),
        });
      }

      if (finished) break;
    }

    if (finished) {
      return {
        summary: String(finished.summary || ""),
        deploy: Boolean(finished.deploy),
        changed_files: Array.isArray(finished.changed_files) ? finished.changed_files.map(String) : [],
      };
    }

    response = await openAI(outputs, response.id);
  }

  throw new Error("agent_iteration_limit");
}

async function commitAndPush(root: string, job: AgentJob, deploy: boolean) {
  const status = await gitStatus(root);
  if (!String(status.stdout || "").trim()) return { changed: false, commitSha: "", branch: "" };

  const diffcheck = await runCheck(root, "diffcheck");
  if (!diffcheck.ok) throw new Error("git_diff_check_failed");

  const slug = job.task_type.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 24) || "task";
  const branch = "agent/job-" + job.id + "-" + slug;
  await runCommand(root, "git", ["checkout", "-b", branch]);
  await runCommand(root, "git", ["add", "-A"]);
  await runCommand(root, "git", ["commit", "-m", "agent(" + job.id + "): " + job.task_type]);
  const shaResult = await runCommand(root, "git", ["rev-parse", "HEAD"]);
  const sha = String(shaResult.stdout).trim();

  if (!env("GITHUB_TOKEN")) throw new Error("GITHUB_TOKEN_not_configured");
  await runCommand(root, "git", ["push", "origin", "HEAD:refs/heads/" + branch], 120000);
  if (deploy) {
    await runCommand(root, "git", ["push", "origin", "HEAD:refs/heads/" + env("GITHUB_BASE_BRANCH", "main")], 120000);
  }
  return { changed: true, commitSha: sha, branch };
}

async function verifyRailway(commitSha: string) {
  const token = env("RAILWAY_TOKEN");
  const projectId = env("RAILWAY_PROJECT_ID");
  const environmentId = env("RAILWAY_ENVIRONMENT_ID");
  if (!token || !projectId || !environmentId) return { checked: false, status: "unverified" };

  const query = "query project($id:String!){project(id:$id){serviceInstances{edges{node{serviceId latestDeployment{id status createdAt}}}}}}";
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: projectId } }),
  });
  const json: any = await res.json();
  if (!res.ok || json?.errors?.length) throw new Error("railway_api_failed");
  const nodes = json?.data?.project?.serviceInstances?.edges || [];
  const bot = nodes.map((x: any) => x.node).find((x: any) => String(x.serviceId) === env("RAILWAY_SERVICE_ID"));
  const status = String(bot?.latestDeployment?.status || "unknown");
  return { checked: true, status, deploymentId: String(bot?.latestDeployment?.id || ""), commitSha };
}

async function processJob(pool: Pool, job: AgentJob) {
  const settings = await getSettings(pool);
  if (!settings.enabled) {
    await q(pool, "UPDATE agent_jobs SET status='needs_owner',finished_at=NOW(),error='agent_disabled' WHERE id=$1", [job.id]);
    return;
  }

  const missing = ["OPENAI_API_KEY", "GITHUB_TOKEN"].filter(x => !env(x));
  if (missing.length) {
    await q(pool, "UPDATE agent_jobs SET status='needs_owner',finished_at=NOW(),error=$2 WHERE id=$1", [job.id, "Missing configuration: " + missing.join(", ")]);
    return;
  }

  const work = join(WORK_ROOT, "job-" + job.id);

  try {
    await cloneRepository(work);
    await runCheck(work, "typecheck").catch(() => null);
    const result = await modelLoop(work, job, settings);

    const checks = {
      typecheck: await runCheck(work, "typecheck"),
      test: await runCheck(work, "test"),
      build: await runCheck(work, "build"),
      diffcheck: await runCheck(work, "diffcheck"),
    };

    const failed = Object.entries(checks).find(([_, value]) => !value.ok);
    if (failed) {
      await q(
        pool,
        "UPDATE agent_jobs SET status='failed',finished_at=NOW(),summary=$2,error=$3,result=$4::jsonb WHERE id=$1",
        [job.id, result.summary, "validation_failed:" + failed[0], JSON.stringify(checks)],
      );
      return;
    }

    const deploy = result.deploy && settings.auto_deploy;
    const push = await commitAndPush(work, job, deploy);
    let railway: any = { checked: false, status: deploy ? "verification_unavailable" : "not_requested" };

    if (deploy && push.commitSha) railway = await verifyRailway(push.commitSha);

    const deploymentBad = deploy && railway.checked &&
      !["SUCCESS", "DEPLOYING", "BUILDING", "QUEUED", "INITIALIZING"].includes(railway.status);

    await q(
      pool,
      "UPDATE agent_jobs SET status=$2,finished_at=NOW(),branch_name=$3,commit_sha=$4,changed_files=$5::jsonb,summary=$6,result=$7::jsonb,error=$8 WHERE id=$1",
      [
        job.id,
        deploymentBad ? "failed" : "succeeded",
        push.branch || null,
        push.commitSha || null,
        JSON.stringify(result.changed_files || []),
        result.summary,
        JSON.stringify({ checks, railway }),
        deploymentBad ? "Railway deployment did not report a healthy state." : null,
      ],
    );
  } catch (error: any) {
    await q(pool, "UPDATE agent_jobs SET status='failed',finished_at=NOW(),error=$2 WHERE id=$1", [job.id, String(error?.message || error)]);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export async function startOwnerAgentWorker(pool: Pool) {
  if (workerStarted) return;
  workerStarted = true;

  await ensureOwnerAgentSchema(pool).catch(error => console.error("[owner-agent] schema:", error));

  const loop = async () => {
    try {
      const settings = await getSettings(pool);
      await maybeCreateAutopilotJob(pool, settings);
      const job = await claimNextJob(pool);
      if (job) await processJob(pool, job);
    } catch (error) {
      console.error("[owner-agent] loop:", error);
    }
    setTimeout(loop, Number(env("AGENT_POLL_MS", "12000"))).unref();
  };

  setTimeout(loop, 3000).unref();
}

export async function ownerAgentOverview(pool: Pool) {
  await ensureOwnerAgentSchema(pool);
  const settings = await getSettings(pool);
  const jobs = await q(
    pool,
    "SELECT id,task_type,status,autopilot,branch_name,commit_sha,summary,error,created_at,finished_at FROM agent_jobs ORDER BY created_at DESC LIMIT 8",
  );
  return { settings, jobs: jobs.rows };
}

export async function setOwnerAgentSetting(
  pool: Pool,
  ownerId: number,
  key: "enabled" | "autopilot_enabled" | "auto_deploy",
  value: boolean,
) {
  if (ownerId !== Number(OWNER_ID)) throw new Error("owner_only");
  await q(pool, "UPDATE agent_settings SET " + key + "=$1,updated_at=NOW() WHERE id=TRUE", [value]);
}

export async function cancelOwnerAgentJob(pool: Pool, ownerId: number, jobId: number) {
  if (ownerId !== Number(OWNER_ID)) throw new Error("owner_only");
  await q(pool, "UPDATE agent_jobs SET status='cancelled',finished_at=NOW() WHERE id=$1 AND status IN ('queued','needs_owner')", [jobId]);
}
