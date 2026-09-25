import type { Pool } from "pg";
import type { BotContext } from "./engine.ts";
import { normalizeToken } from "./registry.ts";
import { telegramApi } from "../telegram/api.ts";

const ALL_SEND_PERMISSIONS = {
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
};

const MUTED_PERMISSIONS = {
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

export async function ensureModerationSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      actor_id BIGINT NOT NULL,
      target_id BIGINT NOT NULL,
      action_type TEXT NOT NULL,
      duration_seconds INTEGER,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_moderation_actions_group_created ON moderation_actions(group_id,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions(group_id,target_id,created_at DESC)");
}

function parseDurationToken(raw: string): number | null {
  const token = normalizeToken(raw).replace(/\\s+/g, "");
  const match = token.match(/^(\\d+)(s|sec|ثانیه|m|min|دقیقه|h|hr|ساعت|d|day|روز|w|week|هفته)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const unit = match[2];
  const factor = ["s", "sec", "ثانیه"].includes(unit)
    ? 1
    : ["m", "min", "دقیقه"].includes(unit)
      ? 60
      : ["h", "hr", "ساعت"].includes(unit)
        ? 3600
        : ["d", "day", "روز"].includes(unit)
          ? 86400
          : 604800;
  return amount * factor;
}

function targetToken(args: string[]) {
  return normalizeToken(String(args[0] ?? ""));
}

async function resolveTarget(pool: Pool, ctx: BotContext, args: string[]) {
  if (ctx.replyToUserId) return ctx.replyToUserId;
  const raw = targetToken(args);
  if (/^\\d+$/.test(raw)) {
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  if (/^@[a-z0-9_]{3,}$/i.test(String(args[0] ?? ""))) {
    const username = raw.replace(/^@/, "");
    const found = await pool.query(
      "SELECT user_id FROM warning_cases WHERE group_id=$1 AND LOWER(username)=LOWER($2) LIMIT 1",
      [ctx.chatId, username],
    ).catch(() => ({ rows: [] as { user_id: number }[] }));
    return found.rows[0]?.user_id ? Number(found.rows[0].user_id) : null;
  }
  return null;
}

async function targetState(ctx: BotContext, targetId: number) {
  const member = await telegramApi<any>("getChatMember", {
    chat_id: ctx.chatId,
    user_id: targetId,
  });
  if (!member.ok) {
    return { ok: false, error: member.description || "کاربر در گروه پیدا نشد." };
  }
  const status = String(member.result?.status ?? "");
  const protectedTarget = ["creator", "administrator"].includes(status);
  return { ok: true, status, protectedTarget };
}

async function logAction(
  pool: Pool,
  ctx: BotContext,
  targetId: number,
  actionType: string,
  durationSeconds: number | null,
  reason: string,
  status = "success",
) {
  await pool.query(
    "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [ctx.chatId, ctx.userId, targetId, actionType, durationSeconds, reason, status],
  ).catch(() => {});
}

async function issueWarning(pool: Pool, ctx: BotContext, args: string[]) {
  const targetId = await resolveTarget(pool, ctx, args);
  if (!targetId) {
    return "✗ هدف مشخص نیست. روی پیام کاربر ریپلای کنید یا آیدی عددی او را بعد از دستور بنویسید.";
  }
  if (targetId === ctx.userId) return "✗ صدور اخطار برای خودتان مجاز نیست.";

  const state = await targetState(ctx, targetId);
  if (!state.ok) return "✗ " + state.error;
  if (state.protectedTarget) return "✗ این کاربر مدیر/مالک گروه است و قابل اخطار نیست.";

  const targetIndex = ctx.replyToUserId ? 0 : 1;
  const reason = args.slice(targetIndex).join(" ").trim() || "تخلف از قوانین گروه";
  const port = String(process.env.PORT || "8080");
  const response = await fetch("http://127.0.0.1:" + port + "/api/warnings/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      group_id: ctx.chatId,
      user_id: targetId,
      violation_type: "manual",
      custom_violation: reason,
      admin_id: String(ctx.userId),
      admin_name: ctx.userName,
    }),
  }).catch(() => null);

  if (!response) {
    await logAction(pool, ctx, targetId, "warn", null, reason, "failed");
    return "✗ موتور اخطار در دسترس نیست.";
  }

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    await logAction(pool, ctx, targetId, "warn", null, reason, "failed");
    return "✗ ثبت اخطار ناموفق بود: " + String(payload?.error || payload?.message || "خطای موتور اخطار");
  }

  await logAction(pool, ctx, targetId, "warn", null, reason);
  return "✓ اخطار ثبت شد.\\n⛂ - کاربر : " + targetId + "\\n⛂ - دلیل : " + reason;
}

