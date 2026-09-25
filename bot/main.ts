import { Client, Pool } from "pg";
import { DEFAULT_CONFIG, type BotConfig } from "../src/lib/bot/defaults.ts";
import type { BotContext } from "../src/lib/bot/engine.ts";
import { cloneStudioDefaults, type StudioDocument } from "../src/lib/bot/studio.ts";
import { rankAtLeast, type Lang, type Rank } from "../src/lib/bot/registry.ts";
import { telegramApi } from "../src/lib/telegram/api.ts";
import { rankAtLeast } from "../src/lib/bot/registry.ts";
import { runLiveCommand, recordMessage, getGroupStats } from "../src/lib/bot/runtime.ts";
import { enforceContentLocks, runContentLockCommand, sendContentLockCenter, type ContentLockMessage } from "../src/lib/bot/content-locks.ts";
import { isRuntimeMaintenance, startRuntimeControlServer } from "./runtime-control.ts";
import { ensureAutomationSchema, runAutomations, tickSchedules } from "../src/lib/bot/automation-engine.ts";
import { dispatchPanelMessage, dispatchPanelCallback } from "./panel-system.ts";
import { ensureGroupLanguageSchema, getGroupLanguage, normalizeBotLang, setGroupLanguage, languageChangedText, languagePickerText, SUPPORTED_LANGUAGES } from "../src/lib/bot/i18n.ts";
import { ensureInstallationSchema, installationGate, handleInstallationCallback } from "./installation.ts";

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
  const raw = text.trim();
  if (/^[\\/!.]/.test(raw)) return false;
  const normalized = normalizeCommand(raw);
  const targets = aliases.map(normalizeCommand).filter(Boolean).sort((a,b)=>b.length-a.length);
  return targets.some((target) => normalized === target || normalized.startsWith(target + " "));
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
  // Commands are plain words only; slash/prefix forms are intentionally disabled.
  if(/^[/!.]/.test(raw))return null;
  const token=normalizeCommand(raw);
  const commandArgs=raw.split(/\\s+/).slice(1);
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
  const studioCommand=studio.commands.find(item=>item.enabled&&item.phase<=2&&commandMatches(token,[...item.aliasesFa,...item.aliasesEn]));
  const panelCommand=panelCommands.find(item=>commandMatches(token,[item.command_key,item.fa_name,item.en_name]));
  if(!studioCommand && !panelCommand)return null;

  if(studioCommand){
    const auth=await authorizeStudioCommand(ctx,studioCommand);
    if(!auth.allowed){
      await logCommandAccess(ctx,studioCommand.id,"permission_denied",auth.reason,auth.role);
      return ctx.lang==="fa"?"✗ دسترسی کافی برای اجرای این دستور را ندارید.":"✗ You do not have permission to execute this command.";
    }

    try{
      const commandArgs=raw.split(/\\s+/).slice(1);
      if(studioCommand.id==="lock" && ["","ها","قفل‌ها","قفل ها","وضعیت","status"].includes(normalizeCommand(commandArgs.join(" ")))){
        const opened=await sendContentLockCenter(studioPool!,ctx.chatId,ctx.userId);
        await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
        if(!opened.ok)return ctx.lang==="fa"?"✗ بازکردن مرکز قفل ناموفق بود.":"✗ Could not open the lock center.";
        return null;
      }
      const liveCard=(["lock","unlock","lockall","unlockall"].includes(studioCommand.id) && studioPool)
        ? await runContentLockCommand(studioPool,{chatId:ctx.chatId,userId:ctx.userId,userRank:ctx.userRank,lang:ctx.lang,chatTitle:ctx.chatTitle},studioCommand.id,commandArgs)
        : await runLiveCommand({...ctx,messageId:0},studioCommand.aliasesEn[0]??studioCommand.id,commandArgs);
      await logCommandAccess(ctx,studioCommand.id,"command_executed","allowed",auth.role);
      const values:Record<string,string>={
        user_name:ctx.userName,
        username:ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName,
        user_id:String(ctx.userId),
        rank:ctx.lang==="fa" ? ({owner:"مالک",sudo:"سودو",admin:"مدیر",member:"کاربر"} as Record<string,string>)[ctx.userRank] : ctx.userRank,
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
          return configuredTemplate.replace(/{{\s*live_card\s*}}/gi,liveCard).replace(/{{\s*([a-z0-9_]+)\s*}}/gi,(_,key)=>values[key]??"—");
        }
        // Core information/status commands must never use a stale static panel template.
        return liveCard;
      }
      const selected=(configuredTemplate && configuredTemplate.trim())
        ? configuredTemplate
        : (ctx.lang==="fa"?studioCommand.responseFa:studioCommand.responseEn);
      if(!selected.trim()) return liveCard;
      return selected.replace(/{{\s*([a-z0-9_]+)\s*}}/gi,(_,key)=>values[key]??"—");
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
    username:ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName,
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
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi,(_,key)=>values[key]??"—");
}

