import type { Pool, PoolClient } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { bindPanelMessage, touchPanelMessage } from "./panel-session.ts";

export type InviteLinkMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; username?: string };
  new_chat_members?: Array<{ id: number; first_name?: string; username?: string }>;
};

export type InviteLinkCallback = {
  id: string;
  from: { id: number };
  message?: InviteLinkMessage;
  data?: string;
};

type Flow = {
  state: string;
  data: Record<string, unknown>;
  message_id: number | null;
};

type InviteRow = {
  id: number;
  group_id: number;
  telegram_invite_link: string;
  name: string | null;
  type: string;
  creator_user_id: number | null;
  creator_username: string | null;
  is_primary: boolean;
  is_active: boolean;
  is_revoked: boolean;
  is_expired: boolean;
  is_consumed: boolean;
  is_one_time: boolean;
  member_limit: number | null;
  usage_count: number;
  expire_at: string | Date | null;
  creates_join_request: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  revoked_at: string | Date | null;
  consumed_at: string | Date | null;
};

const SEPARATOR = "─────━━───── ◈ ─────━━─────";
const PAGE_SIZE = 5;

function cleanLabel(value: string) {
  const raw = String(value || "").trim().replace(/^[^A-Za-z\u0600-\u06FF\u0660-\u0669‹›]+/u, "").trim();
  return raw || "—";
}

function btn(text: string, callback_data: string, style?: "primary" | "success" | "danger") {
  return {
    text: style === "primary" ? "‹ " + cleanLabel(text) : "› " + cleanLabel(text),
    callback_data,
    ...(style ? { style } : {}),
  };
}

function back(callback_data = "c:home") {
  return { text: "‹ بازگشت", callback_data, style: "primary" as const };
}

function copy(text: string) {
  return { text: "› کپی لینک", copy_text: { text } };
}

function statusBtn(text: string, callback_data: string, active: boolean) {
  return btn(text, callback_data, active ? "success" : "danger");
}

function keyboard(rows: Array<Array<Record<string, unknown>>>) {
  return { inline_keyboard: rows };
}

function formatDate(value: unknown) {
  if (!value) return "بدون انقضا";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return "ثبت نشده";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d).replace(",", "");
}

function creatorName(link: Partial<InviteRow>) {
  return link.creator_username ? "@" + link.creator_username.replace(/^@/, "") : link.creator_user_id ? String(link.creator_user_id) : "نامشخص";
}

function deriveType(link: any) {
  if (link.creates_join_request === true) return "request";
  if (Number(link.member_limit || 0) === 1 && !link.expire_date) return "one_time";
  if (Number(link.member_limit || 0) > 0) return "limited";
  if (link.expire_date) return "temporary";
  return "normal";
}

function isExpired(link: any) {
  return !!link.expire_date && Number(link.expire_date) * 1000 <= Date.now();
}

function computedStatus(link: Partial<InviteRow>) {
  if (link.is_revoked) return "revoked";
  if (link.is_expired || isExpired(link)) return "expired";
  if (link.member_limit != null && Number(link.member_limit) > 0 && Number(link.usage_count || 0) >= Number(link.member_limit)) return "exhausted";
  if (link.is_consumed || (link.is_one_time && Number(link.usage_count || 0) >= 1)) return "consumed";
  return "active";
}

function statusLabel(link: Partial<InviteRow>) {
  const status = computedStatus(link);
  return status === "active" ? "فعال"
    : status === "expired" ? "منقضی"
    : status === "revoked" ? "لغوشده"
    : status === "exhausted" ? "پایان‌یافته"
    : "مصرف‌شده";
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    normal: "معمولی",
    one_time: "یک‌بارمصرف",
    limited: "محدود",
    temporary: "موقت",
    request: "درخواست عضویت",
  };
  return map[type] || type;
}

