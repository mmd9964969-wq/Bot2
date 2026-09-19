import { Pool } from "pg";
import { DEFAULT_CONFIG, type BotConfig } from "../src/lib/bot/defaults.ts";
import { handleCommand, type BotContext } from "../src/lib/bot/engine.ts";
import { cloneStudioDefaults, type StudioDocument } from "../src/lib/bot/studio.ts";
import type { Lang, Rank } from "../src/lib/bot/registry.ts";
import { telegramApi } from "../src/lib/telegram/api.ts";
import { resolveCommand, rankAtLeast } from "../src/lib/bot/registry.ts";
import { runLiveCommand, moderateLive, recordMessage } from "../src/lib/bot/runtime.ts";

const TOKEN = process.env.BOT_TOKEN ?? "";
if (!TOKEN) { console.error("BOT_TOKEN is missing"); process.exit(1); }

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

async function refreshStudio() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  try {
    studioPool ??= new Pool({ connectionString: url, max: 2 });
    const result = await studioPool.query<{ config: StudioDocument }>(
      "select config from bot_studio_panel where id = 1 limit 1",
    );
    if (result.rows[0]?.config) studio = mergeStudio(result.rows[0].config);
  } catch (error) {
    console.error("[studio] refresh failed", error);
  }
}

function mergeStudio(value: Partial<StudioDocument>): StudioDocument {
  const base = cloneStudioDefaults();
  return {
    ...base,
    ...value,
    settings: { ...base.settings, ...(value.settings ?? {}) },
    capabilities: Array.isArray(value.capabilities) ? value.capabilities : base.capabilities,
    commands: base.commands.map((b) => ({ ...b, ...(Array.isArray(value.commands) ? value.commands.find((x) => x.id === b.id) : undefined) })),
  };
}

function normalizeCommand(text: string) {
  const clean = text.trim().replace(/^[/!.]/, "").trim();
  return clean.split(/\s+/)[0]?.toLowerCase() ?? "";
}

function studioReply(ctx: BotContext): string | null {
  if (!studio.settings.bareCommands && !ctx.text.trim().match(/^[/!.]/)) return null;
  const token = normalizeCommand(ctx.text);
  const command = studio.commands.find((item) =>
    item.enabled &&
    item.phase <= 2 &&
    [...item.aliasesFa, ...item.aliasesEn].some((alias) => alias.toLowerCase() === token),
  );
  if (!command) return null;

  const allowed =
    command.minRank === "member" ||
    (command.minRank === "admin" && ctx.userRank !== "member") ||
    ctx.userRank === "owner";

  if (!allowed) return ctx.lang === "fa"
    ? "✗ دسترسی کافی برای این دستور را ندارید."
    : "✗ You do not have enough access for this command.";

  return render(ctx.lang === "fa" ? command.responseFa : command.responseEn, ctx);
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

  const ctx: BotContext = {
    text,
    chatType: isPrivate ? "private" : chat.type === "group" ? "group" : "supergroup",
    chatId: chat.id,
    chatTitle: chat.title || (isPrivate ? msg.from.first_name || "pm" : "chat"),
    membersCount: 0,
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

  const parsed = text.trim().replace(/^[/!.]/, "").split(/\s+/);
  const token = parsed.shift()?.split("@")[0] ?? "";
  const command = resolveCommand(token);
  if (!command) { await moderateLive({ chatId: chat.id, userId: msg.from.id, messageId: msg.message_id, text }); return; }
  const studioCommand = studio.commands.find((x) => x.id === command.id);
  if (studioCommand && !studioCommand.enabled) return;
  if (!rankAtLeast(ctx.userRank, command.minRank)) {
    await telegramApi("sendMessage", { chat_id: chat.id, text: ctx.lang === "fa" ? "✗ دسترسی کافی ندارید." : "✗ You do not have enough access.", reply_to_message_id: msg.message_id });
    return;
  }
  try {
    const result = await runLiveCommand({ ...ctx, messageId: msg.message_id, replyToUserId: msg.reply_to_message?.from?.id, replyToName: msg.reply_to_message?.from?.username || msg.reply_to_message?.from?.first_name, replyToMessageId: msg.reply_to_message ? (msg as any).reply_to_message.message_id : undefined }, token, parsed);
    await telegramApi("sendMessage", { chat_id: chat.id, text: result, reply_to_message_id: msg.message_id });
  } catch (error) {
    console.error("[command]", error);
    await telegramApi("sendMessage", { chat_id: chat.id, text: ctx.lang === "fa" ? "✗ اجرای دستور ناموفق بود؛ دسترسی ربات یا هدف را بررسی کنید." : "✗ Command failed; check bot permissions or target.", reply_to_message_id: msg.message_id });
  }
}

async function handleMyChatMember(update: TgChatMemberUpdate) {
  const status = update.new_chat_member?.status;
  if (!status) return;
  console.log("my_chat_member: chat=" + update.chat.id + " title=" + (update.chat.title ?? "unknown") + " status=" + status);
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
        if (upd.message) await handleMessage(upd.message);
        if (upd.my_chat_member) await handleMyChatMember(upd.my_chat_member);
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
    await poll();
  } catch (error) {
    console.error("[startup] fatal:", error);
    process.exit(1);
  }
})();
