import { Client, Pool } from "pg";
import { DEFAULT_CONFIG, type BotConfig } from "../src/lib/bot/defaults.ts";
import type { BotContext } from "../src/lib/bot/engine.ts";
import { cloneStudioDefaults, type StudioDocument } from "../src/lib/bot/studio.ts";
import { type Lang, type Rank } from "../src/lib/bot/registry.ts";
import { telegramApi } from "../src/lib/telegram/api.ts";
import { rankAtLeast } from "../src/lib/bot/registry.ts";
import { runLiveCommand, recordMessage, recordMemberJoin, recordMemberLeave, ensureGroupInfoSchema, getGroupStats, type GroupInfoSnapshot } from "../src/lib/bot/runtime.ts";
import { enforceContentLocks, ensureContentLocks, runContentLockCommand, sendContentLockCenter, type ContentLockMessage } from "../src/lib/bot/content-locks.ts";
import { ensureMessageToolsSchema, trackMessageAndActivity } from "../src/lib/bot/message-tools.ts";
import { ensureStatsCenterSchema, isStatsCommand, openStatsCenterFromCommand, runDailyStatsBroadcast } from "../src/lib/bot/stats-center.ts";
import { isRuntimeMaintenance, startRuntimeControlServer } from "./runtime-control.ts";
import { ensureAutomationSchema, runAutomations, tickSchedules } from "../src/lib/bot/automation-engine.ts";
import { dispatchPanelMessage, dispatchPanelCallback, openModerationCenterFromCommand, openManagerCenterFromCommand } from "./panel-system.ts";
import { bindPanelMessage } from "../src/lib/bot/panel-session.ts";
import { ensureSpecialUsersSchema, sweepSpecialUsers } from "../src/lib/bot/special-users.ts";
import { ensureGroupLanguageSchema, getGroupLanguage, normalizeBotLang, setGroupLanguage, languageChangedText, languagePickerText, SUPPORTED_LANGUAGES } from "../src/lib/bot/i18n.ts";
import { ensureInstallationSchema, installationGate, handleInstallationCallback } from "./installation.ts";
import { ensureModerationSchema, runModerationCommand } from "../src/lib/bot/moderation.ts";
import { sweepGroupSubscriptions } from "../src/lib/bot/group-subscriptions.ts";
import { ensureInviteLinkSchema, handleInviteLinkCallback, handleInviteLinkJoinRequest, handleInviteLinkTextInput, handleInviteLinkUsage, openInviteLinkCenter } from "../src/lib/bot/invite-links.ts";
import { handleGameText, handleGameCallback, gameCenterKeyboard, isGameCenterCommand } from "../src/lib/bot/game-core.ts";
import { ensureEngineSchema, getEngineGame } from "../src/lib/bot/game-engine.ts";
import { handleWorldCallback, handleWorldText } from "../src/lib/bot/game-world.ts";
import { handleFrontierExpansionCallback } from "../src/lib/bot/frontier-expansion.ts";
import { renderGameText } from "../src/lib/bot/game-emoji.ts";
import { ensureCleanupSchema, trackCleanupMessage, handleCleanupText, handleCleanupCallback } from "../src/lib/bot/cleanup-engine.ts";
import { ensureOwnerGroupSchema, upsertOwnerGroupFromChat, touchOwnerGroupActivity } from "../src/lib/bot/owner-groups.ts";
import { ensureDateSchema, handleDateTextInput, handleDateCallback, openDateCenterFromCommand, runDateReminders } from "../src/lib/bot/date-center.ts";
import { decodeRichDocument, prepareRichDocument, richDocumentToPlainText, renderStudioTemplate, validateRichDocument } from "../src/lib/bot/rich-message.ts";
import { ensureOwnerSudoSchema, loadOwnerSudoCache, isManagedOwnerSudo, getOwnerSudo, ownerSudoAllowsCommand } from "../src/lib/bot/owner-sudo.ts";

function buildIdRichMessage(liveCard:string,lang:"fa"|"en",photoFileId?:string){
  const cleanLines=String(liveCard??"")
    .split("\n")
    .map((line)=>line.trim())
    .filter((line)=>line && !line.includes("─────━━─────"));

  const fieldLines=cleanLines
    .filter((line)=>line.startsWith("⛂ - "))
    .map((line)=>{
      const raw=line.slice("⛂ - ".length);
      const cut=raw.indexOf(" : ");
      return cut>=0
        ? {label:raw.slice(0,cut),value:raw.slice(cut+3)}
        : {label:raw,value:"—"};
    });

  const identity=fieldLines.slice(0,6);
  const activity=fieldLines.slice(6,11);
  const moderation=fieldLines.slice(11,15);

  const table=(title:string,rows:any[])=>({
    type:"table",
    caption:title,
    is_bordered:true,
    is_striped:true,
    is_compact:true,
    cells:[
      [
        {text:lang==="fa"?"عنوان":"Field",is_header:true,align:"right",valign:"middle"},
        {text:lang==="fa"?"مقدار":"Value",is_header:true,align:"right",valign:"middle"},
      ],
      ...rows.map((row:any)=>[
        {text:row.label,align:"right",valign:"middle"},
        {text:row.value,align:"right",valign:"middle"},
      ]),
    ],
  });

  const blocks:any[]=[];
  if(photoFileId){
    blocks.push({
      type:"photo",
      photo:{type:"photo",media:photoFileId},
    });
  }

  blocks.push(
    {type:"heading",text:lang==="fa"?"اطلاعات کاربر":"User Information",size:1},
    {
      type:"paragraph",
      text:lang==="fa"
        ? "پروفایل و وضعیت این عضو با قالب‌بندی Rich Message"
        : "Profile and member status in Rich Message format",
    },
    table(lang==="fa"?"مشخصات حساب":"Account Details",identity),
    {type:"divider"},
    table(lang==="fa"?"فعالیت در گروه":"Group Activity",activity),
    {type:"divider"},
    table(lang==="fa"?"وضعیت مدیریتی":"Moderation Status",moderation),
    {type:"divider"},
    {
      type:"details",
      summary:lang==="fa"?"راهنما":"Guide",
      is_open:false,
      blocks:[{
        type:"list",
        items:[
          {blocks:[{type:"paragraph",text:lang==="fa"?"برای مشاهده اطلاعات یک عضو، روی پیام او ریپلای کنید و دستور آیدی را ارسال کنید.":"Reply to a member’s message and send the ID command to view their information."}]},
          {blocks:[{type:"paragraph",text:lang==="fa"?"اطلاعات حساب، فعالیت و وضعیت مدیریتی در بخش‌های جداگانه نمایش داده می‌شود.":"Account, activity and moderation information are displayed in separate sections."}]},
        ],
      }],
    },
    {
      type:"footer",
      text:lang==="fa"?"Pᴇʀsɪᴀɴ ᴮᵒᵗ · User Profile":"Pᴇʀsɪᴀɴ ᴮᵒᵗ · User Profile",
    },
  );

  return {version:1,is_rtl:lang==="fa",blocks:prepareRichDocument({version:1,is_rtl:lang==="fa",blocks}).blocks};
}

const TOKEN = process.env.BOT_TOKEN ?? "";
if (!TOKEN) { console.error("BOT_TOKEN is missing"); process.exit(1); }
if (process.env.LEGACY_DISABLED === "true") { console.log("[legacy] Telegram Bot service disabled; Bot Core owns the runtime"); await new Promise(() => {}); }

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  botName: process.env.BOT_NAME || DEFAULT_CONFIG.botName,
  botUsername: process.env.BOT_USERNAME || DEFAULT_CONFIG.botUsername,
  defaultLang: normalizeBotLang(process.env.DEFAULT_LANG) ?? "fa",
  ownerIds: splitIds(process.env.OWNER_IDS),
  sudoIds: splitIds(process.env.SUDO_IDS),
  prefixes: [],
};

let studio = cloneStudioDefaults();
let studioPool: Pool | null = null;
let pollLockClient: Client | null = null;
let panelCommands: PanelCommand[] = [];


async function upsertWarningGroup(chat: TgChat) {
  if (!process.env.DATABASE_URL || chat.type === "private") return;
  try {
    studioPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await touchOwnerGroupActivity(studioPool, chat);
  } catch (error) {
    console.error("[owner-groups] activity registry update failed:", error);
  }
  try {
    studioPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await studioPool.query(
      "INSERT INTO bot_groups (id,title,username,type,is_active,updated_at) VALUES ($1,$2,$3,$4,TRUE,NOW()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,username=EXCLUDED.username,type=EXCLUDED.type,is_active=TRUE,updated_at=NOW()",
      [String(chat.id), chat.title ?? "", chat.username ?? null, chat.type ?? "supergroup"],
    );
    await studioPool.query(
      "INSERT INTO warning_system_settings (group_id) VALUES ($1) ON CONFLICT (group_id) DO NOTHING",
      [String(chat.id)],
    );
  } catch (error) {
    console.error("[warnings] group registry update failed:", error);
  }
}

async function warningSettingsFor(chatId: string) {
  if (!studioPool) return null;
  const r = await studioPool.query(
    "SELECT group_id,auto_expire_enabled,expire_after_days,notify_private,exempt_admins,permanent_threshold FROM warning_system_settings WHERE group_id=$1 LIMIT 1",
    [chatId],
  );
  return r.rows[0] ?? null;
}

function warningDurationSeconds(value: unknown, unit: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(30, Math.round(n * (String(unit) === "days" ? 86400 : 3600)));
}

async function warningTargetIsExempt(groupId: string, userId: string) {
  const settings = await warningSettingsFor(groupId);
  if (!settings?.exempt_admins) return false;
  try {
    const r = await telegramApi<any>("getChatMember", { chat_id: groupId, user_id: userId });
    return r.ok && ["administrator", "creator"].includes(String(r.result?.status ?? ""));
  } catch {
    return false;
  }
}

async function recalcWarningCase(groupId: string, userId: string) {
  if (!studioPool) return;
  const count = Number(
    (await studioPool.query(
      "SELECT COUNT(*)::int AS count FROM warning_events WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",
      [groupId, userId],
    )).rows[0]?.count ?? 0,
  );
  const level = Number(
    (await studioPool.query(
      "SELECT COALESCE(MAX(level_no),0)::int AS level_no FROM warning_events WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",
      [groupId, userId],
    )).rows[0]?.level_no ?? 0,
  );
  const penalized = (await studioPool.query(
    "SELECT 1 FROM warning_penalties WHERE group_id=$1 AND user_id=$2 AND status='active' LIMIT 1",
    [groupId, userId],
  )).rowCount > 0;
  await studioPool.query(
    "UPDATE warning_cases SET warning_count=$3,current_level=$4,status=$5,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",
    [groupId, userId, count, level, penalized ? "penalized" : count > 0 ? "active" : "cleared"],
  );
}