async function muteUser(pool: Pool, ctx: BotContext, args: string[], permanent: boolean) {
  const targetId = await resolveTarget(pool, ctx, args);
  if (!targetId) return "✗ هدف مشخص نیست. روی پیام کاربر ریپلای کنید یا آیدی عددی او را بنویسید.";
  if (targetId === ctx.userId) return "✗ سکوت‌کردن خودتان مجاز نیست.";

  const state = await targetState(ctx, targetId);
  if (!state.ok) return "✗ " + state.error;
  if (state.protectedTarget) return "✗ این کاربر مدیر/مالک گروه است و قابل سکوت نیست.";

  const durationArg = ctx.replyToUserId ? args[0] : args[1];
  const duration = permanent || !durationArg ? null : parseDurationToken(durationArg);
  if (!permanent && durationArg && !duration) {
    return "✗ مدت نامعتبر است. نمونه: 30m ، 2h ، 1d";
  }

  const body: Record<string, unknown> = {
    chat_id: ctx.chatId,
    user_id: targetId,
    permissions: MUTED_PERMISSIONS,
    use_independent_chat_permissions: true,
  };
  if (duration) {
    body.until_date = Math.floor(Date.now() / 1000) + Math.max(30, duration);
  }

  const result = await telegramApi("restrictChatMember", body);
  if (!result.ok) {
    await logAction(pool, ctx, targetId, "mute", duration, "سکوت دستی", "failed");
    return "✗ سکوت ناموفق بود: " + String(result.description || "Telegram error");
  }

  await logAction(pool, ctx, targetId, "mute", duration, permanent ? "سکوت دائمی" : "سکوت موقت");
  return "✓ " + (permanent ? "سکوت دائمی" : "سکوت اجرا شد.") + "\\n⛂ - کاربر : " + targetId +
    (duration ? "\\n⛂ - مدت : " + durationLabel(duration) : "");
}

async function unmuteUser(pool: Pool, ctx: BotContext, args: string[]) {
  const targetId = await resolveTarget(pool, ctx, args);
  if (!targetId) return "✗ هدف مشخص نیست. روی پیام کاربر ریپلای کنید یا آیدی عددی او را بنویسید.";
  const result = await telegramApi("restrictChatMember", {
    chat_id: ctx.chatId,
    user_id: targetId,
    permissions: ALL_SEND_PERMISSIONS,
    use_independent_chat_permissions: true,
  });
  if (!result.ok) {
    await logAction(pool, ctx, targetId, "unmute", null, "رفع سکوت", "failed");
    return "✗ رفع سکوت ناموفق بود: " + String(result.description || "Telegram error");
  }
  await logAction(pool, ctx, targetId, "unmute", null, "رفع سکوت");
  return "✓ سکوت کاربر رفع شد.\\n⛂ - کاربر : " + targetId;
}

async function banUser(pool: Pool, ctx: BotContext, args: string[]) {
  const targetId = await resolveTarget(pool, ctx, args);
  if (!targetId) return "✗ هدف مشخص نیست. روی پیام کاربر ریپلای کنید یا آیدی عددی او را بنویسید.";
  if (targetId === ctx.userId) return "✗ بن‌کردن خودتان مجاز نیست.";

  const state = await targetState(ctx, targetId);
  if (!state.ok) return "✗ " + state.error;
  if (state.protectedTarget) return "✗ این کاربر مدیر/مالک گروه است و قابل بن نیست.";

  const durationArg = ctx.replyToUserId ? args[0] : args[1];
  const duration = durationArg ? parseDurationToken(durationArg) : null;
  if (durationArg && !duration) return "✗ مدت نامعتبر است. نمونه: 30m ، 2h ، 7d";
  const body: Record<string, unknown> = {
    chat_id: ctx.chatId,
    user_id: targetId,
    revoke_messages: true,
  };
  if (duration) body.until_date = Math.floor(Date.now() / 1000) + Math.max(30, duration);

  const result = await telegramApi("banChatMember", body);
  if (!result.ok) {
    await logAction(pool, ctx, targetId, "ban", duration, "بن دستی", "failed");
    return "✗ بن ناموفق بود: " + String(result.description || "Telegram error");
  }
  await logAction(pool, ctx, targetId, "ban", duration, duration ? "بن موقت" : "بن دائمی");
  return "✓ " + (duration ? "بن موقت اجرا شد." : "بن دائمی اجرا شد.") + "\\n⛂ - کاربر : " + targetId +
    (duration ? "\\n⛂ - مدت : " + durationLabel(duration) : "");
}

async function unbanUser(pool: Pool, ctx: BotContext, args: string[]) {
  const targetId = await resolveTarget(pool, ctx, args);
  if (!targetId) return "✗ هدف مشخص نیست. آیدی عددی کاربر یا ریپلای به پیام او لازم است.";
  const result = await telegramApi("unbanChatMember", {
    chat_id: ctx.chatId,
    user_id: targetId,
    only_if_banned: true,
  });
  if (!result.ok) {
    await logAction(pool, ctx, targetId, "unban", null, "رفع بن", "failed");
    return "✗ رفع بن ناموفق بود: " + String(result.description || "Telegram error");
  }
  await logAction(pool, ctx, targetId, "unban", null, "رفع بن");
  return "✓ بن کاربر رفع شد.\\n⛂ - کاربر : " + targetId;
}

function durationLabel(seconds: number) {
  if (seconds % 604800 === 0) return Math.floor(seconds / 604800) + " هفته";
  if (seconds % 86400 === 0) return Math.floor(seconds / 86400) + " روز";
  if (seconds % 3600 === 0) return Math.floor(seconds / 3600) + " ساعت";
  if (seconds % 60 === 0) return Math.floor(seconds / 60) + " دقیقه";
  return seconds + " ثانیه";
}

export async function runModerationCommand(pool: Pool, ctx: BotContext, commandId: string, args: string[]) {
  if (ctx.chatType === "private") {
    return ctx.lang === "fa" ? "✗ این دستور فقط داخل گروه قابل اجراست." : "✗ This command works in groups only.";
  }
  if (commandId === "warn") return issueWarning(pool, ctx, args);
  if (commandId === "mute") return muteUser(pool, ctx, args, false);
  if (commandId === "perm_mute") return muteUser(pool, ctx, args, true);
  if (commandId === "unmute") return unmuteUser(pool, ctx, args);
  if (commandId === "ban") return banUser(pool, ctx, args);
  if (commandId === "unban") return unbanUser(pool, ctx, args);
  return null;
}