async function ensureInviteLinkSchema(pool: Pool) {
  await pool.query(\`CREATE TABLE IF NOT EXISTS group_invite_links (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    telegram_invite_link TEXT NOT NULL UNIQUE,
    name TEXT,
    type TEXT NOT NULL DEFAULT 'normal',
    creator_user_id BIGINT,
    creator_username TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    is_expired BOOLEAN NOT NULL DEFAULT FALSE,
    is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
    is_one_time BOOLEAN NOT NULL DEFAULT FALSE,
    member_limit INTEGER,
    usage_count INTEGER NOT NULL DEFAULT 0,
    expire_at TIMESTAMPTZ,
    creates_join_request BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ
  )\`);
  await pool.query(\`CREATE TABLE IF NOT EXISTS invite_link_events (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    invite_link_id BIGINT REFERENCES group_invite_links(id) ON DELETE CASCADE,
    actor_user_id BIGINT,
    event_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )\`);
  await pool.query(\`CREATE TABLE IF NOT EXISTS invite_link_join_requests (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    invite_link_id BIGINT REFERENCES group_invite_links(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    username TEXT,
    first_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by BIGINT,
    UNIQUE(invite_link_id,user_id)
  )\`);
  await pool.query(\`CREATE TABLE IF NOT EXISTS invite_link_flows (
    user_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    state TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    message_id BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id,group_id)
  )\`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_group_invite_links_group ON group_invite_links(group_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_group_invite_links_active ON group_invite_links(group_id,is_active)");
}

async function getBotId() {
  const me = await telegramApi<any>("getMe", {});
  return me.ok && me.result?.id ? Number(me.result.id) : null;
}

async function canManageInviteLinks(groupId: number, userId: number) {
  const member = await telegramApi<any>("getChatMember", { chat_id: groupId, user_id: userId });
  if (!member.ok) return { allowed: false, reason: "member_lookup" };
  const status = String(member.result?.status || "");
  if (status === "creator") return { allowed: true, reason: "owner" };
  if (status !== "administrator") return { allowed: false, reason: "not_admin" };
  if (member.result?.can_invite_users !== true) return { allowed: false, reason: "can_invite_users" };
  return { allowed: true, reason: "admin" };
}

async function getFlow(pool: Pool, userId: number, groupId: number): Promise<Flow | null> {
  await ensureInviteLinkSchema(pool);
  const r = await pool.query(
    "SELECT state,data,message_id FROM invite_link_flows WHERE user_id=$1 AND group_id=$2 LIMIT 1",
    [userId, groupId],
  );
  if (!r.rows[0]) return null;
  return {
    state: String(r.rows[0].state),
    data: r.rows[0].data && typeof r.rows[0].data === "object" ? r.rows[0].data : {},
    message_id: r.rows[0].message_id ? Number(r.rows[0].message_id) : null,
  };
}

async function setFlow(pool: Pool, userId: number, groupId: number, state: string, data: Record<string, unknown>, messageId: number | null) {
  await pool.query(
    \`INSERT INTO invite_link_flows(user_id,group_id,state,data,message_id,updated_at)
     VALUES($1,$2,$3,$4::jsonb,$5,NOW())
     ON CONFLICT(user_id,group_id) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data,message_id=EXCLUDED.message_id,updated_at=NOW()\`,
    [userId, groupId, state, JSON.stringify(data), messageId],
  );
}

async function clearFlow(pool: Pool, userId: number, groupId: number) {
  await pool.query("DELETE FROM invite_link_flows WHERE user_id=$1 AND group_id=$2", [userId, groupId]);
}

async function event(pool: Pool, linkId: number | null, groupId: number, actorId: number | null, eventType: string, metadata: Record<string, unknown> = {}) {
  await pool.query(
    "INSERT INTO invite_link_events(group_id,invite_link_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,$4,$5::jsonb)",
    [groupId, linkId, actorId, eventType, JSON.stringify(metadata)],
  );
}

async function upsertTelegramLink(pool: Pool, groupId: number, link: any) {
  const expireAt = link.expire_date ? new Date(Number(link.expire_date) * 1000) : null;
  const type = deriveType(link);
  const temporaryExpired = !!expireAt && expireAt.getTime() <= Date.now();
  const creatorId = Number(link.creator?.id || 0) || null;
  const creatorUsername = link.creator?.username || null;
  const revoked = link.is_revoked === true;
  const primary = link.is_primary === true;
  const oneTime = type === "one_time";
  const limit = Number(link.member_limit || 0) || null;
  const active = !revoked && !temporaryExpired;
  const r = await pool.query(
    `INSERT INTO group_invite_links(
      group_id,telegram_invite_link,name,type,creator_user_id,creator_username,is_primary,
      is_active,is_revoked,is_expired,is_consumed,is_one_time,member_limit,expire_at,
      creates_join_request,usage_count,created_at,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,NOW(),NOW())
    ON CONFLICT(telegram_invite_link) DO UPDATE SET
      group_id=EXCLUDED.group_id,name=COALESCE(EXCLUDED.name,group_invite_links.name),type=EXCLUDED.type,
      creator_user_id=COALESCE(EXCLUDED.creator_user_id,group_invite_links.creator_user_id),
      creator_username=COALESCE(EXCLUDED.creator_username,group_invite_links.creator_username),
      is_primary=EXCLUDED.is_primary,is_revoked=EXCLUDED.is_revoked,
      is_expired=EXCLUDED.is_expired,is_one_time=EXCLUDED.is_one_time,
      member_limit=EXCLUDED.member_limit,expire_at=EXCLUDED.expire_at,
      creates_join_request=EXCLUDED.creates_join_request,
      is_consumed=CASE WHEN EXCLUDED.is_one_time AND group_invite_links.usage_count>=1 THEN TRUE ELSE group_invite_links.is_consumed END,
      is_active=CASE
        WHEN EXCLUDED.is_revoked THEN FALSE
        WHEN EXCLUDED.expire_at IS NOT NULL AND EXCLUDED.expire_at<=NOW() THEN FALSE
        WHEN EXCLUDED.member_limit IS NOT NULL AND group_invite_links.usage_count>=EXCLUDED.member_limit THEN FALSE
        WHEN EXCLUDED.is_one_time AND group_invite_links.usage_count>=1 THEN FALSE
        ELSE TRUE
      END,
      updated_at=NOW(),
      revoked_at=CASE WHEN EXCLUDED.is_revoked THEN COALESCE(group_invite_links.revoked_at,NOW()) ELSE group_invite_links.revoked_at END,
      consumed_at=CASE WHEN EXCLUDED.is_one_time AND group_invite_links.usage_count>=1 THEN COALESCE(group_invite_links.consumed_at,NOW()) ELSE group_invite_links.consumed_at END
    RETURNING *`,
    [groupId,String(link.invite_link),link.name||null,type,creatorId,creatorUsername,primary,active,revoked,temporaryExpired,false,oneTime,limit,expireAt,link.creates_join_request===true],
  );
  return r.rows[0] as InviteRow;
}


async function refreshDerivedStatuses(pool: Pool, groupId: number) {
  await pool.query(
    `UPDATE group_invite_links
     SET is_expired=CASE WHEN expire_at IS NOT NULL AND expire_at<=NOW() THEN TRUE ELSE is_expired END,
         is_consumed=CASE WHEN is_one_time AND usage_count>=1 THEN TRUE ELSE is_consumed END,
         is_active=CASE
           WHEN is_revoked THEN FALSE
           WHEN expire_at IS NOT NULL AND expire_at<=NOW() THEN FALSE
           WHEN member_limit IS NOT NULL AND usage_count>=member_limit THEN FALSE
           WHEN is_one_time AND usage_count>=1 THEN FALSE
           ELSE TRUE
         END,
         updated_at=NOW()
     WHERE group_id=$1`,
    [groupId],
  );
}

async function syncInviteLinks(pool: Pool, groupId: number) {
  await ensureInviteLinkSchema(pool);
  const chat = await telegramApi<any>("getChat", { chat_id: groupId });
  if (chat.ok && chat.result?.invite_link) {
    const botId = await getBotId();
    await upsertTelegramLink(pool, groupId, {
      invite_link: String(chat.result.invite_link),
      is_primary: true,
      is_revoked: false,
      creates_join_request: false,
      creator: botId ? { id: botId } : undefined,
    });
  }
  await refreshDerivedStatuses(pool, groupId);
}
async function getById(pool: Pool, groupId: number, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const r = await pool.query("SELECT * FROM group_invite_links WHERE id=$1 AND group_id=$2 LIMIT 1", [id, groupId]);
  return r.rows[0] as InviteRow | undefined || null;
}

async function getActiveLinks(pool: Pool, groupId: number) {
  await syncInviteLinks(pool, groupId);
  const r = await pool.query(
    "SELECT * FROM group_invite_links WHERE group_id=$1 AND is_revoked=FALSE ORDER BY is_primary DESC,created_at DESC",
    [groupId],
  );
  return r.rows as InviteRow[];
}

async function renderMain(pool: Pool, groupId: number, messageId: number | null, actorId: number) {
  await syncInviteLinks(pool, groupId);
  const rows = await getActiveLinks(pool, groupId);
  const active = rows.filter(x => computedStatus(x) === "active").length;
  const expired = rows.filter(x => computedStatus(x) === "expired").length;
  const revoked = Number((await pool.query(
    "SELECT COUNT(*)::int AS n FROM group_invite_links WHERE group_id=$1 AND is_revoked=TRUE",
    [groupId],
  )).rows[0]?.n || 0);
  const primary = rows.find(x => x.is_primary && computedStatus(x) === "active");
  const text = [
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Lɪɴᴋ Cᴇɴᴛᴇʀ",
    "",
    "● وضعیت سیستم لینک : فعال",
    "⛂ لینک اصلی : " + (primary ? "فعال" : "غیرفعال"),
    "⛂ لینک‌های فعال : " + active,
    "⛂ لینک‌های منقضی : " + expired,
    "⛂ لینک‌های لغوشده : " + revoked,
    "",
    SEPARATOR,
    "",
  ].join("\n");
  const markup = keyboard([
    [btn("ساخت لینک","link:create"), btn("لینک فعلی","link:current")],
    [btn("لینک‌های من","link:mine"), btn("مدیریت لینک‌ها","link:list:all:1")],
    [btn("یک‌بارمصرف","link:list:one_time:1"), btn("موقت","link:list:temporary:1")],
    [btn("محدود","link:list:limited:1"), btn("درخواست عضویت","link:list:request:1")],
    [btn("آمار لینک‌ها","link:stats"), btn("تاریخچه لینک‌ها","link:history:1")],
    [back()],
  ]);
  return editOrSend(pool, groupId, messageId, actorId, text, markup);
}

async function editOrSend(pool: Pool, groupId: number, messageId: number | null, actorId: number, text: string, markup: any) {
  if (messageId) {
    const edited = await telegramApi("editMessageText", {
      chat_id: groupId,
      message_id: messageId,
      text,
      reply_markup: markup,
    });
    if (edited.ok) {
      await touchPanelMessage(pool, groupId, messageId, actorId).catch(() => {});
      return edited;
    }
  }
  const sent = await telegramApi("sendMessage", { chat_id: groupId, text, reply_markup: markup });
  if (sent.ok) {
    const sentId = Number((sent.result as any)?.message_id);
    if (Number.isSafeInteger(sentId) && sentId > 0) await bindPanelMessage(pool, groupId, sentId, actorId, "customer");
  }
  return sent;
}

async function renderCreate(pool: Pool, groupId: number, messageId: number, actorId: number) {
  const text = [
    "◈ ساخت لینک دعوت",
    "",
    "نوع لینک را انتخاب کنید:",
    "",
    SEPARATOR,
  ].join("\n");
  return editOrSend(pool, groupId, messageId, actorId, text, keyboard([
    [btn("لینک معمولی","link:create:normal"), btn("یک‌بارمصرف","link:create:one_time")],
    [btn("محدود به تعداد عضو","link:create:limited"), btn("دارای تاریخ انقضا","link:create:temporary")],
    [btn("دارای درخواست عضویت","link:create:request")],
    [back("link:menu")],
  ]));
}

async function createLink(pool: Pool, groupId: number, actorId: number, type: string, opts: { member_limit?: number; expire_at?: Date; creates_join_request?: boolean }) {
  const permission = await canManageInviteLinks(groupId, actorId);
  if (!permission.allowed) return { ok: false, error: "permission" as const };
  const body: Record<string, unknown> = { chat_id: groupId };
  if (opts.member_limit) body.member_limit = opts.member_limit;
  if (opts.expire_at) body.expire_date = Math.floor(opts.expire_at.getTime() / 1000);
  if (opts.creates_join_request) body.creates_join_request = true;
  const result = await telegramApi<any>("createChatInviteLink", body);
  if (!result.ok || !result.result?.invite_link) return { ok: false, error: "telegram" as const, detail: result.description };
  const apiLink = result.result;
  const row = await upsertTelegramLink(pool, groupId, apiLink);
  await event(pool, row.id, groupId, actorId, "created", {
    type,
    member_limit: opts.member_limit ?? null,
    expire_at: opts.expire_at?.toISOString() ?? null,
    creates_join_request: !!opts.creates_join_request,
  });
  return { ok: true, row };
}

async function renderCreated(pool: Pool, groupId: number, messageId: number, actorId: number, row: InviteRow, notice = "لینک ساخته شد") {
  const status = computedStatus(row);
  const text = [
    "◈ " + (row.type === "one_time" ? "لینک یک‌بارمصرف" : notice),
    "",
    "⛂ نوع : " + typeLabel(row.type),
    "⛂ وضعیت : " + statusLabel(row),
    "⛂ ایجادکننده : " + creatorName(row),
    "⛂ تاریخ ایجاد : " + formatDate(row.created_at),
    "⛂ تعداد استفاده : " + Number(row.usage_count || 0),
    "⛂ تاریخ انقضا : " + formatDate(row.expire_at),
    ...(row.member_limit ? ["⛂ سقف عضویت : " + row.member_limit] : []),
    ...(row.creates_join_request ? ["⛂ درخواست‌های در انتظار : " + await pendingCount(pool, row.id)] : []),
    "",
    SEPARATOR,
    "",
    row.telegram_invite_link,
  ].join("\n");
  const active = status === "active";
  const rows: Array<Array<Record<string, unknown>>> = [
    [copy(row.telegram_invite_link), btn("لغو لینک","link:revoke:"+row.id,"danger")],
    [btn("مشخصات لینک","link:details:"+row.id)],
  ];
  if (row.creates_join_request) rows.push([btn("درخواست‌های در انتظار","link:requests:"+row.id)]);
  rows.push([back("link:menu")]);
  return editOrSend(pool, groupId, messageId, actorId, text, keyboard(rows));
}

async function pendingCount(pool: Pool, linkId: number) {
  return Number((await pool.query("SELECT COUNT(*)::int AS n FROM invite_link_join_requests WHERE invite_link_id=$1 AND status='pending'", [linkId])).rows[0]?.n || 0);
}

async function renderCurrent(pool: Pool, groupId: number, messageId: number, actorId: number) {
  let rows = await getActiveLinks(pool, groupId);
  let link = rows.find(x => x.is_primary && computedStatus(x) === "active");
  if (!link) {
    const exported = await telegramApi<any>("exportChatInviteLink", { chat_id: groupId });
    if (!exported.ok || !exported.result) {
      return editOrSend(pool, groupId, messageId, actorId, "⛂ ربات دسترسی لازم برای ساخت لینک دعوت را ندارد.", keyboard([[back("link:menu")]]));
    }
    link = await upsertTelegramLink(pool, groupId, { invite_link: String(exported.result), is_primary: true, is_revoked: false, creator: { id: await getBotId() } });
    await event(pool, link.id, groupId, actorId, "created", { type: "primary" });
  }
  const text = [
    "◈ لینک فعلی",
    "",
    "⛂ وضعیت : " + statusLabel(link),
    "⛂ نوع : " + typeLabel(link.type),
    "⛂ ایجادکننده : " + creatorName(link),
    "⛂ استفاده : " + Number(link.usage_count || 0),
    "⛂ انقضا : " + formatDate(link.expire_at),
    "",
    SEPARATOR,
    "",
    link.telegram_invite_link,
  ].join("\n");
  const rows: Array<Array<Record<string, unknown>>> = [
    [copy(link.telegram_invite_link), btn("بازسازی لینک","link:rebuild:"+link.id)],
    [btn("لغو لینک","link:revoke:"+link.id,"danger"), btn("مشخصات کامل","link:details:"+link.id)],
    [back("link:menu")],
  ];
  return editOrSend(pool, groupId, messageId, actorId, text, keyboard(rows));
}

async function renderDetails(pool: Pool, groupId: number, messageId: number, actorId: number, id: number) {
  const link = await getById(pool, groupId, id);
  if (!link) return editOrSend(pool, groupId, messageId, actorId, "⛂ این لینک برای این گروه پیدا نشد.", keyboard([[back("link:menu")]]));
  const status = computedStatus(link);
  const pending = await pendingCount(pool, id);
  const text = [
    "◈ مشخصات لینک",
    "",
    "⛂ شناسه : " + link.id,
    "⛂ نوع : " + typeLabel(link.type),
    "⛂ وضعیت : " + statusLabel(link),
    "⛂ ایجادکننده : " + creatorName(link),
    "⛂ ایجاد : " + formatDate(link.created_at),
    "⛂ استفاده : " + Number(link.usage_count || 0),
    "⛂ سقف عضویت : " + (link.member_limit ?? "بدون محدودیت"),
    "⛂ انقضا : " + formatDate(link.expire_at),
    "⛂ درخواست عضویت : " + (link.creates_join_request ? "فعال" : "خاموش"),
    "⛂ درخواست‌های در انتظار : " + pending,
    "",
    SEPARATOR,
    "",
    link.telegram_invite_link,
  ].join("\n");
  const actions: Array<Record<string, unknown>> = [copy(link.telegram_invite_link)];
  if (status === "active") actions.push(btn("لغو لینک","link:revoke:"+id,"danger"));
  actions.push(back("link:menu"));
  return editOrSend(pool, groupId, messageId, actorId, text, keyboard([actions]));
}

async function renderCreateConfirm(pool: Pool, groupId: number, messageId: number, actorId: number, data: Record<string, unknown>) {
  const type = String(data.type || "normal");
  const lines = [
    "◈ تأیید ساخت لینک",
    "",
    "⛂ نوع : " + typeLabel(type),
    data.member_limit ? "⛂ سقف عضویت : " + String(data.member_limit) : "",
    data.expire_at ? "⛂ انقضا : " + formatDate(data.expire_at) : "⛂ انقضا : بدون انقضا",
    type === "request" ? "⛂ درخواست عضویت : فعال" : "",
    "",
    "لینک پس از تأیید از Telegram API ساخته می‌شود.",
    "",
    SEPARATOR,
  ].filter(Boolean);
  return editOrSend(pool, groupId, messageId, actorId, lines.join("\n"), keyboard([
    [btn("تأیید","link:confirm_create","success"), btn("انصراف","link:create","danger")],
    [back("link:create")],
  ]));
}

async function renderLimitOptions(pool: Pool, groupId: number, messageId: number, actorId: number) {
  await setFlow(pool, actorId, groupId, "create_limit", {}, messageId);
  return editOrSend(pool, groupId, messageId, actorId, [
    "◈ محدودیت تعداد عضو",
    "",
    "سقف عضویت را انتخاب کنید:",
    "",
    SEPARATOR,
  ].join("\n"), keyboard([
    [btn("1","link:limit:1"), btn("5","link:limit:5"), btn("10","link:limit:10")],
    [btn("50","link:limit:50"), btn("100","link:limit:100"), btn("مقدار دلخواه","link:limit:custom")],
    [back("link:create")],
  ]));
}

async function renderExpireOptions(pool: Pool, groupId: number, messageId: number, actorId: number) {
  await setFlow(pool, actorId, groupId, "create_expire", {}, messageId);
  return editOrSend(pool, groupId, messageId, actorId, [
    "◈ تاریخ انقضا",
    "",
    "زمان انقضا را انتخاب کنید:",
    "",
    SEPARATOR,
  ].join("\n"), keyboard([
    [btn("10 دقیقه","link:expire:600"), btn("1 ساعت","link:expire:3600")],
    [btn("6 ساعت","link:expire:21600"), btn("12 ساعت","link:expire:43200")],
    [btn("1 روز","link:expire:86400"), btn("3 روز","link:expire:259200")],
    [btn("7 روز","link:expire:604800"), btn("زمان دلخواه","link:expire:custom")],
    [back("link:create")],
  ]));
}

async function renderList(pool: Pool, groupId: number, messageId: number, actorId: number, filter = "all", page = 1) {
  await syncInviteLinks(pool, groupId);
  const validFilters = new Set(["all","active","expired","revoked","one_time","temporary","limited","request","mine"]);
  if (!validFilters.has(filter)) filter = "all";
  const where: string[] = ["group_id=$1"];
  const params: unknown[] = [groupId];
  if (filter === "revoked") where.push("is_revoked=TRUE");
  if (filter !== "revoked") where.push("is_revoked=FALSE");
  if (filter === "active") where.push("is_active=TRUE AND is_expired=FALSE");
  if (filter === "expired") where.push("is_expired=TRUE");
  if (filter === "one_time") where.push("is_one_time=TRUE");
  if (filter === "temporary") where.push("type='temporary'");
  if (filter === "limited") where.push("type='limited'");
  if (filter === "request") where.push("creates_join_request=TRUE");
  if (filter === "mine") where.push("creator_user_id=$2"), params.push(actorId);
  const count = Number((await pool.query("SELECT COUNT(*)::int n FROM group_invite_links WHERE "+where.join(" AND "),params)).rows[0]?.n || 0);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  page = Math.max(1, Math.min(Number(page) || 1, pages));
  const offset = (page - 1) * PAGE_SIZE;
  const rows = (await pool.query(
    "SELECT * FROM group_invite_links WHERE "+where.join(" AND ")+" ORDER BY is_primary DESC,created_at DESC LIMIT "+PAGE_SIZE+" OFFSET "+offset,
    params,
  )).rows as InviteRow[];
  const lines = ["◈ مدیریت لینک‌ها","", "⛂ فیلتر : " + (filter === "all" ? "همه" : filter),"⛂ تعداد : " + count,"",SEPARATOR,""];
  for (const row of rows) lines.push("⛂ #" + row.id + " · " + typeLabel(row.type) + " · " + statusLabel(row) + " · " + Number(row.usage_count || 0) + " استفاده");
  if (!rows.length) lines.push("⛂ موردی پیدا نشد.");
  const controls = [
    [btn("همه","link:list:all:1"), btn("فعال","link:list:active:1"), btn("منقضی","link:list:expired:1")],
    [btn("لغوشده","link:list:revoked:1"), btn("یک‌بارمصرف","link:list:one_time:1")],
    [btn("موقت","link:list:temporary:1"), btn("محدود","link:list:limited:1"), btn("درخواست عضویت","link:list:request:1")],
  ];
  for (const row of rows) {
    controls.push([statusBtn("لینک #"+row.id,"link:view:"+row.id,computedStatus(row)==="active")]);
  }
  controls.push([
    page > 1 ? btn("قبلی","link:list:"+filter+":"+(page-1)) : { text: "‹ قبلی", callback_data: "link:noop", style: "primary" },
    { text: "صفحه "+page+" / "+pages, callback_data: "link:noop" },
    page < pages ? btn("بعدی","link:list:"+filter+":"+(page+1)) : { text: "بعدی ›", callback_data: "link:noop" },
  ]);
  controls.push([back("link:menu")]);
  return editOrSend(pool, groupId, messageId, actorId, lines.join("\n"), keyboard(controls));
}

async function renderMine(pool: Pool, groupId: number, messageId: number, actorId: number, page = 1) {
  return renderList(pool, groupId, messageId, actorId, "mine", page);
}

async function renderStats(pool: Pool, groupId: number, messageId: number, actorId: number) {
  await syncInviteLinks(pool, groupId);
  const [total,active,expired,revoked,usage,creators,pending] = await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM group_invite_links WHERE group_id=$1",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM group_invite_links WHERE group_id=$1 AND is_revoked=FALSE AND is_expired=FALSE AND is_active=TRUE",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM group_invite_links WHERE group_id=$1 AND is_expired=TRUE",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM group_invite_links WHERE group_id=$1 AND is_revoked=TRUE",[groupId]),
    pool.query("SELECT COALESCE(SUM(usage_count),0)::int n FROM group_invite_links WHERE group_id=$1",[groupId]),
    pool.query("SELECT COUNT(DISTINCT creator_user_id)::int n FROM group_invite_links WHERE group_id=$1",[groupId]),
    pool.query("SELECT COUNT(*)::int n FROM invite_link_join_requests WHERE group_id=$1 AND status='pending'",[groupId]),
  ]);
  const most = (await pool.query("SELECT id,telegram_invite_link,usage_count FROM group_invite_links WHERE group_id=$1 ORDER BY usage_count DESC,id ASC LIMIT 1",[groupId])).rows[0];
  const lines = [
    "◈ Lɪɴᴋ Sᴛᴀᴛs",
    "",
    "⛂ کل لینک‌ها : " + Number(total.rows[0]?.n || 0),
    "⛂ فعال : " + Number(active.rows[0]?.n || 0),
    "⛂ منقضی : " + Number(expired.rows[0]?.n || 0),
    "⛂ لغوشده : " + Number(revoked.rows[0]?.n || 0),
    "⛂ استفاده کل : " + Number(usage.rows[0]?.n || 0),
    "⛂ سازندگان : " + Number(creators.rows[0]?.n || 0),
    "⛂ درخواست‌های عضویت : " + Number(pending.rows[0]?.n || 0),
    "⛂ لینک پُراستفاده : " + (most ? "#"+most.id+" · "+most.usage_count : "—"),
    "",
    SEPARATOR,
  ];
  return editOrSend(pool, groupId, messageId, actorId, lines.join("\n"), keyboard([
    [btn("آمار سازندگان","link:stats:creators"), btn("آمار لینک‌ها","link:stats:links")],
    [back("link:menu")],
  ]));
}

async function renderHistory(pool: Pool, groupId: number, messageId: number, actorId: number, page = 1) {
  await ensureInviteLinkSchema(pool);
  const count = Number((await pool.query("SELECT COUNT(*)::int n FROM invite_link_events WHERE group_id=$1",[groupId])).rows[0]?.n || 0);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  page = Math.max(1, Math.min(Number(page) || 1, pages));
  const rows = (await pool.query(
    "SELECT id,invite_link_id,event_type,created_at FROM invite_link_events WHERE group_id=$1 ORDER BY created_at DESC LIMIT "+PAGE_SIZE+" OFFSET "+((page-1)*PAGE_SIZE),
    [groupId],
  )).rows;
  const label: Record<string,string> = {
    created:"ساخت لینک",
    revoked:"لغو لینک",
    expired:"انقضا",
    used:"استفاده از لینک",
    consumed:"مصرف‌شده",
    rebuilt:"بازسازی لینک",
    limit_changed:"تغییر محدودیت",
    expiration_changed:"تغییر زمان انقضا",
    join_request_created:"ایجاد درخواست عضویت",
    join_request_approved:"تأیید درخواست",
    join_request_declined:"رد درخواست",
  };
  const lines = ["◈ تاریخچه لینک‌ها","",SEPARATOR,""];
  for (const row of rows) lines.push("⛂ "+formatDate(row.created_at)+" — "+(label[String(row.event_type)]||String(row.event_type))+" · #"+String(row.invite_link_id||"—"));
  if (!rows.length) lines.push("⛂ رویدادی ثبت نشده است.");
  const nav: Array<Record<string, unknown>> = [];
  if (page > 1) nav.push(btn("قبلی","link:history:"+(page-1)));
  nav.push({ text: "صفحه "+page+" / "+pages, callback_data: "link:noop" });
  if (page < pages) nav.push(btn("بعدی","link:history:"+(page+1)));
  return editOrSend(pool, groupId, messageId, actorId, lines.join("\n"), keyboard([
    nav,
    [back("link:menu")],
  ]));
}

async function rebuildLink(pool: Pool, groupId: number, actorId: number, id: number) {
  const permission = await canManageInviteLinks(groupId, actorId);
  if (!permission.allowed) return { ok: false, error: "permission" as const };
  const old = await getById(pool, groupId, id);
  if (!old || computedStatus(old) !== "active") return { ok: false, error: "inactive" as const };

  if (old.is_primary) {
    const created = await telegramApi<any>("exportChatInviteLink", { chat_id: groupId });
    if (!created.ok || !created.result) return { ok: false, error: "telegram" as const };
    const newRow = await upsertTelegramLink(pool, groupId, {
      invite_link: String(created.result),
      is_primary: true,
      is_revoked: false,
      creator: { id: await getBotId() },
    });
    await pool.query(
      "UPDATE group_invite_links SET is_active=FALSE,is_revoked=TRUE,revoked_at=NOW(),updated_at=NOW() WHERE id=$1 AND group_id=$2",
      [old.id,groupId],
    );
    await event(pool,old.id,groupId,actorId,"revoked",{reason:"rebuild"});
    await event(pool,newRow.id,groupId,actorId,"rebuilt",{replaced_link_id:old.id,primary:true});
    return { ok: true, row: newRow };
  }

  const revoke = await telegramApi("revokeChatInviteLink", { chat_id: groupId, invite_link: old.telegram_invite_link });
  if (!revoke.ok) return { ok: false, error: "telegram" as const };
  const created = await telegramApi<any>("createChatInviteLink", { chat_id: groupId });
  if (!created.ok || !created.result?.invite_link) return { ok: false, error: "telegram" as const };
  const newRow = await upsertTelegramLink(pool, groupId, { ...created.result, is_primary: false });
  await pool.query("UPDATE group_invite_links SET is_active=FALSE,is_revoked=TRUE,revoked_at=NOW(),updated_at=NOW() WHERE id=$1 AND group_id=$2",[old.id,groupId]);
  await event(pool,old.id,groupId,actorId,"revoked",{reason:"rebuild"});
  await event(pool,newRow.id,groupId,actorId,"rebuilt",{replaced_link_id:old.id});
  return { ok: true, row: newRow };
}

async function revokeLink(pool: Pool, groupId: number, actorId: number, id: number) {
  const permission = await canManageInviteLinks(groupId, actorId);
  if (!permission.allowed) return { ok: false, error: "permission" as const };
  const row = await getById(pool, groupId, id);
  if (!row) return { ok: false, error: "not_found" as const };
  if (row.is_revoked) return { ok: false, error: "already_revoked" as const };
  const result = await telegramApi("revokeChatInviteLink", { chat_id: groupId, invite_link: row.telegram_invite_link });
  if (!result.ok) return { ok: false, error: "telegram" as const };
  await pool.query("UPDATE group_invite_links SET is_active=FALSE,is_revoked=TRUE,revoked_at=NOW(),updated_at=NOW() WHERE id=$1 AND group_id=$2",[id,groupId]);
  await event(pool,id,groupId,actorId,"revoked");
  await syncInviteLinks(pool,groupId);
  return { ok: true };
}

async function renderRequests(pool: Pool, groupId: number, messageId: number, actorId: number, id: number) {
  const row = await getById(pool, groupId, id);
  if (!row || !row.creates_join_request) return editOrSend(pool, groupId, messageId, actorId, "⛂ این لینک درخواست عضویت ندارد.", keyboard([[back("link:menu")]]));
  const pending = await pool.query("SELECT id,user_id,username,first_name,requested_at FROM invite_link_join_requests WHERE invite_link_id=$1 AND status='pending' ORDER BY requested_at ASC LIMIT 50",[id]);
  const lines = [
    "◈ درخواست‌های عضویت",
    "",
    "⛂ لینک : #"+id,
    "⛂ در انتظار : "+pending.rows.length,
    "",
    SEPARATOR,
    "",
  ];
  for (const r of pending.rows) lines.push("⛂ "+formatDate(r.requested_at)+" — "+(r.username ? "@"+r.username : r.first_name || r.user_id));
  if (!pending.rows.length) lines.push("⛂ درخواست در انتظاری ثبت نشده است.");
  const requestButtons: Array<Array<Record<string, unknown>>> = [];
  for (const r of pending.rows.slice(0,10)) {
    requestButtons.push([btn("تأیید #"+r.id,"link:request:approve:"+r.id,"success"),btn("رد #"+r.id,"link:request:reject:"+r.id,"danger")]);
  }
  const common = [
    [btn("تأیید همه","link:request:approve_all:"+id,"success"), btn("رد همه","link:request:reject_all:"+id,"danger")],
    [btn("لغو لینک","link:revoke:"+id,"danger")],
    [back("link:details:"+id)],
  ];
  return editOrSend(pool, groupId, messageId, actorId, lines.join("\n"), keyboard([
    ...requestButtons,

    ...common,
  ]));
}

async function processAllRequests(pool: Pool, groupId: number, actorId: number, id: number, approve: boolean) {
  const permission = await canManageInviteLinks(groupId, actorId);
  if (!permission.allowed) return { ok: false, error: "permission" as const };
  const row = await getById(pool, groupId, id);
  if (!row) return { ok: false, error: "not_found" as const };
  const claimed = await pool.query(
    "UPDATE invite_link_join_requests SET status='processing' WHERE invite_link_id=$1 AND status='pending' RETURNING id,user_id",
    [id],
  );
  let ok = 0;
  for (const request of claimed.rows) {
    const method = approve ? "approveChatJoinRequest" : "declineChatJoinRequest";
    const result = await telegramApi(method, { chat_id: groupId, user_id: Number(request.user_id) });
    if (result.ok) {
      await pool.query("UPDATE invite_link_join_requests SET status=$1,processed_at=NOW(),processed_by=$2 WHERE id=$3",[approve?"approved":"declined",actorId,request.id]);
      await event(pool,id,groupId,actorId,approve?"join_request_approved":"join_request_declined",{user_id:Number(request.user_id)});
      ok++;
    } else {
      await pool.query("UPDATE invite_link_join_requests SET status='pending' WHERE id=$1",[request.id]);
    }
  }
  return { ok: true, count: ok };
}

async function handleCallback(pool: Pool, cb: InviteLinkCallback) {
  const message = cb.message;
  if (!message) return false;
  const groupId = Number(message.chat.id);
  const actorId = Number(cb.from.id);
  const data = String(cb.data || "");
  if (!data.startsWith("link:")) return false;
  await ensureInviteLinkSchema(pool);
  const permission = await canManageInviteLinks(groupId, actorId);
  if (!permission.allowed) {
    return editOrSend(pool, groupId, message.message_id, actorId, "⛂ دسترسی به مدیریت لینک‌های این گروه برای شما فعال نیست.", keyboard([[back("c:home")]]));
  }

  if (data === "link:menu") return renderMain(pool, groupId, message.message_id, actorId);
  if (data === "link:create") {
    await clearFlow(pool, actorId, groupId);
    return renderCreate(pool, groupId, message.message_id, actorId);
  }
  if (data === "link:create:normal") {
    const created = await createLink(pool, groupId, actorId, "normal", {});
    if (!created.ok) return editOrSend(pool, groupId, message.message_id, actorId, "⛂ ساخت لینک انجام نشد. لطفاً دوباره تلاش کنید.", keyboard([[back("link:create")]]));
    return renderCreated(pool, groupId, message.message_id, actorId, created.row);
  }
  if (data === "link:create:one_time") {
    const created = await createLink(pool, groupId, actorId, "one_time", { member_limit: 1 });
    if (!created.ok) return editOrSend(pool, groupId, message.message_id, actorId, "⛂ ساخت لینک یک‌بارمصرف انجام نشد.", keyboard([[back("link:create")]]));
    return renderCreated(pool, groupId, message.message_id, actorId, created.row);
  }
  if (data === "link:create:limited") return renderLimitOptions(pool, groupId, message.message_id, actorId);
  if (data === "link:create:temporary") return renderExpireOptions(pool, groupId, message.message_id, actorId);
  if (data === "link:create:request") {
    const created = await createLink(pool, groupId, actorId, "request", { creates_join_request: true });
    if (!created.ok) return editOrSend(pool, groupId, message.message_id, actorId, "⛂ ساخت لینک درخواست عضویت انجام نشد.", keyboard([[back("link:create")]]));
    return renderCreated(pool, groupId, message.message_id, actorId, created.row);
  }
  if (data.startsWith("link:limit:")) {
    const value = data.slice("link:limit:".length);
    if (value === "custom") {
      await setFlow(pool, actorId, groupId, "create_limit_input", {}, message.message_id);
      return editOrSend(pool, groupId, message.message_id, actorId, "◈ محدودیت تعداد عضو\n\nتعداد را به صورت یک عدد مثبت وارد کنید.\n\n"+SEPARATOR, keyboard([[back("link:create:limited")]]));
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || n > 99999) return false;
    await setFlow(pool, actorId, groupId, "create_confirm", { type:"limited", member_limit:n }, message.message_id);
    return renderCreateConfirm(pool, groupId, message.message_id, actorId, { type:"limited", member_limit:n });
  }
  if (data.startsWith("link:expire:")) {
    const value = data.slice("link:expire:".length);
    if (value === "custom") {
      await setFlow(pool, actorId, groupId, "create_expire_input", {}, message.message_id);
      return editOrSend(pool, groupId, message.message_id, actorId, "◈ زمان انقضا\n\nفرمت را دقیقاً به صورت YYYY-MM-DD HH:mm ارسال کنید.\nTimezone: Asia/Tehran\n\n"+SEPARATOR, keyboard([[back("link:create:temporary")]]));
    }
    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds <= 0) return false;
    const expire = new Date(Date.now() + seconds*1000);
    await setFlow(pool, actorId, groupId, "create_confirm", { type:"temporary", expire_at:expire.toISOString() }, message.message_id);
    return renderCreateConfirm(pool, groupId, message.message_id, actorId, { type:"temporary", expire_at:expire.toISOString() });
  }
  if (data === "link:confirm_create") {
    const flow = await getFlow(pool, actorId, groupId);
    if (!flow || flow.state !== "create_confirm") return false;
    const type = String(flow.data.type || "");
    const created = await createLink(pool, groupId, actorId, type, {
      member_limit: flow.data.member_limit ? Number(flow.data.member_limit) : undefined,
      expire_at: flow.data.expire_at ? new Date(String(flow.data.expire_at)) : undefined,
      creates_join_request: type === "request",
    });
    await clearFlow(pool, actorId, groupId);
    if (!created.ok) return editOrSend(pool, groupId, message.message_id, actorId, "⛂ ساخت لینک انجام نشد. لطفاً دسترسی ربات و تنظیمات گروه را بررسی کنید.", keyboard([[back("link:create")]]));
    return renderCreated(pool, groupId, message.message_id, actorId, created.row);
  }
  if (data === "link:current") return renderCurrent(pool, groupId, message.message_id, actorId);
  if (data === "link:mine") return renderMine(pool, groupId, message.message_id, actorId, 1);
  if (data.startsWith("link:list:")) {
    const parts = data.split(":");
    return renderList(pool, groupId, message.message_id, actorId, parts[2] || "all", Number(parts[3] || 1));
  }
  if (data === "link:stats") return renderStats(pool, groupId, message.message_id, actorId);
  if (data === "link:stats:creators") {
    const rows = await pool.query("SELECT COALESCE(creator_username,creator_user_id::text,'unknown') AS creator,COUNT(*)::int count,COALESCE(SUM(usage_count),0)::int usage FROM group_invite_links WHERE group_id=$1 GROUP BY 1 ORDER BY count DESC,usage DESC LIMIT 20",[groupId]);
    return editOrSend(pool, groupId, message.message_id, actorId, ["◈ آمار سازندگان","",SEPARATOR,"",...rows.rows.map((r:any)=>"⛂ "+r.creator+" · "+r.count+" لینک · "+r.usage+" استفاده")].join("\n"),keyboard([[back("link:stats")]]));
  }
  if (data === "link:stats:links") return renderList(pool,groupId,message.message_id,actorId,"all",1);
  if (data.startsWith("link:history:")) return renderHistory(pool,groupId,message.message_id,actorId,Number(data.split(":")[2]||1));
  if (data === "link:history") return renderHistory(pool,groupId,message.message_id,actorId,1);
  if (data === "link:rebuild") {
    const current = await getActiveLinks(pool,groupId);
    const primary = current.find(x=>x.is_primary && computedStatus(x)==="active");
    if (!primary) return editOrSend(pool,groupId,message.message_id,actorId,"⛂ لینک اصلی فعالی وجود ندارد.",keyboard([[back("link:menu")]]));
    return editOrSend(pool,groupId,message.message_id,actorId,"◈ بازسازی لینک\n\nبا این کار لینک فعلی لغو و یک لینک جدید ساخته می‌شود.\n\n"+SEPARATOR,keyboard([
      [btn("تأیید","link:confirm_rebuild:"+primary.id,"success"),btn("انصراف","link:current")],
      [back("link:current")]
    ]));
  }
  if (data.startsWith("link:rebuild:")) {
    const id = Number(data.split(":")[2] || 0);
    const link = await getById(pool,groupId,id);
    if (!link) return false;
    return editOrSend(pool,groupId,message.message_id,actorId,"◈ بازسازی لینک\n\nاین لینک پس از بازسازی لغو و یک لینک جدید ساخته می‌شود.\n\n"+SEPARATOR,keyboard([
      [btn("تأیید","link:confirm_rebuild:"+id,"success"),btn("انصراف","link:details:"+id)],
      [back("link:details:"+id)]
    ]));
  }
  if (data.startsWith("link:confirm_rebuild:")) {
    const id = Number(data.split(":")[2] || 0);
    const result = await rebuildLink(pool,groupId,actorId,id);
    if (!result.ok) return editOrSend(pool,groupId,message.message_id,actorId,"⛂ بازسازی لینک انجام نشد. لطفاً دوباره تلاش کنید.",keyboard([[back("link:menu")]]));
    return renderCreated(pool,groupId,message.message_id,actorId,result.row,"لینک بازسازی شد");
  }
  if (data.startsWith("link:revoke:")) {
    const id = Number(data.split(":")[2] || 0);
    const row = await getById(pool,groupId,id);
    if (!row) return editOrSend(pool,groupId,message.message_id,actorId,"⛂ لینک پیدا نشد.",keyboard([[back("link:menu")]]));
    return editOrSend(pool,groupId,message.message_id,actorId,"◈ لغو لینک\n\nاین لینک پس از لغو دیگر قابل استفاده نخواهد بود.\n\n"+SEPARATOR,keyboard([
      [btn("تأیید لغو","link:confirm_revoke:"+id,"danger"),btn("انصراف","link:details:"+id)],
      [back("link:details:"+id)]
    ]));
  }
  if (data.startsWith("link:confirm_revoke:")) {
    const id = Number(data.split(":")[2] || 0);
    const result = await revokeLink(pool,groupId,actorId,id);
    if (!result.ok) {
      const text = result.error === "already_revoked" ? "⛂ این لینک قبلاً لغو شده است." : "⛂ لغو لینک انجام نشد. لطفاً دوباره تلاش کنید.";
      return editOrSend(pool,groupId,message.message_id,actorId,text,keyboard([[back("link:menu")]]));
    }
    return editOrSend(pool,groupId,message.message_id,actorId,"◈ لینک لغو شد\n\n⛂ وضعیت : لغوشده\n\n"+SEPARATOR,keyboard([[back("link:menu")]]));
  }
  if (data.startsWith("link:view:")) {
    const id = Number(data.split(":")[2] || 0);
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    return renderDetails(pool,groupId,message.message_id,actorId,id);
  }
  if (data.startsWith("link:details:")) {
    const id = Number(data.split(":")[2] || 0);
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    return renderDetails(pool,groupId,message.message_id,actorId,id);
  }
  if (data.startsWith("link:requests:")) {
    const id = Number(data.split(":")[2] || 0);
    return renderRequests(pool,groupId,message.message_id,actorId,id);
  }
  if (data.startsWith("link:request:approve:")) {
    const requestId = Number(data.split(":")[3] || 0);
    const request = (await pool.query(
      "SELECT id,invite_link_id,user_id,status FROM invite_link_join_requests WHERE id=$1 AND group_id=$2 LIMIT 1",
      [requestId,groupId],
    )).rows[0];
    if (!request || request.status !== "pending") return editOrSend(pool,groupId,message.message_id,actorId,"⛂ این درخواست دیگر در انتظار نیست.",keyboard([[back("link:menu")]]));
    const result = await telegramApi("approveChatJoinRequest",{chat_id:groupId,user_id:Number(request.user_id)});
    if (!result.ok) return editOrSend(pool,groupId,message.message_id,actorId,"⛂ تأیید درخواست انجام نشد.",keyboard([[back("link:requests:"+request.invite_link_id)]]));
    await pool.query("UPDATE invite_link_join_requests SET status='approved',processed_at=NOW(),processed_by=$1 WHERE id=$2",[actorId,requestId]);
    await event(pool,Number(request.invite_link_id),groupId,actorId,"join_request_approved",{user_id:Number(request.user_id)});
    return renderRequests(pool,groupId,message.message_id,actorId,Number(request.invite_link_id));
  }
  if (data.startsWith("link:request:reject:")) {
    const requestId = Number(data.split(":")[3] || 0);
    const request = (await pool.query(
      "SELECT id,invite_link_id,user_id,status FROM invite_link_join_requests WHERE id=$1 AND group_id=$2 LIMIT 1",
      [requestId,groupId],
    )).rows[0];
    if (!request || request.status !== "pending") return editOrSend(pool,groupId,message.message_id,actorId,"⛂ این درخواست دیگر در انتظار نیست.",keyboard([[back("link:menu")]]));
    const result = await telegramApi("declineChatJoinRequest",{chat_id:groupId,user_id:Number(request.user_id)});
    if (!result.ok) return editOrSend(pool,groupId,message.message_id,actorId,"⛂ رد درخواست انجام نشد.",keyboard([[back("link:requests:"+request.invite_link_id)]]));
    await pool.query("UPDATE invite_link_join_requests SET status='declined',processed_at=NOW(),processed_by=$1 WHERE id=$2",[actorId,requestId]);
    await event(pool,Number(request.invite_link_id),groupId,actorId,"join_request_declined",{user_id:Number(request.user_id)});
    return renderRequests(pool,groupId,message.message_id,actorId,Number(request.invite_link_id));
  }
  if (data.startsWith("link:request:approve_all:")) {
    const id = Number(data.split(":")[3] || 0);
    const result = await processAllRequests(pool,groupId,actorId,id,true);
    return editOrSend(pool,groupId,message.message_id,actorId,result.ok ? "⛂ تأیید درخواست‌ها انجام شد : "+result.count : "⛂ تأیید درخواست‌ها انجام نشد.",keyboard([[back("link:requests:"+id)]]));
  }
  if (data.startsWith("link:request:reject_all:")) {
    const id = Number(data.split(":")[3] || 0);
    const result = await processAllRequests(pool,groupId,actorId,id,false);
    return editOrSend(pool,groupId,message.message_id,actorId,result.ok ? "⛂ رد درخواست‌ها انجام شد : "+result.count : "⛂ رد درخواست‌ها انجام نشد.",keyboard([[back("link:requests:"+id)]]));
  }
  if (data.startsWith("link:noop")) return true;
  return false;
}

async function handleTextInput(pool: Pool, msg: InviteLinkMessage) {
  if (!msg.from || msg.chat.type === "private") return false;
  const groupId = Number(msg.chat.id);
  const userId = Number(msg.from.id);
  const flow = await getFlow(pool,userId,groupId);
  if (!flow) return false;
  if (flow.state === "create_limit_input") {
    const n = Number(String((msg as any).text || "").trim());
    if (!Number.isInteger(n) || n <= 0 || n > 99999) {
      await editOrSend(pool,groupId,flow.message_id,userId,"⛂ مقدار واردشده معتبر نیست.\nلطفاً عددی بین 1 تا 99999 وارد کنید.",keyboard([[back("link:create:limited")]]));
      return true;
    }
    await setFlow(pool,userId,groupId,"create_confirm",{type:"limited",member_limit:n},flow.message_id);
    await renderCreateConfirm(pool,groupId,flow.message_id || msg.message_id,userId,{type:"limited",member_limit:n});
    return true;
  }
  if (flow.state === "create_expire_input") {
    const raw = String((msg as any).text || "").trim();
    const match = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})\\s+(\\d{2}):(\\d{2})$/);
    if (!match) {
      await editOrSend(pool,groupId,flow.message_id,userId,"⛂ فرمت زمان معتبر نیست.\nقالب درست: YYYY-MM-DD HH:mm",keyboard([[back("link:create:temporary")]]));
      return true;
    }
    const date = new Date(raw.replace(" ","T")+":00+03:30");
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      await editOrSend(pool,groupId,flow.message_id,userId,"⛂ زمان باید معتبر و در آینده باشد.",keyboard([[back("link:create:temporary")]]));
      return true;
    }
    await setFlow(pool,userId,groupId,"create_confirm",{type:"temporary",expire_at:date.toISOString()},flow.message_id);
    await renderCreateConfirm(pool,groupId,flow.message_id || msg.message_id,userId,{type:"temporary",expire_at:date.toISOString()});
    return true;
  }
  return false;
}

async function recordJoinRequest(pool: Pool, req: any) {
  if (!req?.chat?.id || !req?.from?.id) return false;
  const groupId = Number(req.chat.id);
  const invite = req.invite_link?.invite_link;
  if (!invite) return false;
  await ensureInviteLinkSchema(pool);
  const row = await upsertTelegramLink(pool,groupId,req.invite_link);
  await pool.query(\`
    INSERT INTO invite_link_join_requests(group_id,invite_link_id,user_id,username,first_name,status,requested_at)
    VALUES($1,$2,$3,$4,$5,'pending',NOW())
    ON CONFLICT(invite_link_id,user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,status='pending',requested_at=NOW(),processed_at=NULL,processed_by=NULL
  \`,[groupId,row.id,Number(req.from.id),req.from.username||null,req.from.first_name||null]);
  await event(pool,row.id,groupId,Number(req.from.id),"join_request_created",{user_id:Number(req.from.id)});
  return true;
}

async function recordInviteUsage(pool: Pool, update: any) {
  const groupId = Number(update?.chat?.id || 0);
  const invite = update?.invite_link?.invite_link;
  const user = update?.new_chat_member?.user;
  if (!groupId || !invite || !user?.id) return false;
  await ensureInviteLinkSchema(pool);
  const row = await upsertTelegramLink(pool,groupId,update.invite_link);
  const oneTime = row.is_one_time === true;
  await pool.query("UPDATE group_invite_links SET usage_count=usage_count+1,is_consumed=CASE WHEN is_one_time AND usage_count+1>=1 THEN TRUE ELSE is_consumed END,consumed_at=CASE WHEN is_one_time AND usage_count+1>=1 THEN COALESCE(consumed_at,NOW()) ELSE consumed_at END,is_active=CASE WHEN member_limit IS NOT NULL AND usage_count+1>=member_limit THEN FALSE ELSE is_active END,updated_at=NOW() WHERE id=$1",[row.id]);
  await event(pool,row.id,groupId,Number(user.id),"used",{user_id:Number(user.id)});
  if (oneTime) await event(pool,row.id,groupId,Number(user.id),"consumed",{user_id:Number(user.id)});
  return true;
}

export async function openInviteLinkCenter(pool: Pool, groupId: number, actorId: number) {
  const permission = await canManageInviteLinks(groupId, actorId);
  if (!permission.allowed) return { ok: false, error: "permission" };
  return renderMain(pool,groupId,null,actorId);
}

export async function handleInviteLinkCallback(pool: Pool, cb: InviteLinkCallback) {
  return handleCallback(pool,cb);
}

export async function handleInviteLinkTextInput(pool: Pool, msg: InviteLinkMessage) {
  return handleTextInput(pool,msg);
}

export async function handleInviteLinkJoinRequest(pool: Pool, req: any) {
  return recordJoinRequest(pool,req);
}

export async function handleInviteLinkUsage(pool: Pool, update: any) {
  return recordInviteUsage(pool,update);
}

export { ensureInviteLinkSchema };