async function warningQueueFail(row: any, error: unknown) {
  if (!studioPool) return;
  const attempts = Number(row.attempts ?? 0);
  const retry = attempts < 4;
  const message = String((error as any)?.message ?? error);
  await studioPool.query(
    "UPDATE warning_action_queue SET status=$1,last_error=$2,available_at=CASE WHEN $3 THEN NOW()+INTERVAL '30 seconds' ELSE available_at END,processed_at=CASE WHEN $3 THEN NULL ELSE NOW() END WHERE id=$4",
    [retry ? "pending" : "failed", message, retry, row.id],
  );
  if (row.penalty_id) {
    await studioPool.query(
      "UPDATE warning_penalties SET status=$1 WHERE id=$2",
      [retry ? "pending" : "failed", row.penalty_id],
    );
  }
  if (row.event_id) {
    await studioPool.query(
      "UPDATE warning_events SET result=$1 WHERE id=$2",
      [retry ? "retry_pending" : "failed", row.event_id],
    );
  }
}

async function executeWarningQueue(row: any) {
  if (!studioPool) return;

  if (row.action_type === "warning_notify") {
    if (await warningTargetIsExempt(String(row.group_id), String(row.user_id))) {
      await studioPool.query(
        "UPDATE warning_events SET status='exempted',result='admin_exempted' WHERE id=$1",
        [row.event_id],
      );
      await recalcWarningCase(String(row.group_id), String(row.user_id));
      return;
    }

    const sent = await telegramApi("sendMessage", {
      chat_id: row.group_id,
      text: row.message || "اخطار برای این کاربر ثبت شد.",
    });
    if (!sent.ok) throw new Error(sent.description || "Telegram sendMessage failed");

    const settings = await warningSettingsFor(String(row.group_id));
    if (settings?.notify_private) {
      try {
        const privateSent = await telegramApi("sendMessage", {
          chat_id: row.user_id,
          text: row.message || "اخطار جدید برای شما ثبت شد.",
        });
        if (!privateSent.ok) {
          console.warn("[warnings] private notice skipped:", privateSent.description);
        }
      } catch (error) {
        console.warn("[warnings] private notice failed:", (error as any)?.message ?? error);
      }
    }

    await studioPool.query(
      "UPDATE warning_events SET result='sent' WHERE id=$1",
      [row.event_id],
    );
    return;
  }

  if (row.action_type !== "penalty_apply") return;

  if (await warningTargetIsExempt(String(row.group_id), String(row.user_id))) {
    if (row.penalty_id) {
      await studioPool.query(
        "UPDATE warning_penalties SET status='skipped' WHERE id=$1",
        [row.penalty_id],
      );
    }
    if (row.event_id) {
      await studioPool.query(
        "UPDATE warning_events SET status='exempted',result='admin_exempted' WHERE id=$1",
        [row.event_id],
      );
    }
    await recalcWarningCase(String(row.group_id), String(row.user_id));
    return;
  }

  const type = String(row.penalty_type || "");
  const args: Record<string, unknown> = {
    chat_id: Number(row.group_id),
    user_id: Number(row.user_id),
  };
  const seconds = warningDurationSeconds(row.duration_value, row.duration_unit);
  const untilDate = seconds ? Math.floor(Date.now() / 1000) + seconds : null;

  if (type === "mute" || type === "restrict") {
    if (untilDate) args.until_date = untilDate;
    args.permissions = {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    };
    args.use_independent_chat_permissions = true;
    const r = await telegramApi("restrictChatMember", args);
    if (!r.ok) throw new Error(r.description || "Telegram restrictChatMember failed");
  } else if (type === "temp_ban" || type === "permanent_ban") {
    if (untilDate && type === "temp_ban") args.until_date = untilDate;
    const r = await telegramApi("banChatMember", args);
    if (!r.ok) throw new Error(r.description || "Telegram banChatMember failed");
  } else {
    throw new Error("Unsupported penalty type: " + type);
  }

  const expires = seconds && type !== "permanent_ban" ? new Date(Date.now() + seconds * 1000) : null;
  if (row.penalty_id) {
    await studioPool.query(
      "UPDATE warning_penalties SET status='active',expires_at=$1,applied_at=NOW() WHERE id=$2",
      [expires, row.penalty_id],
    );
  }
  if (row.event_id) {
    await studioPool.query(
      "UPDATE warning_events SET result='applied',status='active',expires_at=COALESCE($1,expires_at) WHERE id=$2",
      [expires, row.event_id],
    );
  }
  await recalcWarningCase(String(row.group_id), String(row.user_id));
}

async function processWarningQueue() {
  if (!studioPool || !process.env.BOT_TOKEN) return;

  const client = await studioPool.connect();
  let row: any = null;
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "SELECT * FROM warning_action_queue WHERE status='pending' AND available_at<=NOW() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!r.rows[0]) {
      await client.query("COMMIT");
      return;
    }
    row = r.rows[0];
    await client.query(
      "UPDATE warning_action_queue SET status='processing',attempts=attempts+1 WHERE id=$1",
      [row.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[warnings] queue claim failed:", error);
    return;
  } finally {
    client.release();
  }

  try {
    await executeWarningQueue(row);
    await studioPool.query(
      "UPDATE warning_action_queue SET status='success',processed_at=NOW(),last_error=NULL WHERE id=$1",
      [row.id],
    );
  } catch (error) {
    console.error("[warnings] action failed:", error);
    await warningQueueFail(row, error);
  }
}

async function restoreExpiredPenalty(groupId: string, userId: string, penaltyType: string) {
  if (penaltyType === "temp_ban") {
    const r = await telegramApi("unbanChatMember", {
      chat_id: Number(groupId),
      user_id: Number(userId),
      only_if_banned: true,
    });
    if (!r.ok) throw new Error(r.description || "Telegram unbanChatMember failed");
    return;
  }
  if (penaltyType === "mute" || penaltyType === "restrict") {
    const r = await telegramApi("restrictChatMember", {
      chat_id: Number(groupId),
      user_id: Number(userId),
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
      },
      use_independent_chat_permissions: true,
    });
    if (!r.ok) throw new Error(r.description || "Telegram restore permissions failed");
  }
}

async function expireWarningState() {
  if (!studioPool) return;

  const expiredPenalties = (await studioPool.query(
    "SELECT id,group_id,user_id,penalty_type FROM warning_penalties WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=NOW() ORDER BY id LIMIT 50",
  )).rows;

  for (const row of expiredPenalties) {
    try {
      await restoreExpiredPenalty(String(row.group_id), String(row.user_id), String(row.penalty_type));
      await studioPool.query(
        "UPDATE warning_penalties SET status='expired' WHERE id=$1",
        [row.id],
      );
    } catch (error) {
      console.error("[warnings] expiry restore failed:", error);
      continue;
    }
    await recalcWarningCase(String(row.group_id), String(row.user_id));
  }

  const expiredWarnings = (await studioPool.query(
    "UPDATE warning_events SET status='expired',result='expired' WHERE action_type='warning' AND status='active' AND expires_at IS NOT NULL AND expires_at<=NOW() RETURNING group_id,user_id",
  )).rows;

  const keys = new Map<string, [string, string]>();
  for (const row of expiredWarnings) {
    keys.set(String(row.group_id) + ":" + String(row.user_id), [String(row.group_id), String(row.user_id)]);
  }
  for (const [groupId, userId] of keys.values()) {
    await recalcWarningCase(groupId, userId);
  }
}

function startWarningWorker() {
  void processWarningQueue();
  void expireWarningState();
  setInterval(() => void processWarningQueue(), 2000);
  setInterval(() => void expireWarningState(), 30000);
}


async function refreshStudio() {
  const url=process.env.DATABASE_URL;
  if(!url)return;
  studioPool??=new Pool({connectionString:url,max:2});
  try{
    const result=await studioPool.query<{config:StudioDocument}>("select config from bot_studio_panel where id=1 limit 1");
    if(result.rows[0]?.config)studio=mergeStudio(result.rows[0].config);
  }catch(error){console.error("[studio] refresh failed",error);}
  try{
    const result=await studioPool.query<PanelCommand>(`
      SELECT c.id,c.command_key,COALESCE(c.fa_name,'') AS fa_name,COALESCE(c.en_name,'') AS en_name,c.enabled,
      COALESCE(c.required_permission,'execute') AS required_permission,UPPER(COALESCE(c.minimum_role,'MEMBER')) AS minimum_role,
      COALESCE(c.response_fa,'') AS response_fa,COALESCE(c.response_en,'') AS response_en,
      COALESCE(json_agg(json_build_object('role',cp.role,'allowed',cp.allowed) ORDER BY cp.role) FILTER(WHERE cp.role IS NOT NULL),'[]'::json) AS permissions
      FROM commands c LEFT JOIN command_permissions cp ON cp.command_id=c.id GROUP BY c.id ORDER BY c.id
    `);
    panelCommands=result.rows;
    await studioPool.query(
      "UPDATE commands SET response_fa='', response_en='' WHERE response_fa LIKE '%{{live_card}}%' OR response_en LIKE '%{{live_card}}%'"
    );
  }catch(error){console.error("[command-access] refresh failed",error);panelCommands=[];}
}

function mergeStudio(value: Partial<StudioDocument>): StudioDocument {
  const base = cloneStudioDefaults();
  return {
    ...base,
    ...value,
    settings: { ...base.settings, ...(value.settings ?? {}) },
    capabilities: Array.isArray(value.capabilities) ? value.capabilities : base.capabilities,
    commands: base.commands.map((b) => ({ ...b, ...(Array.isArray(value.commands) ? value.commands.find((x) => x.id === b.id) : undefined) })),
    responseTemplates: Array.isArray(value.responseTemplates) && value.responseTemplates.length ? value.responseTemplates : base.responseTemplates,
  };
}

function normalizeCommand(text: string) {
  return text.trim().replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ").toLowerCase();
}

function commandMatches(text: string, aliases: string[]) {
  const raw = text.trim().replace(/^[\\/!.]+/, "").trim();
  const normalized = normalizeCommand(raw);
  const targets = aliases.map(normalizeCommand).filter(Boolean).sort((a,b)=>b.length-a.length);
  return targets.some((target) => normalized === target || normalized.startsWith(target + " "));
}

function isPanelTriggerMessage(text: string) {
  const raw = String(text ?? "").trim().replace(/^[\\/!.]+/, "").trim();
  if (!raw || raw.startsWith("@") || /^-?\\d+$/.test(raw)) return false;
  const exact = normalizeCommand(raw);
  return new Set(["panel","پنل","owner","مالک","config","پیکربندی"]).has(exact);
}

const PANEL_ROLE_ORDER: PanelRole[] = ["MEMBER","SPECIAL_USER","MODERATOR","ADMIN","SUPER_ADMIN","OWNER"];
type PanelRole = typeof PANEL_ROLE_ORDER[number];
type PanelCommand = { id:number; command_key:string; fa_name:string; en_name:string; enabled:boolean; required_permission:string; minimum_role:PanelRole; response_fa:string; response_en:string; permissions:Array<{role:PanelRole;allowed:boolean}> };

