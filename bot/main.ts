import { Client, Pool } from "pg";
import { DEFAULT_CONFIG, type BotConfig } from "../src/lib/bot/defaults.ts";
import type { BotContext } from "../src/lib/bot/engine.ts";
import { cloneStudioDefaults, type StudioDocument } from "../src/lib/bot/studio.ts";
import type { Lang, Rank } from "../src/lib/bot/registry.ts";
import { telegramApi } from "../src/lib/telegram/api.ts";
import { rankAtLeast } from "../src/lib/bot/registry.ts";
import { runLiveCommand, recordMessage } from "../src/lib/bot/runtime.ts";
import { isRuntimeMaintenance, startRuntimeControlServer } from "./runtime-control.ts";

const TOKEN = process.env.BOT_TOKEN ?? "";
if (!TOKEN) { console.error("BOT_TOKEN is missing"); process.exit(1); }
if (process.env.LEGACY_DISABLED === "true") { console.log("[legacy] Telegram Bot service disabled; Bot Core owns the runtime"); await new Promise(() => {}); }

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  botName: process.env.BOT_NAME || DEFAULT_CONFIG.botName,
  botUsername: process.env.BOT_USERNAME || DEFAULT_CONFIG.botUsername,
  defaultLang: process.env.DEFAULT_LANG === "en" ? "en" : "fa",
  ownerIds: splitIds(process.env.OWNER_IDS),
  sudoIds: splitIds(process.env.SUDO_IDS),
  prefixes: (process.env.PREFIXES || "/!.").split("").filter((c) => "/!.".includes(c)),
};

let studio = cloneStudioDefaults();
let studioPool: Pool | null = null;
let pollLockClient: Client | null = null;
let panelCommands: PanelCommand[] = [];

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
  return text.trim().replace(/^[\\/!.]+/, "").replace(/\\s+/g, " ").toLowerCase();
}

function commandMatches(text: string, aliases: string[]) {
  const normalized = normalizeCommand(text);
  const firstToken = normalized.split(" ")[0] ?? "";
  return aliases.some((alias) => {
    const target = normalizeCommand(alias);
    return normalized === target || firstToken === target;
  });
}

const PANEL_ROLE_ORDER: PanelRole[] = ["MEMBER","SPECIAL_USER","MODERATOR","ADMIN","SUPER_ADMIN","OWNER"];
type PanelRole = typeof PANEL_ROLE_ORDER[number];
type PanelCommand = { id:number; command_key:string; fa_name:string; en_name:string; enabled:boolean; required_permission:string; minimum_role:PanelRole; permissions:Array<{role:PanelRole;allowed:boolean}> };

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
  const token=normalizeCommand(raw);
  const command=studio.commands.find(item=>item.enabled&&item.phase<=2&&commandMatches(token,[...item.aliasesFa,...item.aliasesEn]));
  if(!command)return null;

  const auth=await authorizeStudioCommand(ctx,command);
  if(!auth.allowed){
    await logCommandAccess(ctx,command.id,"permission_denied",auth.reason,auth.role);
    return ctx.lang==="fa"?"✗ دسترسی کافی برای اجرای این دستور را ندارید.":"✗ You do not have permission to execute this command.";
  }

  try{
    const liveCard=await runLiveCommand({...ctx,messageId:0},command.aliasesEn[0]??command.id,raw.split(/\\s+/).slice(1));
    await logCommandAccess(ctx,command.id,"command_executed","allowed",auth.role);
    const values:Record<string,string>={user_name:ctx.userName,username:ctx.userName.startsWith("@")?ctx.userName:"@"+ctx.userName,user_id:String(ctx.userId),rank:ctx.userRank,chat_title:ctx.chatTitle,chat_id:String(ctx.chatId),chat_type:ctx.chatType,members_count:String(ctx.membersCount),admins_count:String(ctx.staff.length),live_card:liveCard};
    const template=ctx.lang==="fa"?command.responseFa:command.responseEn;
    if(!template.trim()) return liveCard;
    return template.replace(/{{\\s*([a-z0-9_]+)\\s*}}/gi,(_,key)=>values[key]??"—");
  }catch(error){
    console.error("[studio-command]",error);
    return ctx.lang==="fa"?"✗ اجرای دستور ناموفق بود؛ دسترسی ربات یا هدف را بررسی کنید.":"✗ Command failed; check bot permissions or target.";
  }
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

const chatLang = new Map<number, Lang>();
const adminCache = new Map<number, { at: number; ids: Set<number> }>();

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string; title?: string };
type TgMessage = { message_id: number; chat: TgChat; from?: TgUser; text?: string; reply_to_message?: { from?: TgUser } };
type TgChatMemberUpdate = { chat: TgChat; from?: TgUser; new_chat_member?: { status?: string; user?: TgUser } };
type TgUpdate = { update_id: number; message?: TgMessage; my_chat_member?: TgChatMemberUpdate };

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

async function handleMessage(msg: TgMessage) {
  const text = msg.text?.trim();
  if (!text || !msg.from) return;

  const chat = msg.chat;
  const isPrivate = chat.type === "private";
  let adminIds = new Set<number>();
  if (!isPrivate) {
    try { adminIds = await chatAdmins(chat.id); } catch (error) { console.error("[admins] lookup failed", error); }
  }
  const lang = chatLang.get(chat.id) ?? config.defaultLang;

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
  }
}

async function poll() {
  let offset = 0;
  await refreshStudio();
  setInterval(() => void refreshStudio(), 5000);

  console.log("nizam two-phase polling as " + config.botName);

  for (;;) {
    try {
      const data = await telegramApi("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "my_chat_member"],
      });
      if (!data.ok || !Array.isArray(data.result)) {
        console.error(data.description ?? "getUpdates failed");
        await sleep(2000);
        continue;
      }

      for (const upd of data.result as TgUpdate[]) {
        offset = upd.update_id + 1;
        if (upd.message) {
          void handleMessage(upd.message).catch((error) => {
            console.error("[update] message handler failed", error);
          });
        }
        if (upd.my_chat_member) {
          void handleMyChatMember(upd.my_chat_member).catch((error) => {
            console.error("[update] member handler failed", error);
          });
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
