/**
 * Nizam phase-1 worker. Railway start:
 *   node --experimental-strip-types bot/main.ts
 *
 * Required env: BOT_TOKEN, OWNER_IDS
 */
import { DEFAULT_CONFIG, type BotConfig } from "../src/lib/bot/defaults.ts";
import { handleCommand, type BotContext } from "../src/lib/bot/engine.ts";
import type { Lang, Rank } from "../src/lib/bot/registry.ts";

const TOKEN = process.env.BOT_TOKEN ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) {
  console.error("BOT_TOKEN is missing");
  process.exit(1);
}

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  botName: process.env.BOT_NAME || DEFAULT_CONFIG.botName,
  botUsername: process.env.BOT_USERNAME || DEFAULT_CONFIG.botUsername,
  defaultLang: process.env.DEFAULT_LANG === "en" ? "en" : "fa",
  ownerIds: splitIds(process.env.OWNER_IDS),
  sudoIds: splitIds(process.env.SUDO_IDS),
  prefixes: (process.env.PREFIXES || "/!.")
    .split("")
    .filter((c) => "/!.".includes(c)),
};

const chatLang = new Map<number, Lang>();
const adminCache = new Map<number, { at: number; ids: Set<number> }>();

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string; title?: string };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: { from?: TgUser };
};
type TgUpdate = { update_id: number; message?: TgMessage };

function splitIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function api(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
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
  const data = await api("getChatAdministrators", { chat_id: chatId });
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
  const adminIds = isPrivate ? new Set<number>() : await chatAdmins(chat.id);
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
    staff: [...adminIds].map((id) => ({
      id,
      name: String(id),
      rank: rankOf(id, adminIds),
    })),
  };

  if (ctx.chatType !== "private" && (text === "/info" || text.startsWith("/اطلاعات"))) {
    const count = await api("getChatMemberCount", { chat_id: chat.id });
    if (count.ok && typeof count.result === "number") ctx.membersCount = count.result;
  }

  const reply = handleCommand(ctx);
  if (reply.lang) chatLang.set(chat.id, reply.lang);
  if (reply.silent || !reply.text) return;
  await api("sendMessage", {
    chat_id: chat.id,
    text: reply.text,
    reply_to_message_id: msg.message_id,
  });
}

async function poll() {
  let offset = 0;
  console.log(`nizam phase-1 polling as ${config.botName}`);
  for (;;) {
    try {
      const data = await api("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });
      if (!data.ok || !Array.isArray(data.result)) {
        console.error(data.description ?? "getUpdates failed");
        await sleep(2000);
        continue;
      }
      for (const upd of data.result as TgUpdate[]) {
        offset = upd.update_id + 1;
        if (upd.message) await handleMessage(upd.message);
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

poll();