function panelRoleForRank(rank: Rank): PanelRole {
  if(rank==="owner") return "OWNER";
  if(rank==="sudo") return "SUPER_ADMIN";
  if(rank==="admin") return "ADMIN";
  return "MEMBER";
}
function panelRoleAtLeast(have:PanelRole, need:PanelRole){ return PANEL_ROLE_ORDER.indexOf(have)>=PANEL_ROLE_ORDER.indexOf(need); }
function normalizeRole(value:unknown):PanelRole {
  const role=String(value??"").trim().toUpperCase();
  return (PANEL_ROLE_ORDER as string[]).includes(role) ? role as PanelRole : "MEMBER";
}
async function resolvePanelRole(ctx:BotContext):Promise<PanelRole>{
  const fallback=panelRoleForRank(ctx.userRank);
  if(!studioPool)return fallback;
  try{
    const r=await studioPool.query<{role:string}>("SELECT role FROM users WHERE telegram_id=$1 AND is_active=TRUE LIMIT 1",[ctx.userId]);
    return r.rows[0]?.role ? normalizeRole(r.rows[0].role) : fallback;
  }catch(error){ console.error("[command-access] role lookup failed",error); return fallback; }
}
async function hasPanelPermission(ctx:BotContext,role:PanelRole,permission:string){
  if(role==="OWNER")return true;
  if(!studioPool)return permission==="view";
  try{
    const custom=await studioPool.query<{allowed:boolean}>("SELECT allowed FROM user_permissions WHERE user_id=$1 AND permission_key=$2 LIMIT 1",[String(ctx.userId),permission]);
    if(custom.rows[0])return custom.rows[0].allowed===true;
    const r=await studioPool.query<{allowed:boolean}>("SELECT allowed FROM role_permissions WHERE role=$1 AND permission_key=$2 LIMIT 1",[role,permission]);
    return r.rows[0]?.allowed===true;
  }catch(error){ console.error("[command-access] permission lookup failed",error); return false; }
}
async function authorizeStudioCommand(ctx:BotContext,command:typeof studio.commands[number]){
  const role=await resolvePanelRole(ctx);
  if(ctx.userRank==="sudo"){
    const sudo=await getOwnerSudo(studioPool!,ctx.userId).catch(()=>null);
    if(sudo && !ownerSudoAllowsCommand(sudo.level,command.id)){
      await logCommandAccess(ctx,command.id,"permission_denied","sudo_level_restricted",role);
      return {allowed:false,role,reason:"sudo_level_restricted"};
    }
  }
  const aliases=[...command.aliasesEn,...command.aliasesFa,command.id];
  const panel=panelCommands.find(item=>aliases.some(a=>normalizeCommand(item.command_key)===normalizeCommand(a)||normalizeCommand(item.en_name)===normalizeCommand(a)||normalizeCommand(item.fa_name)===normalizeCommand(a)));
  if(panel&&!panel.enabled)return {allowed:false,role,reason:"disabled"};
  const minimum=panel?normalizeRole(panel.minimum_role):panelRoleForRank(command.minRank);
  if(!panelRoleAtLeast(role,minimum))return {allowed:false,role,reason:"minimum_role"};
  if(panel){
    const row=panel.permissions.find(x=>normalizeRole(x.role)===role);
    if(row&&row.allowed!==true)return {allowed:false,role,reason:"command_role"};
  }
  const required=panel?.required_permission || (command.minRank==="member"?"view":"execute");
  if(!(await hasPanelPermission(ctx,role,required)))return {allowed:false,role,reason:"permission"};
  return {allowed:true,role,reason:"allowed"};
}
async function logCommandAccess(ctx:BotContext,key:string,eventType:"command_executed"|"permission_denied",reason:string,role:PanelRole){
  if(!studioPool)return;
  try{
    await studioPool.query("INSERT INTO supervision_events (event_type,severity,actor_id,target_type,target_id,command_key,group_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[eventType,eventType==="permission_denied"?"warning":"info",String(ctx.userId),"command",key,key,ctx.chatId,JSON.stringify({role,reason})]);
  }catch(error){ console.error("[command-access] audit failed",error); }
}

async function studioReplyLive(ctx: BotContext): Promise<string | null> {
  const raw=ctx.text.trim();
  if(!raw)return null;
  const gameResult=await handleGameText({pool:studioPool!,chatId:ctx.chatId,userId:ctx.userId,user:{id:ctx.userId,username:ctx.userUsername,first_name:ctx.userName},isAdmin:["owner","sudo","admin"].includes(ctx.userRank),replyToUserId:ctx.replyToUserId,replyToName:ctx.replyToName},raw);
  if(gameResult!==null)return gameResult;
  const commandText=raw.replace(/^[\\/!.]+/,"").trim();
  if(!commandText)return null;
  const token=normalizeCommand(commandText);
  const commandArgs=commandText.split(/\\s+/).slice(1);
  if(["lang","language","زبان","تغییر زبان"].includes(token)){
    if(!rankAtLeast(ctx.userRank,"admin")){
      return ctx.lang==="fa" ? "✗ فقط مدیر گروه یا مالک می‌تواند زبان گروه را تغییر دهد." : "✗ Only a group admin or owner can change the group language.";
    }
    const selected=normalizeBotLang(commandArgs.join(" "));
    if(!selected){
      const options=SUPPORTED_LANGUAGES.map(x=>x.code+" · "+x.native).join("\n");
      return languagePickerText(ctx.lang,ctx.chatTitle)+"\n\n"+options;
    }
    await setGroupLanguage(studioPool!,ctx.chatId,selected);
    ctx.lang=selected;
    await logCommandAccess(ctx,"lang","command_executed","allowed","ADMIN");
    return languageChangedText(selected);
  }
  const coreNoArgIds=new Set(["robot","id","admin","info","rank","me","ping","bot","status","special"]);
  const coreNoArgAliases=new Set([
    "robot","id","admin","info","rank","me","ping","bot","status","special",
    "ربات","آیدی","ادمین","اطلاعات","مقام","اطلاعات مقام","من","پینگ","بات","وضعیت","ویژه"
  ]);
  const studioCommand=studio.commands.find(item=>{
    if(!item.enabled||item.phase>2)return false;
    const aliases=[...item.aliasesFa,...item.aliasesEn].map(normalizeCommand);
    if(coreNoArgIds.has(item.id))return aliases.includes(token);
    return commandMatches(token,aliases);
  });
  const panelCommand=panelCommands.find(item=>{
    const aliases=[item.command_key,item.fa_name,item.en_name].map(normalizeCommand);
    const isCoreNoArgAlias=aliases.some(alias=>coreNoArgAliases.has(alias));
    return isCoreNoArgAlias ? aliases.includes(token) : commandMatches(token,aliases);
  });
  if(!studioCommand && !panelCommand)return null;

  // «من» is the single text command that members may use; all other commands are admin+.
  const panelIsMe = panelCommand
    ? [panelCommand.command_key,panelCommand.fa_name,panelCommand.en_name]
        .some(value => ["me","من"].includes(normalizeCommand(value)))
    : false;
  const isMemberSelfCommand = studioCommand?.id==="me" || panelIsMe;
  if(ctx.userRank==="member" && !isMemberSelfCommand){
    const deniedKey = studioCommand?.id || panelCommand?.command_key || "unknown";
    await logCommandAccess(ctx,deniedKey,"permission_denied","member_command_blocked",panelRoleForRank(ctx.userRank));
    return ctx.lang==="fa"
      ? "✗ کاربران عادی اجازه اجرای دستورات نوشتاری را ندارند."
      : "✗ Regular members are not allowed to execute text commands.";
  }

  if(studioCommand){
    const auth=await authorizeStudioCommand(ctx,studioCommand);
    if(!auth.allowed){
      await logCommandAccess(ctx,studioCommand.id,"permission_denied",auth.reason,auth.role);
      return ctx.lang==="fa"?"✗ دسترسی کافی برای اجرای این دستور را ندارید.":"✗ You do not have permission to execute this command.";
    }

    try{
      const commandArgs=raw.split(/\\s+/).slice(1);
      // Core identity commands without arguments are exact-only. This prevents
      // ordinary sentences such as «من امروز رفتم...» from being interpreted as «من».
      if(["robot","id","admin","info","rank","me","ping","bot","status"].includes(studioCommand.id) && commandArgs.length>0){
        return null;
      }
      if(["warn","mute","perm_mute","ban","unmute","unban"].includes(studioCommand.id) && ctx.userRank==="sudo"){
        const targetId=ctx.replyToUserId ?? Number(commandArgs[0]?.replace(/^@/,""));
        const protectedOwnerIds=new Set(["8247710529",...config.ownerIds]);
        if(Number.isSafeInteger(Number(targetId)) && protectedOwnerIds.has(String(targetId))){
          await logCommandAccess(ctx,studioCommand.id,"permission_denied","sudo_security_owner_protected",auth.role);
          return ctx.lang==="fa"
            ? "✗ این عملیات روی مالک توسط سودو مسدود است."
            : "✗ Sudo security blocks this operation against an owner.";
        }
      }
      if(["warn","mute","perm_mute","ban"].includes(studioCommand.id)){
        const targetId=ctx.replyToUserId ?? Number(commandArgs[0]?.replace(/^@/,""));
        if(!Number.isSafeInteger(Number(targetId)) || Number(targetId)<=0){
          await logCommandAccess(ctx,studioCommand.id,"command_executed","missing_target",auth.role);
          return ctx.lang==="fa" ? "✗ کاربر مشخص نیست. روی پیام کاربر ریپلای کنید یا آیدی او را وارد کنید." : "✗ Target user not specified. Reply to the user's message or provide their numeric ID.";
        }
        const opened=await openModerationCenterFromCommand(studioPool!,ctx.chatId,ctx.userId,studioCommand.id,Number(targetId));
        await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
        if(!opened?.ok) return ctx.lang==="fa" ? "✗ بازکردن مرکز مجازات ناموفق بود: "+(opened?.description||"خطای Telegram") : "✗ Could not open the moderation center.";
        return null;
      }
      if(["unmute","unban"].includes(studioCommand.id)){
        const liveCard=await runModerationCommand(studioPool!,ctx,studioCommand.id,commandArgs);
        await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
        return liveCard;
      }
      if(studioCommand.id==="date"){
        const opened=await openDateCenterFromCommand(studioPool!,{
          chatId:ctx.chatId,userId:ctx.userId,chatType:ctx.chatType,userRank:ctx.userRank,
          lang:ctx.lang==="en"?"en":"fa",userName:ctx.userName,chatTitle:ctx.chatTitle
        },commandArgs);
        await logCommandAccess(ctx,"date","command_executed",opened?.ok===false?"date_center_failed":"allowed",auth.role);
        return null;
      }
      if(studioCommand.id==="link"){
        if(ctx.chatType==="private"){
          await logCommandAccess(ctx,studioCommand.id,"permission_denied","group_only",auth.role);
          return ctx.lang==="fa"?"✗ مرکز لینک فقط داخل گروه قابل استفاده است.":"✗ Link Center is available only inside groups.";
        }
        const opened=await openInviteLinkCenter(studioPool!,ctx.chatId,ctx.userId);
        if(!opened.ok){
          await logCommandAccess(ctx,studioCommand.id,"permission_denied",String((opened as any).error||"invite_permission"),auth.role);
          return ctx.lang==="fa"?"✗ دسترسی به مدیریت لینک‌های دعوت برای شما فعال نیست.":"✗ You do not have permission to manage invite links in this group.";
        }
        await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
        return null;
      }
      if(studioCommand.id==="lock" && ["","ها","قفل‌ها","قفل ها","وضعیت","status"].includes(normalizeCommand(commandArgs.join(" ")))){
        const opened=await sendContentLockCenter(studioPool!,ctx.chatId,ctx.userId,"command");
        await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
        if(!opened.ok)return ctx.lang==="fa"?"✗ بازکردن مرکز قفل ناموفق بود.":"✗ Could not open the lock center.";
        return null;
      }
      if(studioCommand.id==="rank" && studioPool){
        const opened=await openManagerCenterFromCommand(studioPool,ctx.chatId,ctx.userId);
        await logCommandAccess(ctx,"rank","command_executed",opened.ok?"allowed":"manager_center_failed",auth.role);
        if(!opened.ok){
          return ctx.lang==="fa"?"✗ بازکردن مرکز مدیران ناموفق بود.":"✗ Could not open the manager center.";
        }
        return null;
      }
      if(studioCommand.id==="id"){
        const targetId=Number(ctx.replyToUserId||ctx.userId);
        let target:any=null;
        if(ctx.replyToUserId){
          const member=await telegramApi<any>("getChatMember",{chat_id:ctx.chatId,user_id:targetId});
          if(member.ok) target=member.result;
        }
        const targetUser=target?.user||{id:targetId,first_name:ctx.replyToUserId?(ctx.replyToName||String(targetId)):ctx.userName,username:ctx.replyToUserId?undefined:ctx.userUsername};
        const targetRank=ctx.replyToUserId
          ? (String(target?.status||"")==="creator"?"owner":String(target?.status||"")==="administrator"?"admin":"member")
          : ctx.userRank;
        const targetCtx:any={...ctx,userId:targetId,userName:displayName(targetUser),userUsername:targetUser.username,userRank:targetRank,replyToUserId:undefined,replyToName:undefined};
        const liveCard=await runLiveCommand({...targetCtx,messageId:0},"id",[]);

        let photo:string|undefined;
        const photos=await telegramApi<any>("getUserProfilePhotos",{user_id:targetId,offset:0,max:1});
        if(photos.ok&&Number(photos.result?.total_count||0)>0){
          const sizes=photos.result?.photos?.[0];
          photo=sizes?.[sizes.length-1]?.file_id;
        }

        const rich_message=buildIdRichMessage(liveCard,ctx.lang,photo);
        const rich=await telegramApi("sendRichMessage",{chat_id:ctx.chatId,rich_message});
        if(rich.ok){
          await logCommandAccess(ctx,"id","command_executed","allowed",auth.role);
          return null;
        }

        console.warn("[id-command] Rich Message failed; falling back to legacy output:",rich.description);
        if(photo){
          await telegramApi("sendPhoto",{chat_id:ctx.chatId,photo,caption:liveCard,reply_to_message_id:ctx.replyToMessageId});
        }else{
          await telegramApi("sendMessage",{chat_id:ctx.chatId,text:liveCard,reply_to_message_id:ctx.replyToMessageId});
        }
        await logCommandAccess(ctx,"id","command_executed","allowed_rich_fallback",auth.role);
        return null;
      }
      const liveCard=(["lock","unlock","lockall","unlockall"].includes(studioCommand.id) && studioPool)
        ? await runContentLockCommand(studioPool,{chatId:ctx.chatId,userId:ctx.userId,userRank:ctx.userRank,lang:ctx.lang,chatTitle:ctx.chatTitle},studioCommand.id,commandArgs)
        : await runLiveCommand({...ctx,messageId:0},studioCommand.aliasesEn[0]??studioCommand.id,commandArgs);
      await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
      const values:Record<string,string>={
        user_name:ctx.userName,
        username:ctx.userUsername?"@"+ctx.userUsername.replace(/^@/,""):"ثبت نشده",
        user_id:String(ctx.userId),
        rank:ctx.lang==="fa" ? (ctx.userRank==="owner" ? "مالک" : ctx.userRank==="member" ? "کاربر" : "مدیر") : (ctx.userRank==="owner" ? "owner" : ctx.userRank==="member" ? "member" : "manager"),
        chat_title:ctx.chatTitle,
        chat_id:String(ctx.chatId),
        chat_type:ctx.chatType,
        members_count:String(ctx.membersCount),
        admins_count:String(ctx.staff.length),
        live_card:liveCard,
        robot_line:liveCard,
        admin_result:liveCard,
        rank_card:liveCard,
        me_card:liveCard,
        ping_card:liveCard,
        bot_card:liveCard,
        status_card:liveCard,
        messages_today: String(getGroupStats(ctx.chatId).messagesToday),
        messages_total: String(getGroupStats(ctx.chatId).messagesTotal),
        chat_username: ctx.chatUsername ?? "—"
      };
      const configuredTemplate=ctx.lang==="fa"?panelCommand?.response_fa:panelCommand?.response_en;
      const coreLiveIds=new Set(["robot","id","admin","info","rank","me","ping","bot","status"]);
      if(coreLiveIds.has(studioCommand.id)){
        if(configuredTemplate && configuredTemplate.includes("{{live_card}}")){
          return renderStudioTemplate(configuredTemplate,values);
        }
        // Core information/status commands must never use a stale static panel template.
        return liveCard;
      }
      const selected=(configuredTemplate && configuredTemplate.trim())
        ? configuredTemplate
        : (ctx.lang==="fa"?studioCommand.responseFa:studioCommand.responseEn);
      if(!selected.trim()) return liveCard;
      return renderStudioTemplate(selected,values);
    }catch(error){
      console.error("[studio-command]",error);
      return ctx.lang==="fa"?"✗ اجرای دستور ناموفق بود؛ دسترسی ربات یا هدف را بررسی کنید.":"✗ Command failed; check bot permissions or target.";
    }
  }

  const role=await resolvePanelRole(ctx);
  if(panelCommand && !panelCommand.enabled){
    await logCommandAccess(ctx,panelCommand.command_key,"permission_denied","disabled",role);
    return ctx.lang==="fa"?"✗ این دستور غیرفعال است.":"✗ This command is disabled.";
  }
  const minimum=panelCommand?normalizeRole(panelCommand.minimum_role):"MEMBER";
  if(!panelRoleAtLeast(role,minimum)){
    await logCommandAccess(ctx,panelCommand.command_key,"permission_denied","minimum_role",role);
    return ctx.lang==="fa"?"✗ دسترسی کافی برای اجرای این دستور را ندارید.":"✗ You do not have permission to execute this command.";
  }
  const row=panelCommand.permissions.find(x=>normalizeRole(x.role)===role);
  if(row && row.allowed!==true){
    await logCommandAccess(ctx,panelCommand.command_key,"permission_denied","command_role",role);
    return ctx.lang==="fa"?"✗ دسترسی کافی برای اجرای این دستور را ندارید.":"✗ You do not have permission to execute this command.";
  }
  if(!(await hasPanelPermission(ctx,role,panelCommand.required_permission))){
    await logCommandAccess(ctx,panelCommand.command_key,"permission_denied","permission",role);
    return ctx.lang==="fa"?"✗ دسترسی کافی برای اجرای این دستور را ندارید.":"✗ You do not have permission to execute this command.";
  }
  const template=ctx.lang==="fa"?panelCommand.response_fa:panelCommand.response_en;
  if(!template.trim()) return ctx.lang==="fa"?"✓ دستور شناسایی شد، اما پاسخ آن در پنل تنظیم نشده است.":"✓ Command recognized, but its response is not configured in the panel.";
  const values:Record<string,string>={
    user_name:ctx.userName,
    username:ctx.userUsername?"@"+ctx.userUsername.replace(/^@/,""):"ثبت نشده",
    user_id:String(ctx.userId),
    rank:ctx.userRank,
    chat_title:ctx.chatTitle,
    chat_id:String(ctx.chatId),
    chat_type:ctx.chatType,
    members_count:String(ctx.membersCount),
    admins_count:String(ctx.staff.length),
    messages_today:"—",
    messages_total:"—",
    live_card:"—"
  };
  await logCommandAccess(ctx,panelCommand.command_key,"command_executed","allowed",role);
  return renderStudioTemplate(template,values);
}

function render(template: string, ctx: BotContext) {
  const values: Record<string, string> = {
    user_name: ctx.userName,
    username: ctx.userUsername ? "@"+ctx.userUsername.replace(/^@/,"") : "ثبت نشده",
    user_id: String(ctx.userId),
    rank: ctx.userRank,
    chat_title: ctx.chatTitle,
    chat_id: String(ctx.chatId),
    chat_type: ctx.chatType,
    members_count: String(ctx.membersCount),
    admins_count: String(ctx.staff.length),
    latency_ms: "—",
    database_status: process.env.DATABASE_URL ? "متصل" : "local",
    live_card: "—",
    version: studio.version,
    bot_name: config.botName,
    bot_username: config.botUsername,
    bot_id: "—",
    permissions: ctx.userRank === "owner" ? "کامل" : ctx.userRank === "member" ? "عادی" : "مدیریتی",
    panels: ctx.userRank === "owner" ? "کامل" : ctx.userRank === "admin" ? "مدیران" : "شخصی",
    media_locks: "فعال",
    link_locks: "فعال",
    identity_locks: "فعال",
    sharing_locks: "فعال",
    behavior_locks: "فعال",
    messages_today: "—",
    messages_total: "—",
    warnings_active: "—",
    warnings_total: "—",
    last_warning_reason: "—",
    target: ctx.replyToName ?? "—",
    target_id: ctx.replyToUserId ? String(ctx.replyToUserId) : "—",
    operator: ctx.userName,
    violation_reports: "—",
    security_reports: "—",
    audit_count: "—",
    today_reports: "—",
    special_count: "—",
    muted_count: "—",
    restricted_count: "—",
    blacklist_count: "—",
  };
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_, key) => values[key] ?? "—");
}