function render(template: string, ctx: BotContext) {
  const values: Record<string, string> = {
    user_name: ctx.userName,
    username: ctx.userName.startsWith("@") ? ctx.userName : "@" + ctx.userName,
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
    permissions: ctx.userRank === "owner" ? "کامل" : ctx.userRank === "admin" ? "مدیریتی" : "عادی",
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

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string; title?: string; username?: string };
type TgMessage = ContentLockMessage & { chat: TgChat; from?: TgUser; reply_to_message?: { from?: TgUser }; new_chat_members?: TgUser[]; left_chat_member?: TgUser };
type TgChatMemberUpdate = { chat: TgChat; from?: TgUser; new_chat_member?: { status?: string; user?: TgUser } };
type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: {id:string;from?:TgUser;message?:TgMessage;data?:string}; my_chat_member?: TgChatMemberUpdate; chat_member?: TgChatMemberUpdate };

function splitIds(raw: string | undefined): string[] {
  return (raw ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function rankOf(userId: number, adminIds: Set<number>): Rank {
  const id = String(userId);
  if (config.ownerIds.includes(id)) return "owner";
  if (config.sudoIds.includes(id)) return "sudo";
  if (adminIds.has(userId)) return "admin";
  return "member";
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
  const isPrivate = chat.type === "private";
  if (isPrivate) return;
  if (!studioPool) return;

  const installationState = await installationGate(
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

  await recordMessage(chat.id, msg.from.id, msg.message_id);

  let membersCount = 0;
  if (!isPrivate) {
    try {
      const count = await telegramApi<number>("getChatMemberCount", { chat_id: chat.id });
      if (count.ok) membersCount = Number(count.result ?? 0);
    } catch (error) {
      console.error("[members] count lookup failed", error);
    }
  }

  const ctx: BotContext = {
    text,
    chatType: isPrivate ? "private" : chat.type === "group" ? "group" : "supergroup",
    chatId: chat.id,
    chatTitle: chat.title || (isPrivate ? msg.from.first_name || "pm" : "chat"),
    chatUsername: chat.username ? "@"+chat.username : undefined,
    membersCount,
    userId: msg.from.id,
    userName: msg.from.username || msg.from.first_name || String(msg.from.id),
    userRank: rankOf(msg.from.id, adminIds),
    replyToUserId: msg.reply_to_message?.from?.id,
    replyToName: msg.reply_to_message?.from?.username || msg.reply_to_message?.from?.first_name,
    lang,
    config,
    now: Date.now(),
    staff: [...adminIds].map((id) => ({ id, name: String(id), rank: rankOf(id, adminIds) })),
  };

  if (studioPool && await dispatchPanelMessage(studioPool, msg, config.ownerIds)) return;

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

  const studioResult = await studioReplyLive(ctx);
  if (studioResult !== null) {
    await telegramApi("sendMessage", { chat_id: chat.id, text: studioResult, reply_to_message_id: msg.message_id });
    return;
  }

  // Studio commands are authoritative. Legacy slash/prefix commands are disabled.
  // Unknown text is ignored here so old command handlers cannot answer.
}

async function handleMyChatMember(update: TgChatMemberUpdate) {
  await upsertWarningGroup(update.chat);
  const status = update.new_chat_member?.status;
  if (!status) return;
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
    await ensureInstallationSchema(studioPool);
    await ensureAutomationSchema(studioPool);
    await ensureGroupLanguageSchema(studioPool);
  }
  setInterval(() => void refreshStudio(), 5000);
  setInterval(() => { if (studioPool) void tickSchedules(studioPool).catch(error => console.error("[scheduler]", error)); }, 5000);

  console.log("nizam two-phase polling as " + config.botName);

  for (;;) {
    try {
      const data = await telegramApi("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member", "chat_member"],
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
        if (upd.callback_query?.from && upd.callback_query.message && upd.callback_query.message.chat.type !== "private" && studioPool) {
          void (async () => {
            const handled = await handleInstallationCallback(
              studioPool!,
              upd.callback_query as any,
              config.ownerIds,
              config.sudoIds,
            );
            if (handled) return;
            await dispatchPanelCallback(studioPool!, upd.callback_query as any, config.ownerIds);
          })().catch((error) => {
            console.error("[update] callback handler failed", error);
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
        if (upd.chat_member?.new_chat_member?.user && ["member","administrator","creator"].includes(upd.chat_member.new_chat_member.status ?? "")) {
          // Join tracking hook is not implemented in this runtime yet.
          // Keep the polling loop alive so a member event cannot abort the rest of the batch.
          console.log("[member] join observed:", upd.chat_member.chat.id, upd.chat_member.new_chat_member.user.id);
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