const adminCache = new Map<number, { at: number; ids: Set<number> }>();

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
type TgChat = { id: number; type: string; title?: string; username?: string };
type TgMessage = ContentLockMessage & { chat: TgChat; from?: TgUser; reply_to_message?: { from?: TgUser }; new_chat_members?: TgUser[]; left_chat_member?: TgUser };
type TgChatMemberUpdate = { chat: TgChat; from?: TgUser; date?: number; old_chat_member?: { status?: string; user?: TgUser }; new_chat_member?: { status?: string; user?: TgUser; invite_link?: any } };
type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: {id:string;from?:TgUser;message?:TgMessage;data?:string}; my_chat_member?: TgChatMemberUpdate; chat_member?: TgChatMemberUpdate; chat_join_request?: { chat?: TgChat; from?: TgUser; user_chat_id?: number; date?: number; invite_link?: any } };

function splitIds(raw: string | undefined): string[] {
  return (raw ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function rankOf(userId: number, adminIds: Set<number>): Rank {
  const id = String(userId);
  if (config.ownerIds.includes(id)) return "owner";
  if (isManagedOwnerSudo(userId)) return "sudo";
  if (config.sudoIds.includes(id)) return "sudo";
  if (adminIds.has(userId)) return "admin";
  return "member";
}

function displayName(user:TgUser){
  return [user.first_name,user.last_name].filter(Boolean).join(" ").trim() || (user.username ? "@"+user.username : String(user.id));
}
function hasTrackableUserContent(msg:TgMessage){
  const m:any=msg;
  return Boolean(
    String(m.text??"").trim() ||
    String(m.caption??"").trim() ||
    m.photo || m.video || m.audio || m.document || m.animation || m.sticker ||
    m.voice || m.video_note || m.contact || m.location || m.venue || m.poll || m.dice || m.game
  );
}
async function memberJoinDateFromDb(chatId:number,userId:number){
  if(!studioPool)return undefined;
  try{
    const r=await studioPool.query("SELECT joined_at FROM bot_member_profiles WHERE group_id=$1 AND user_id=$2 LIMIT 1",[chatId,userId]);
    const value=r.rows[0]?.joined_at;
    if(!value)return undefined;
    const ts=new Date(value).getTime();
    return Number.isFinite(ts)?ts:undefined;
  }catch(error){
    console.error("[member-profile] join date lookup failed:",error);
    return undefined;
  }
}
async function getUserJoinStats(chatId:number,userId:number){
  if(!studioPool)return {today:0,total:0};
  try{
    const r=await studioPool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE (joined_at AT TIME ZONE 'Asia/Tehran')::date =
                 (NOW() AT TIME ZONE 'Asia/Tehran')::date
         )::int AS today
       FROM bot_member_join_events
       WHERE group_id=$1 AND user_id=$2`,
      [chatId,userId],
    );
    return {
      today:Number(r.rows[0]?.today ?? 0),
      total:Number(r.rows[0]?.total ?? 0),
    };
  }catch(error){
    console.error("[member-stats] join stats lookup failed:",error);
    return {today:0,total:0};
  }
}

async function persistMemberJoin(chatId:number,user:TgUser,ts:number){
  if(!studioPool||user.is_bot)return;
  try{
    const event=await studioPool.query(
      `INSERT INTO bot_member_join_events(group_id,user_id,username,first_name,last_name,joined_at)
       VALUES($1,$2,$3,$4,$5,TO_TIMESTAMP($6/1000.0))
       ON CONFLICT(group_id,user_id,joined_at) DO NOTHING
       RETURNING id`,
      [chatId,user.id,user.username??null,user.first_name??null,user.last_name??null,ts],
    );
    if(!event.rowCount)return;

    await studioPool.query(
      `INSERT INTO bot_member_profiles(group_id,user_id,username,first_name,last_name,joined_at,last_seen_at,updated_at,join_count)
       VALUES($1,$2,$3,$4,$5,TO_TIMESTAMP($6/1000.0),NOW(),NOW(),1)
       ON CONFLICT(group_id,user_id) DO UPDATE SET
         username=EXCLUDED.username,
         first_name=EXCLUDED.first_name,
         last_name=EXCLUDED.last_name,
         joined_at=EXCLUDED.joined_at,
         last_seen_at=NOW(),
         updated_at=NOW(),
         join_count=bot_member_profiles.join_count+1`,
      [chatId,user.id,user.username??null,user.first_name??null,user.last_name??null,ts],
    );
  }catch(error){
    console.error("[member-profile] join persistence failed:",error);
  }
}
async function getGroupInfoSnapshot(chatId:number):Promise<GroupInfoSnapshot>{
  const zero:GroupInfoSnapshot={
    messagesToday:0,messagesWeek:0,messagesMonth:0,messagesTotal:0,
    activeDays:0,averageDaily:0,busiestHour:null,busiestDay:null,activeUsers:0,
    joinsToday:0,joinsWeek:0,joinsMonth:0,joinsTotal:0,
    leavesToday:0,leavesWeek:0,leavesMonth:0,leavesTotal:0,
    specialCount:0,mutedCount:0,
    warningsActive:0,warningsToday:0,warningsWeek:0,warningsTotal:0,
    deletedToday:0,deletedWeek:0,deletedTotal:0,
    activeLocks:0,violationsToday:0,violationsWeek:0,violationsTotal:0,
    moderationActionsToday:0,
    inviteUsageToday:0,inviteUsageWeek:0,inviteUsageMonth:0,inviteUsageTotal:0,
  };
  if(!studioPool)return zero;

  const q=async<T=any>(sql:string,params:unknown[]=[]):Promise<T|undefined>=>{
    try{
      const r=await studioPool!.query<T>(sql,params);
      return r.rows[0];
    }catch(error){
      console.error("[group-info] query failed:",error);
      return undefined;
    }
  };

  try{
    await ensureGroupInfoSchema(studioPool);
    await ensureMessageToolsSchema(studioPool);
    await ensureContentLocks(studioPool,chatId);
  }catch(error){
    console.error("[group-info] schema bootstrap failed:",error);
  }

  const [msg,join,leave,special,muted,warn,locks,violations,actions,invites,invTotal,hour,weekday]=await Promise.all([
    q<any>(`
      WITH m AS (
        SELECT COALESCE(TO_TIMESTAMP(telegram_date),created_at) AS ts
        FROM bot_message_records WHERE chat_id=$1
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE (ts AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date)::int AS today,
        COUNT(*) FILTER (WHERE ts>=NOW()-INTERVAL '7 days')::int AS week,
        COUNT(*) FILTER (WHERE (ts AT TIME ZONE 'Asia/Tehran')>=date_trunc('month',NOW() AT TIME ZONE 'Asia/Tehran'))::int AS month,
        COUNT(DISTINCT (ts AT TIME ZONE 'Asia/Tehran')::date)::int AS active_days,
        COUNT(DISTINCT user_id) FILTER (WHERE ts>=NOW()-INTERVAL '30 minutes')::int AS active_users
      FROM (
        SELECT COALESCE(TO_TIMESTAMP(telegram_date),created_at) AS ts,user_id
        FROM bot_message_records WHERE chat_id=$1
      ) x
    `,[chatId]),
    q<any>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE (joined_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date)::int AS today,
        COUNT(*) FILTER (WHERE joined_at>=NOW()-INTERVAL '7 days')::int AS week,
        COUNT(*) FILTER (WHERE (joined_at AT TIME ZONE 'Asia/Tehran')>=date_trunc('month',NOW() AT TIME ZONE 'Asia/Tehran'))::int AS month
      FROM bot_member_join_events WHERE group_id=$1
    `,[chatId]),
    q<any>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE (left_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date)::int AS today,
        COUNT(*) FILTER (WHERE left_at>=NOW()-INTERVAL '7 days')::int AS week,
        COUNT(*) FILTER (WHERE (left_at AT TIME ZONE 'Asia/Tehran')>=date_trunc('month',NOW() AT TIME ZONE 'Asia/Tehran'))::int AS month
      FROM bot_member_leave_events WHERE group_id=$1
    `,[chatId]),
    q<any>(`
      SELECT COUNT(*)::int AS count
      FROM special_users
      WHERE group_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW())
    `,[chatId]),
    q<any>(`
      WITH latest AS (
        SELECT DISTINCT ON (target_id) target_id,action_type,status,created_at,duration_seconds
        FROM moderation_actions
        WHERE group_id=$1 AND action_type IN ('mute','unmute')
        ORDER BY target_id,created_at DESC,id DESC
      )
      SELECT COUNT(*) FILTER (
        WHERE action_type='mute' AND status='success'
          AND (duration_seconds IS NULL OR duration_seconds<=0
               OR created_at + (duration_seconds * INTERVAL '1 second')>NOW())
      )::int AS count
      FROM latest
    `,[chatId]),
    q<any>(`
      SELECT
        COUNT(*) FILTER (WHERE status='active' AND action_type='warning')::int AS active,
        COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date AND action_type='warning')::int AS today,
        COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days' AND action_type='warning')::int AS week,
        COUNT(*) FILTER (WHERE action_type='warning')::int AS total
      FROM warning_events WHERE group_id=$1
    `,[chatId]),
    q<any>(`
      SELECT COUNT(*)::int AS count
      FROM content_lock_rules r
      JOIN content_lock_settings s ON s.group_id=r.group_id
      WHERE r.group_id=$1 AND r.enabled=TRUE AND s.enabled=TRUE
    `,[chatId]),
    q<any>(`
      SELECT
        COUNT(*) FILTER (
          WHERE (created_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date
        )::int AS today,
        COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days')::int AS week,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE kind='deletion'
            AND (created_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date
        )::int AS deleted_today,
        COUNT(*) FILTER (WHERE kind='deletion' AND created_at>=NOW()-INTERVAL '7 days')::int AS deleted_week,
        COUNT(*) FILTER (WHERE kind='deletion')::int AS deleted_total
      FROM (
        SELECT created_at,'warning'::text AS kind
        FROM warning_events
        WHERE group_id=$1 AND action_type='warning'
        UNION ALL
        SELECT created_at,'deletion'::text AS kind
        FROM content_lock_logs
        WHERE group_id=$1 AND LOWER(action) IN ('delete','delete_notify','delete_ban','restrict','ban','blocked')
      ) v
    `,[chatId]),
    q<any>(`
      SELECT COUNT(*)::int AS count
      FROM moderation_actions
      WHERE group_id=$1 AND status='success'
        AND (created_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date
        AND action_type NOT IN ('unmute','unban')
    `,[chatId]),
    q<any>(`
      SELECT
        COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Tehran')::date=(NOW() AT TIME ZONE 'Asia/Tehran')::date)::int AS today,
        COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days')::int AS week,
        COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Tehran')>=date_trunc('month',NOW() AT TIME ZONE 'Asia/Tehran'))::int AS month,
        COUNT(*)::int AS total
      FROM invite_link_events WHERE group_id=$1 AND event_type='used'
    `,[chatId]),
    q<any>(`
      SELECT COALESCE(SUM(usage_count),0)::int AS total
      FROM group_invite_links WHERE group_id=$1
    `,[chatId]),
    q<any>(`
      SELECT EXTRACT(HOUR FROM (COALESCE(TO_TIMESTAMP(telegram_date),created_at) AT TIME ZONE 'Asia/Tehran'))::int AS hour
      FROM bot_message_records
      WHERE chat_id=$1
      GROUP BY 1 ORDER BY COUNT(*) DESC,1 ASC LIMIT 1
    `,[chatId]),
    q<any>(`
      SELECT EXTRACT(DOW FROM (COALESCE(TO_TIMESTAMP(telegram_date),created_at) AT TIME ZONE 'Asia/Tehran'))::int AS dow
      FROM bot_message_records
      WHERE chat_id=$1
      GROUP BY 1 ORDER BY COUNT(*) DESC,1 ASC LIMIT 1
    `,[chatId]),
  ]);

  const messagesTotal=Number(msg?.total??0);
  const activeDays=Number(msg?.active_days??0);
  const averageDaily=Math.round((messagesTotal/Math.max(1,activeDays))*10)/10;
  const joinsToday=Number(join?.today??0);
  const leavesToday=Number(leave?.today??0);

  return {
    messagesToday:Number(msg?.today??0),
    messagesWeek:Number(msg?.week??0),
    messagesMonth:Number(msg?.month??0),
    messagesTotal,
    activeDays,
    averageDaily,
    busiestHour:hour?.hour==null?null:Number(hour.hour),
    busiestDay:weekday?.dow==null?null:Number(weekday.dow),
    activeUsers:Number(msg?.active_users??0),
    joinsToday,
    joinsWeek:Number(join?.week??0),
    joinsMonth:Number(join?.month??0),
    joinsTotal:Number(join?.total??0),
    leavesToday,
    leavesWeek:Number(leave?.week??0),
    leavesMonth:Number(leave?.month??0),
    leavesTotal:Number(leave?.total??0),
    specialCount:Number(special?.count??0),
    mutedCount:Number(muted?.count??0),
    warningsActive:Number(warn?.active??0),
    warningsToday:Number(warn?.today??0),
    warningsWeek:Number(warn?.week??0),
    warningsTotal:Number(warn?.total??0),
    deletedToday:Number(violations?.deleted_today??0),
    deletedWeek:Number(violations?.deleted_week??0),
    deletedTotal:Number(violations?.deleted_total??0),
    activeLocks:Number(locks?.count??0),
    violationsToday:Number(violations?.today??0),
    violationsWeek:Number(violations?.week??0),
    violationsTotal:Number(violations?.total??0),
    moderationActionsToday:Number(actions?.count??0),
    inviteUsageToday:Number(invites?.today??0),
    inviteUsageWeek:Number(invites?.week??0),
    inviteUsageMonth:Number(invites?.month??0),
    inviteUsageTotal:Number(invTotal?.total??0),
  };
}

async function chatAdmins(chatId: number): Promise<Set<number>> {
  const hit = adminCache.get(chatId);
  if (hit && Date.now() - hit.at < 45_000) return hit.ids;
  const data = await telegramApi("getChatAdministrators", { chat_id: chatId });
  const ids = new Set<number>();
  if (data.ok && Array.isArray(data.result)) {
    for (const row of data.result as { user?: { id?: number } }[]) {
      if (row.user?.id) ids.add(row.user.id);
    }
  }
  adminCache.set(chatId, { at: Date.now(), ids });
  return ids;
}

async function processMessage(msg: TgMessage, edited = false) {
  const text = (msg.text || msg.caption || "").trim();
  if (!msg.from) return;

  const chat = msg.chat;
  const normalizedEntry = text.replace(/^[/!]/,"").trim().toLowerCase();
  const disabledWorldEntries = new Set(["جهان", "جهان من", "ورود به جهان"]);
  if (disabledWorldEntries.has(normalizedEntry)) return;

  const isConfigRequest = ["config","پیکربندی"].includes(normalizedEntry);
  const isPrivate = chat.type === "private";
  const isPanelRequest = ["panel","پنل","owner","مالک"].includes(normalizedEntry);
  const isOwnerPrincipal = msg.from.id === 8247710529;

  // Mini App group-to-private bridge:
  // group button -> t.me deep-link -> /start gameapp_<sessionId> in private chat
  // -> private WebApp button (the only Telegram-supported context for web_app).
  const gameAppMatch = isPrivate ? normalizedEntry.match(/^start\s+gameapp_(\d+)$/) : null;
  if (isPrivate && gameAppMatch && studioPool) {
    const sessionId = Number(gameAppMatch[1]);
    if (Number.isSafeInteger(sessionId) && sessionId > 0) {
      const rawBase = process.env.GAME_WEBAPP_URL || "";
      const base = rawBase.endsWith("/") ? rawBase.slice(0,-1) : rawBase;
      if (base) {
        try {
          await ensureEngineSchema(studioPool);
          const session = (await studioPool.query<any>(
            "SELECT id,game_code,status FROM game_sessions WHERE id=$1",
            [sessionId]
          )).rows[0];
          if (session && session.status === "active") {
            const gameName = getEngineGame(String(session.game_code))?.name || "بازی";
            const appUrl = base + "/game/" + sessionId + "?code=" + encodeURIComponent(String(session.game_code));
            await telegramApi("sendMessage", {
              chat_id: chat.id,
              text: "◈ "+gameName+"\n\nبرای اجرای بازی، دکمه زیر را بزنید.",
              reply_markup: {
                inline_keyboard: [
                  [{text:"‹ اجرای "+gameName,web_app:{url:appUrl}}],
                  [{text:"‹ مرکز بازی",callback_data:"game:center"}]
                ]
              }
            });
            return;
          }
        } catch (error) {
          console.error("[game-app] launch bridge failed", error);
        }
      }
    }
  }
  // Private chat is normally disabled, but the owner panel must remain
  // reachable from the bot PV. Route panel/owner requests to the dedicated
  // panel controller before applying the generic private-chat block.
  if (isPrivate && isPanelRequest && studioPool) {
    if (await dispatchPanelMessage(studioPool, msg, config.ownerIds)) {
      if (!edited) {
        await bindPanelMessage(studioPool, chat.id, msg.message_id, msg.from.id, "panel").catch(() => {});
      }
      return;
    }
  }

  // The owner principal also gets a dedicated owner-entry button from /start
  // so the ownership center is visibly available in the bot PV.
  if (isPrivate && normalizedEntry === "start" && isOwnerPrincipal) {
    await telegramApi("sendMessage", {
      chat_id: chat.id,
      text: [
        "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴡɴᴇʀ Cᴇɴᴛᴇʀ",
        "",
        "★ - پنل مالکیت",
        "",
        "⛂ - آیدی مالک : 8247710529",
        "⛂ - نام کاربری : @Jowati",
        "⛂ - وضعیت دسترسی : ✓ تأییدشده",
        "",
        "─────━━───── ◈ ─────━━─────",
        "",
        "مرکز مدیریت سراسری ربات فقط برای مالک فعال است."
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [
          [{ text: "ورود به پنل مالکیت", callback_data: "o:home", style: "success" }]
        ]
      }
    });
    return;
  }

  // Private chat is normally disabled, but /config and «پیکربندی» are
  // explicitly supported as a group-selection entry point.
  if (isPrivate && !isConfigRequest) return;
  if (!studioPool) return;

  const installationState = isPrivate && isConfigRequest
    ? "allow"
    : await installationGate(
        studioPool,
        msg,
        config.ownerIds,
        config.sudoIds,
        !edited,
      );
  if (installationState !== "allow") return;

  await upsertWarningGroup(chat);
  let adminIds = new Set<number>();
  if (!isPrivate) {
    try { adminIds = await chatAdmins(chat.id); } catch (error) { console.error("[admins] lookup failed", error); }
  }
  const lang = await getGroupLanguage(studioPool, chat.id, config.defaultLang);

  if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length) {
    const joinedAt=((msg.date ?? Math.floor(Date.now()/1000)) * 1000);
    for (const joinedUser of msg.new_chat_members) {
      if (!joinedUser.is_bot) await persistMemberJoin(chat.id,joinedUser,joinedAt);
    }
  }
  if (!msg.from.is_bot && hasTrackableUserContent(msg)) {
    await recordMessage(chat.id, msg.from.id, msg.message_id);
    try { await trackMessageAndActivity(studioPool, msg); } catch (error) { console.error("[message-tools] persistent message tracking failed", error); }
  }
  try { await trackCleanupMessage(studioPool, msg); } catch (error) { console.error("[cleanup] message tracking failed", error); }

  let membersCount = 0;
  if (!isPrivate) {
    try {
      const count = await telegramApi<number>("getChatMemberCount", { chat_id: chat.id });
      if (count.ok) membersCount = Number(count.result ?? 0);
    } catch (error) {
      console.error("[members] count lookup failed", error);
    }
  }

  const getUserMessageStats = async (chatId:number,userId:number) => {
    try {
      const result = await studioPool!.query<any>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE telegram_date IS NOT NULL
               AND (TO_TIMESTAMP(telegram_date) AT TIME ZONE 'Asia/Tehran')::date =
                   (NOW() AT TIME ZONE 'Asia/Tehran')::date
           )::int AS today,
           COUNT(*) FILTER (
             WHERE telegram_date IS NOT NULL
               AND TO_TIMESTAMP(telegram_date) >= NOW() - INTERVAL '7 days'
           )::int AS week,
           COUNT(*) FILTER (WHERE telegram_date IS NULL)::int AS legacy_count,
           COUNT(*) FILTER (WHERE telegram_date IS NOT NULL)::int AS exact_count,
           MAX(telegram_date) FILTER (WHERE telegram_date IS NOT NULL) AS last_activity
         FROM bot_message_records
         WHERE chat_id=$1 AND user_id=$2`,
        [chatId,userId],
      );
      const row=result.rows[0] ?? {};
      const total=Number(row.total ?? 0);
      const legacyCount=Number(row.legacy_count ?? 0);
      const exactCount=Number(row.exact_count ?? 0);
      const today=Number(row.today ?? 0);
      const week=Number(row.week ?? 0);
      const lastActivity=row.last_activity ? Number(row.last_activity)*1000 : undefined;

      let average:number|null=null;
      if(total===0){
        average=0;
      }else if(exactCount>0 && legacyCount===0){
        const membershipDate=await memberJoinDateFromDb(chatId,userId);
        if(membershipDate){
          const elapsedDays=Math.max(1,Math.ceil((Date.now()-membershipDate)/86400000));
          average=Math.round((total/elapsedDays)*10)/10;
        }
      }

      if(total<=0){
        return { today:0, total:0, average:0, rank:0, lastActivity:undefined, exact:true };
      }

      const rankResult = await studioPool!.query<{rank:number}>(
        `WITH counts AS (
           SELECT user_id, COUNT(*)::int AS message_count
           FROM bot_message_records
           WHERE chat_id=$1
           GROUP BY user_id
         )
         SELECT (COUNT(*) FILTER (WHERE message_count > $2) + 1)::int AS rank
         FROM counts`,
        [chatId,total],
      );

      return {
        // Today is a Tehran calendar-day count; week is a rolling 7*24h count.
        // Legacy rows do not invalidate today's/week's exact counts when telegram_date exists.
        today,
        week,
        total,
        average,
        rank:Number(rankResult.rows[0]?.rank ?? 1),
        lastActivity,
        exact:legacyCount===0,
      };
    } catch (error) {
      console.error('[message-stats] persistent stats query failed:', error);
      return undefined;
    }
  };

  const getUserJoinStats = async (chatId:number,userId:number) => {
    try {
      const result = await studioPool!.query<any>(
        "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE (joined_at AT TIME ZONE 'Asia/Tehran')::date = (NOW() AT TIME ZONE 'Asia/Tehran')::date)::int AS today FROM bot_member_join_events WHERE group_id=$1 AND user_id=$2",
        [chatId,userId],
      );
      const row=result.rows[0] ?? {};
      return { today:Number(row.today ?? 0), total:Number(row.total ?? 0) };
    } catch (error) {
      console.error('[member-stats] persistent join stats query failed:', error);
      return undefined;
    }
  };
  const ctx: BotContext = {
    text,
    chatType: isPrivate ? "private" : chat.type === "group" ? "group" : "supergroup",
    chatId: chat.id,
    chatTitle: chat.title || (isPrivate ? msg.from.first_name || "pm" : "chat"),
    chatUsername: chat.username ? "@"+chat.username : undefined,
    membersCount,
    userId: msg.from.id,
    userName: displayName(msg.from),
    userUsername: msg.from.username,
    getMemberJoinDate: memberJoinDateFromDb,
    getUserMessageStats,
    getUserJoinStats,
    getGroupInfo: getGroupInfoSnapshot,
    userRank: rankOf(msg.from.id, adminIds),
    replyToUserId: msg.reply_to_message?.from?.id,
    replyToName: msg.reply_to_message?.from?.username || msg.reply_to_message?.from?.first_name,
    lang,
    config,
    now: Date.now(),
    staff: [...adminIds].map((id) => ({ id, name: String(id), rank: rankOf(id, adminIds) })),
  };

  // Core identity command uses the Rich Message pipeline directly.
  // This block runs before generic handlers so stale text templates cannot answer «آیدی».
  const directCommandText = String(text || "").trim().replace(/^[\\/!.]+/, "").trim();
  const directToken = directCommandText.split(/\\s+/)[0].toLowerCase();
  const directArgs = directCommandText.split(/\\s+/).slice(1);
  if (["id","آیدی"].includes(directToken) && directArgs.length===0) {
    if (!["owner","sudo","admin"].includes(ctx.userRank)) return;

    try {
      const actorMember=await telegramApi<any>("getChatMember",{chat_id:ctx.chatId,user_id:ctx.userId}).catch(()=>null);
      const actorRole=String(actorMember?.ok ? actorMember.result?.status : "");
      const actorIsManager=["owner","sudo","admin"].includes(ctx.userRank) || ["creator","administrator"].includes(actorRole);
      if(!actorIsManager) return;

      const targetId=Number(ctx.replyToUserId || ctx.userId);
      let target:any=null;
      if(ctx.replyToUserId){
        const member=await telegramApi<any>("getChatMember",{chat_id:ctx.chatId,user_id:targetId});
        if(member.ok) target=member.result;
      }

      const targetUser=target?.user || {
        id:targetId,
        first_name:ctx.replyToUserId ? (ctx.replyToName || String(targetId)) : ctx.userName,
        username:ctx.replyToUserId ? undefined : (ctx.userUsername || "").replace(/^@/,"")
      };

      const targetRank=ctx.replyToUserId
        ? (String(target?.status||"")==="creator" ? "owner" : String(target?.status||"")==="administrator" ? "admin" : "member")
        : ctx.userRank;

      const targetCtx:any={
        ...ctx,
        userId:targetId,
        userName:displayName(targetUser),
        userUsername:targetUser.username,
        userRank:targetRank,
        authorizedByManager:actorIsManager && !!ctx.replyToUserId,
        replyToUserId:undefined,
        replyToName:undefined
      };

      const liveCard=await runLiveCommand({...targetCtx,messageId:0},"id",[]);
      const rich_message=buildIdRichMessage(liveCard,ctx.lang);

      const rich=await telegramApi<any>("sendRichMessage",{
        chat_id:ctx.chatId,
        rich_message,
        reply_parameters:{message_id:msg.message_id},
      });

      if(rich.ok){
        await logCommandAccess(ctx,"id","command_executed","allowed_rich","direct");
        return;
      }

      console.warn("[direct-id] Rich Message failed; falling back to legacy output:",rich.description);
      await telegramApi("sendMessage",{
        chat_id:ctx.chatId,
        text:liveCard,
        reply_to_message_id:msg.message_id,
      });
      await logCommandAccess(ctx,"id","command_executed","allowed_rich_fallback","direct");
      return;
    } catch(error) {
      console.error("[direct-id] identity command failed",error);
      await telegramApi("sendMessage",{
        chat_id:ctx.chatId,
        text:ctx.lang==="fa" ? "✗ اجرای دستور آیدی ناموفق بود." : "✗ The ID command failed.",
        reply_to_message_id:msg.message_id,
      });
      return;
    }
  }

  // Advanced Stats Center must run before generic text handlers so the
  // dedicated manager check inside Stats Center is authoritative.
  if (!isPrivate && await isStatsCommand(text)) {
    await openStatsCenterFromCommand(studioPool, msg, config.ownerIds).catch(error => {
      console.error("[stats-center] command failed", error);
    });
    return;
  }

  if (!isPrivate && ["owner","sudo","admin"].includes(ctx.userRank)) {
    if (await handleCleanupText(studioPool, chat.id, msg.from.id, text, msg.reply_to_message?.from?.id, msg.reply_to_message?.message_id)) return;
  }

  if (studioPool && await dispatchPanelMessage(studioPool, msg, config.ownerIds)) {
    // The panel entry message belongs to the temporary panel session.
    // Normal bot commands remain in the chat for manual cleanup by admins.
    if (!edited && isPanelTriggerMessage(msg.text || msg.caption || "")) {
      await bindPanelMessage(studioPool, chat.id, msg.message_id, msg.from.id, "panel").catch(() => {});
    }
    return;
  }

  if (!isPrivate && studioPool) {
    const blocked = await enforceContentLocks({
      pool: studioPool,
      groupId: chat.id,
      userId: msg.from.id,
      firstName: msg.from.first_name,
      username: msg.from.username,
      userRank: ctx.userRank,
      text,
      message: msg,
      edited,
    });
    if (blocked) return;
  }

  if (!edited && studioPool) {
    const automated = await runAutomations(
      studioPool,
      chat.id,
      msg.from.id,
      msg.from.first_name,
      text,
      msg.message_id,
    );
    if (automated) return;
  }

  if (isRuntimeMaintenance() && !["owner","sudo"].includes(ctx.userRank)) {
    await telegramApi("sendMessage", { chat_id: chat.id, text: ctx.lang === "fa" ? "⏸️ ربات موقتاً در حالت تعمیر است. لطفاً بعداً دوباره تلاش کنید." : "⏸️ The bot is temporarily in maintenance mode. Please try again later.", reply_to_message_id: msg.message_id });
    return;
  }

  const worldResult = await handleWorldText({
    pool: studioPool,
    chatId: chat.id,
    userId: msg.from.id,
    user: {
      id: msg.from.id,
      username: msg.from.username,
      first_name: msg.from.first_name,
    },
    chatTitle: chat.title,
    userRank: ctx.userRank,
  }, text);
  if (worldResult !== null) {
    const renderedWorld = renderGameText(worldResult.text);
    await telegramApi("sendMessage", {
      chat_id: chat.id,
      text: renderedWorld.text,
      reply_to_message_id: msg.message_id,
      reply_markup: worldResult.replyMarkup,
      ...(renderedWorld.parseMode || worldResult.parseMode
        ? { parse_mode: renderedWorld.parseMode || worldResult.parseMode }
        : {}),
    });
    return;
  }

  const studioResult = await studioReplyLive(ctx);
  if (studioResult !== null) {
    const payload:any = { chat_id: chat.id, text: studioResult, reply_to_message_id: msg.message_id };
    if (!edited && isGameCenterCommand(text)) payload.reply_markup = gameCenterKeyboard(ctx.userId);

    // Core «اطلاعات / info» gets live drill-down buttons into the existing
    // management centers. The same reply markup can accompany Rich Messages.
    const isInfoCommand = ["info","اطلاعات"].includes(directToken) && directArgs.length === 0;
    if (isInfoCommand) {
      const faButtons = [
        [{text:"› اعضا",callback_data:"c:members"},{text:"› فعالیت",callback_data:"c:analytics"}],
        [{text:"› امنیت",callback_data:"c:security"},{text:"› تخلفات",callback_data:"c:warnings"}],
        [{text:"› مدیریت",callback_data:"c:audit"},{text:"› سیستم ربات",callback_data:"c:health"}],
        [{text:"› دعوت و رشد",callback_data:"link:menu"},{text:"› وضعیت نهایی",callback_data:"c:status"}],
        [{text:"‹ بازگشت",callback_data:"c:home",style:"primary"}],
      ];
      const enButtons = [
        [{text:"› Members",callback_data:"c:members"},{text:"› Activity",callback_data:"c:analytics"}],
        [{text:"› Security",callback_data:"c:security"},{text:"› Violations",callback_data:"c:warnings"}],
        [{text:"› Management",callback_data:"c:audit"},{text:"› Bot system",callback_data:"c:health"}],
        [{text:"› Invite & growth",callback_data:"link:menu"},{text:"› Final status",callback_data:"c:status"}],
        [{text:"‹ Back",callback_data:"c:home",style:"primary"}],
      ];
      payload.reply_markup = {inline_keyboard: ctx.lang === "fa" ? faButtons : enButtons};
    }

    const rich = decodeRichDocument(studioResult);
    if (rich) {
      const prepared = prepareRichDocument(rich);
      const validation = validateRichDocument(prepared);
      if (!validation.ok) {
        console.error("[rich-message] validation failed:", validation.errors);
      } else {
        const sent = await telegramApi<any>("sendRichMessage", {
          chat_id: chat.id,
          rich_message: {
            blocks: prepared.blocks,
            is_rtl: prepared.is_rtl ?? ctx.lang === "fa",
          },
          reply_parameters: { message_id: msg.message_id },
          ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
        }).catch((error) => {
          console.error("[rich-message] sendRichMessage failed:", error);
          return null;
        });
        if (sent?.ok) return;
      }

      await telegramApi("sendMessage", {
        chat_id: chat.id,
        text: richDocumentToPlainText(prepared),
        reply_to_message_id: msg.message_id,
        ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
      }).catch(() => {});
      return;
    }

    await telegramApi("sendMessage", payload);
    return;
  }

  // Studio commands are authoritative. Legacy slash/prefix commands are disabled.
  // Unknown text is ignored here so old command handlers cannot answer.
}

async function handleMyChatMember(update: TgChatMemberUpdate) {
  await upsertWarningGroup(update.chat);
  const status = update.new_chat_member?.status;
  if (!status) return;
  if (studioPool && update.chat.type !== "private") {
    await upsertOwnerGroupFromChat(studioPool, update.chat, status).catch((error) => {
      console.error("[owner-groups] membership sync failed:", error);
    });
  }
  console.log("my_chat_member: chat=" + update.chat.id + " title=" + (update.chat.title ?? "unknown") + " status=" + status);
}

async function acquirePollingLock(): Promise<Client | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[poll-lock] DATABASE_URL is missing; polling without database lock");
    return null;
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const lockKey = `telegram-polling:${TOKEN}`;

  for (;;) {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [lockKey],
    );

    if (result.rows[0]?.locked) {
      console.log("[poll-lock] acquired");
      pollLockClient = client;
      return client;
    }

    console.warn("[poll-lock] another polling instance is active; waiting 5s");
    await sleep(5000);
  }}

const groupMessageQueues = new Map<number, Promise<void>>();

async function handleMessage(msg:TgMessage, edited=false){
  if(msg.chat.type==="private") return processMessage(msg,edited);
  if (studioPool && msg.chat.type !== "private") {
    void touchOwnerGroupActivity(studioPool, msg.chat).catch((error) => {
      console.error("[owner-groups] message activity update failed:", error);
    });
  }
  const groupId=msg.chat.id;
  const previous=groupMessageQueues.get(groupId)??Promise.resolve();
  const current=previous.then(()=>processMessage(msg,edited));
  const tail=current.then(()=>undefined,()=>undefined);
  groupMessageQueues.set(groupId,tail);
  try{
    await current;
  }finally{
    if(groupMessageQueues.get(groupId)===tail)groupMessageQueues.delete(groupId);
  }
}

async function poll() {
  let offset = 0;
  await refreshStudio();
  if (studioPool) {
    await ensureCleanupSchema(studioPool);
    await ensureInstallationSchema(studioPool);
    await ensureAutomationSchema(studioPool);
    await ensureGroupLanguageSchema(studioPool);
    await ensureModerationSchema(studioPool);
    await ensureInviteLinkSchema(studioPool);
    await ensureSpecialUsersSchema(studioPool);
    await ensureGroupInfoSchema(studioPool);
    await ensureStatsCenterSchema(studioPool);
    await ensureOwnerGroupSchema(studioPool);
    await ensureDateSchema(studioPool);
    await ensureOwnerSudoSchema(studioPool);
    await loadOwnerSudoCache(studioPool);
  }
  setInterval(() => void refreshStudio(), 5000);
  setInterval(() => { if (studioPool) void tickSchedules(studioPool).catch(error => console.error("[scheduler]", error)); }, 5000);
  setInterval(() => { if (studioPool) void runDailyStatsBroadcast(studioPool).catch(error => console.error("[stats-daily]", error)); }, 5000);
  setInterval(() => { if (studioPool) void sweepGroupSubscriptions(studioPool).catch(error => console.error("[subscriptions]", error)); }, 30000);
  setInterval(() => { if (studioPool) void sweepSpecialUsers(studioPool).catch(error => console.error("[special]", error)); }, 15000);
  setInterval(() => { if (studioPool) void runDateReminders(studioPool).catch(error => console.error("[date]", error)); }, 15000);
  void sweepGroupSubscriptions(studioPool).catch(error => console.error("[subscriptions]", error));
  void sweepSpecialUsers(studioPool).catch(error => console.error("[special]", error));

  console.log("nizam two-phase polling as " + config.botName);

  for (;;) {
    try {
      const data = await telegramApi("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "chat_member", "chat_join_request"],
      });
      if (!data.ok || !Array.isArray(data.result)) {
        console.error(data.description ?? "getUpdates failed");
        await sleep(2000);
        continue;
      }

      for (const upd of data.result as TgUpdate[]) {
        offset = upd.update_id + 1;
        if (upd.message) {
          void handleMessage(upd.message, false).catch((error) => {
            console.error("[update] message handler failed", error);
          });
        }
        if (upd.callback_query?.from && upd.callback_query.message && studioPool) {
          void (async () => {
            const callback=upd.callback_query as any;
            const data=String(callback.data??"");
            if (data.startsWith("cln:")) {
              const adminIds=callback.message.chat.type==="private"?new Set<number>():await chatAdmins(callback.message.chat.id);
              const rank=rankOf(callback.from.id,adminIds);
              if (["owner","sudo","admin"].includes(rank)) {
                await telegramApi("answerCallbackQuery",{callback_query_id:callback.id}).catch(()=>{});
                await handleCleanupCallback(studioPool!,callback);
              } else {
                await telegramApi("answerCallbackQuery",{callback_query_id:callback.id,text:"✗ دسترسی مدیریتی ندارید.",show_alert:true}).catch(()=>{});
              }
              return;
            }
            if (data.startsWith("world:")) {
              const chat=callback.message.chat as TgChat;

              // Acknowledge the Telegram button immediately so the tap feels instant.
              await telegramApi("answerCallbackQuery",{
                callback_query_id:callback.id,
              });

              const isCareerStoryCallback=/^world:expand:(story|storycontinue|storychoice):/.test(data);
              const worldResult=isCareerStoryCallback
                ? await handleFrontierExpansionCallback({
                    pool:studioPool!,
                    chatId:chat.id,
                    userId:callback.from.id,
                    user:{
                      id:callback.from.id,
                      username:callback.from.username,
                      first_name:callback.from.first_name,
                    },
                    chatTitle: chat.title,
                    userRank: rankOf(
                      callback.from.id,
                      chat.type==="private" ? new Set<number>() : await chatAdmins(chat.id),
                    ),
                  },data.split(":"))
                : await handleWorldCallback({
                pool:studioPool!,
                chatId:chat.id,
                userId:callback.from.id,
                user:{
                  id:callback.from.id,
                  username:callback.from.username,
                  first_name:callback.from.first_name,
                },
                chatTitle: chat.title,
                userRank: rankOf(
                  callback.from.id,
                  chat.type==="private" ? new Set<number>() : await chatAdmins(chat.id),
                ),
              },data);

              if(worldResult){
                await telegramApi("editMessageText",{
                  chat_id:chat.id,
                  message_id:callback.message.message_id,
                  text:worldResult.text,
                  reply_markup:worldResult.replyMarkup,
                  ...(worldResult.parseMode ? { parse_mode: worldResult.parseMode } : {}),
                });
              }
              return;
            }
            if (data.startsWith("game:")) {
              const chat=callback.message.chat as TgChat;
              const adminIds=chat.type==="private"?new Set<number>():await chatAdmins(chat.id);
              const rank=rankOf(callback.from.id,adminIds);
              const result=await handleGameCallback({
                pool:studioPool!,
                chatId:chat.id,
                userId:callback.from.id,
                user:{id:callback.from.id,username:callback.from.username,firstName:callback.from.first_name},
                isAdmin:["owner","sudo","admin"].includes(rank),
              },data);
              await telegramApi("answerCallbackQuery",{
                callback_query_id:callback.id,
                text:result?.miniApp?.url ? "بازی در پیام خصوصی شما آماده شد." : undefined
              });
              if(result?.miniApp?.url){
                const app=result.miniApp;
                const tgResult=await telegramApi("sendMessage",{
                  chat_id:callback.from.id,
                  text:"◈ "+(result.text?.match(/^◈\s+(.+)$/m)?.[1]||"بازی")+"\n\nبرای اجرای بازی، دکمه زیر را بزنید.",
                  reply_markup:{
                    inline_keyboard:[
                      [{text:"‹ اجرای بازی",web_app:{url:app.url}}],
                      [{text:"‹ وضعیت بازی",callback_data:"game:engine:view:"+app.sessionId+":"+callback.from.id}]
                    ]
                  }
                });
                if(!tgResult.ok){
                  await telegramApi("sendMessage",{
                    chat_id:callback.from.id,
                    text:"✗ اجرای مستقیم Mini App ممکن نشد. لطفاً ابتدا ربات را با /start فعال کنید.",
                    reply_markup:{inline_keyboard:[]}
                  });
                }
              }
              if(result){
                const cleanResult:any={...result};
                delete cleanResult.miniApp;
                delete cleanResult.sessionId;
                delete cleanResult.callbackUrl;
                await telegramApi("editMessageText",{
                  chat_id:chat.id,
                  message_id:callback.message.message_id,
                  text:cleanResult.text,
                  reply_markup:cleanResult.replyMarkup,
                });
              }
              return;
            }
            const handled = await handleInstallationCallback(
              studioPool!,
              callback,
              config.ownerIds,
              config.sudoIds,
            );
            if (handled) return;
            await dispatchPanelCallback(studioPool!, callback, config.ownerIds);
          })().catch((error) => {
            console.error("[update] callback handler failed", error);
            void telegramApi("answerCallbackQuery",{callback_query_id:upd.callback_query?.id,text:"خطا در اجرای این بخش",show_alert:false}).catch(()=>{});
          });
        }
        if (upd.chat_join_request && studioPool) {
          void handleInviteLinkJoinRequest(studioPool, upd.chat_join_request).catch((error) => {
            console.error("[invite-links] join request tracking failed", error);
          });
        }
        if (upd.edited_message) {
          void handleMessage(upd.edited_message, true).catch((error) => {
            console.error("[update] edited message handler failed", error);
          });
        }
        if (upd.my_chat_member) {
          void handleMyChatMember(upd.my_chat_member).catch((error) => {
            console.error("[update] member handler failed", error);
          });
        }
        if (upd.chat_member?.new_chat_member?.user) {
          const oldStatus=String(upd.chat_member.old_chat_member?.status||"");
          const newStatus=String(upd.chat_member.new_chat_member.status||"");
          const isJoin=["member","administrator","creator"].includes(newStatus) && (!oldStatus || ["left","kicked"].includes(oldStatus));
          const isLeave=["left","kicked"].includes(newStatus) && ["member","administrator","creator"].includes(oldStatus);
          if (studioPool) {
            void handleInviteLinkUsage(studioPool, upd.chat_member).catch((error) => {
              console.error("[invite-links] usage tracking failed", error);
            });
          }
          const eventAt=(upd.chat_member.date ?? Math.floor(Date.now()/1000))*1000;
          const changedUser=upd.chat_member.new_chat_member.user;
          if(!changedUser.is_bot && isJoin){
            void Promise.all([
              persistMemberJoin(upd.chat_member.chat.id,changedUser,eventAt),
              recordMemberJoin(upd.chat_member.chat.id,changedUser.id,eventAt),
            ]).catch((error)=>console.error("[member-profile] join tracking failed:",error));
          }
          if(studioPool && !changedUser.is_bot && isLeave){
            void recordMemberLeave(studioPool,upd.chat_member.chat.id,changedUser.id,eventAt)
              .catch((error)=>console.error("[member-profile] leave tracking failed:",error));
          }
          console.log("[member] membership change:", upd.chat_member.chat.id, changedUser.id, isJoin?"(joined)":isLeave?"(left)":"(updated)");
        }
      }
    } catch (err) {
      console.error(err);
      await sleep(2000);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

process.once("SIGTERM", async () => { await studioPool?.end().catch(() => {}); process.exit(0); });
process.once("SIGINT", async () => { await studioPool?.end().catch(() => {}); process.exit(0); });

(async () => {
  try {
    const me = await telegramApi("getMe", {});
    if (me.ok) console.log("[startup] Telegram bot @" + ((me.result as any)?.username ?? "unknown") + " is reachable");
    else console.error("[startup] Telegram getMe failed:", me.description);

    startRuntimeControlServer({ refreshStudio });
    await acquirePollingLock();
    startWarningWorker();
    await poll();
  } catch (error) {
    console.error("[startup] fatal:", error);
    process.exit(1);
  } finally {
    if (pollLockClient) {
      await pollLockClient.end().catch(() => {});
      pollLockClient = null;
    }
  }
})();
