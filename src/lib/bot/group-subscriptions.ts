import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";

export type SubscriptionStatus = "ACTIVE" | "EXPIRING" | "EXPIRED" | "LIFETIME" | "CANCELLED";
export type SubscriptionPlan = {
  key: "daily" | "monthly" | "2_months" | "3_months" | "6_months" | "lifetime";
  label: string;
  days: number | null;
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  { key: "daily", label: "1 روز", days: 1 },
  { key: "monthly", label: "1 ماه", days: 30 },
  { key: "2_months", label: "2 ماه", days: 60 },
  { key: "3_months", label: "3 ماه", days: 90 },
  { key: "6_months", label: "6 ماه", days: 180 },
  { key: "lifetime", label: "مادام‌العمر", days: null },
];

export type SubscriptionRow = {
  id: number;
  customer_id: number;
  group_id: number;
  group_title: string;
  group_username?: string | null;
  subscription_type: string;
  duration_days: number | null;
  started_at: Date | string;
  expires_at: Date | string | null;
  status: SubscriptionStatus;
  warning_sent: boolean;
  warning_message_id?: number | null;
  warning_sent_at?: Date | string | null;
  created_by: number;
  renewal_count: number;
  last_renewed_at?: Date | string | null;
  cancelled_at?: Date | string | null;
  cancellation_reason?: string | null;
};

export type ValidatedGroup = {
  id: number;
  title: string;
  username: string | null;
  type: string;
  botStatus: string;
  botCanDelete: boolean;
  botCanRestrict: boolean;
  customerStatus: string;
};

export async function resolveCustomer(pool: Pool, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const key = raw.replace(/^@/, "");
  const r = /^\d+$/.test(key)
    ? await pool.query("SELECT user_id,username,first_name,status FROM bot_customers WHERE user_id=$1 LIMIT 1", [key])
    : await pool.query("SELECT user_id,username,first_name,status FROM bot_customers WHERE LOWER(username)=LOWER($1) LIMIT 1", [key]);
  return r.rows[0] ?? null;
}

export function parsePublicGroupRef(value: unknown): string | number | null {
  const raw = String(value ?? "").trim();
  if (/^-100\d{5,20}$/.test(raw)) return Number(raw);
  if (/^@?[A-Za-z0-9_]{5,32}$/.test(raw)) return "@" + raw.replace(/^@/, "");
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!["t.me","telegram.me","www.t.me","www.telegram.me"].includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0];
  if (head === "joinchat" || head.startsWith("+")) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(head)) return null;
  return "@" + head;
}



export async function resolveGroup(pool: Pool, groupRef: unknown) {
  const parsed = parsePublicGroupRef(groupRef);
  if (parsed === null) return null;
  const chat = await telegramApi<any>("getChat", { chat_id: parsed });
  if (!chat.ok || !chat.result) return null;
  return {
    id: Number(chat.result.id),
    title: String(chat.result.title || ""),
    username: chat.result.username ? String(chat.result.username) : null,
    type: String(chat.result.type || ""),
  };
}

export async function validateGroup(
  pool: Pool,
  customerId: number,
  groupRef: unknown,
  options: { allowProvisionedOwner?: boolean } = {},
): Promise<{ ok: true; group: ValidatedGroup } | { ok: false; message: string }> {
  const parsed = parsePublicGroupRef(groupRef);
  if (parsed === null) {
    return { ok: false, message: "لینک گروه عمومی معتبر نیست. از لینک https://t.me/... استفاده کنید." };
  }

  const chat = await telegramApi<any>("getChat", { chat_id: parsed });
  if (!chat.ok || !chat.result) {
    return { ok: false, message: "گروه پیدا نشد یا ربات دسترسی دریافت اطلاعات گروه را ندارد." };
  }

  const type = String(chat.result.type || "");
  if (!["group","supergroup"].includes(type)) {
    return { ok: false, message: "لینک واردشده مربوط به گروه تلگرامی نیست." };
  }

  const me = await telegramApi<any>("getMe", {});
  if (!me.ok || !me.result?.id) {
    return { ok: false, message: "تشخیص شناسه ربات ناموفق بود." };
  }

  const botMember = await telegramApi<any>("getChatMember", {
    chat_id: chat.result.id,
    user_id: me.result.id,
  });
  if (!botMember.ok) {
    return { ok: false, message: "وضعیت حضور ربات در گروه قابل بررسی نیست." };
  }

  const botStatus = String(botMember.result?.status || "");
  const botCanDelete = botMember.result?.can_delete_messages === true;
  const botCanRestrict = botMember.result?.can_restrict_members === true;

  if (botStatus !== "administrator") return { ok: false, message: "ربات باید در گروه ادمین باشد." };
  if (!botCanDelete || !botCanRestrict) {
    return { ok: false, message: "ربات باید حداقل دسترسی حذف پیام و محدودکردن اعضا را داشته باشد." };
  }

  let customerStatus = "provisioned_owner";
  const customerMember = await telegramApi<any>("getChatMember", {
    chat_id: chat.result.id,
    user_id: customerId,
  });
  if (customerMember.ok) {
    customerStatus = String(customerMember.result?.status || "");
  }
  if (!["administrator","creator"].includes(customerStatus)) {
    if (!options.allowProvisionedOwner) {
      if (!customerMember.ok) return { ok: false, message: "مشتری در این گروه قابل شناسایی نیست." };
      return { ok: false, message: "مشتری باید در همین گروه ادمین یا مالک تلگرام باشد تا به‌عنوان مالک اشتراک ثبت شود." };
    }
    customerStatus = "provisioned_owner";
  }

  return {
    ok: true,
    group: {
      id: Number(chat.result.id),
      title: String(chat.result.title || ""),
      username: chat.result.username ? String(chat.result.username) : null,
      type,
      botStatus,
      botCanDelete,
      botCanRestrict,
      customerStatus,
    },
  };
}

export async function getActiveGroupSubscription(pool: Pool, customerId: number, groupId: number) {
  const r = await pool.query<SubscriptionRow>(
    "SELECT * FROM bot_group_subscriptions WHERE customer_id=$1 AND group_id=$2 AND status IN ('ACTIVE','EXPIRING','LIFETIME') AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY id DESC LIMIT 1",
    [customerId, groupId],
  );
  return r.rows[0] ?? null;
}

export async function getCurrentGroupSubscription(pool: Pool, groupId: number) {
  const r = await pool.query<SubscriptionRow>(
    "SELECT * FROM bot_group_subscriptions WHERE group_id=$1 AND status IN ('ACTIVE','EXPIRING','LIFETIME') ORDER BY id DESC LIMIT 1",
    [groupId],
  );
  return r.rows[0] ?? null;
}

export function statusForRow(row: SubscriptionRow | null): SubscriptionStatus | "NONE" {
  if (!row) return "NONE";
  if (row.status === "LIFETIME") return "LIFETIME";
  if (row.status === "CANCELLED" || row.status === "EXPIRED") return row.status;
  if (!row.expires_at) return "LIFETIME";
  return new Date(row.expires_at).getTime() - Date.now() <= 7 * 86400000 ? "EXPIRING" : "ACTIVE";
}

export function planLabel(value: string) {
  return SUBSCRIPTION_PLANS.find((x) => x.key === value)?.label ?? value;
}

export function subscriptionEnd(start: Date, days: number | null) {
  return days === null ? null : new Date(start.getTime() + days * 86400000);
}

export async function createGroupSubscription(
  pool: Pool,
  args: { customerId: number; group: ValidatedGroup; plan: SubscriptionPlan; createdBy: number },
) {
  const current = await getCurrentGroupSubscription(pool, args.group.id);
  if (current) return { ok: false as const, reason: "ACTIVE_EXISTS" as const, row: current };

  const started = new Date();
  const expires = subscriptionEnd(started, args.plan.days);
  const result = await pool.query<SubscriptionRow>(
    "INSERT INTO bot_group_subscriptions (customer_id,group_id,group_title,group_username,subscription_type,duration_days,started_at,expires_at,status,warning_sent,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE,$10) RETURNING *",
    [
      args.customerId,
      args.group.id,
      args.group.title,
      args.group.username,
      args.plan.key,
      args.plan.days,
      started,
      expires,
      args.plan.days === null ? "LIFETIME" : "ACTIVE",
      args.createdBy,
    ],
  );
  return { ok: true as const, row: result.rows[0] };
}

export async function renewGroupSubscription(
  pool: Pool,
  args: { groupId: number; customerId: number; plan: SubscriptionPlan },
) {
  const current = await getActiveGroupSubscription(pool, args.customerId, args.groupId);
  if (!current) return { ok: false as const, reason: "NOT_FOUND" as const };

  const now = new Date();
  const base = current.expires_at && new Date(current.expires_at).getTime() > now.getTime()
    ? new Date(current.expires_at)
    : now;
  const expires = subscriptionEnd(base, args.plan.days);

  const r = await pool.query<SubscriptionRow>(
    "UPDATE bot_group_subscriptions SET expires_at=$1,status=$2,duration_days=$3,subscription_type=$4,warning_sent=FALSE,warning_message_id=NULL,warning_sent_at=NULL,cancelled_at=NULL,cancellation_reason=NULL,renewal_count=renewal_count+1,last_renewed_at=NOW(),updated_at=NOW() WHERE id=$5 RETURNING *",
    [expires,args.plan.days === null ? "LIFETIME" : "ACTIVE",args.plan.days,args.plan.key,current.id],
  );

  if (current.warning_message_id) {
    await telegramApi("unpinChatMessage", { chat_id: args.groupId, message_id: Number(current.warning_message_id) }).catch(() => {});
    await telegramApi("deleteMessage", { chat_id: args.groupId, message_id: Number(current.warning_message_id) }).catch(() => {});
  }

  return { ok: true as const, row: r.rows[0] };
}

export async function cancelGroupSubscription(pool: Pool, subscriptionId: number, reason = "owner_cancelled") {
  const r = await pool.query<SubscriptionRow>(
    "UPDATE bot_group_subscriptions SET status='CANCELLED',cancelled_at=NOW(),cancellation_reason=$2,updated_at=NOW() WHERE id=$1 AND status IN ('ACTIVE','EXPIRING','LIFETIME') RETURNING *",
    [subscriptionId, reason],
  );
  if (!r.rowCount) return { ok: false as const, reason: "NOT_FOUND" as const };
  const row=r.rows[0];
  if(row.warning_message_id){
    await telegramApi("unpinChatMessage",{chat_id:row.group_id,message_id:Number(row.warning_message_id)}).catch(()=>{});
    await telegramApi("deleteMessage",{chat_id:row.group_id,message_id:Number(row.warning_message_id)}).catch(()=>{});
  }
  return { ok: true as const, row };
}

function displayDate(value: unknown) { const d=new Date(String(value??"")); if(Number.isNaN(d.getTime())) return "—"; return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Tehran"}).format(d); }

function warningText(row: SubscriptionRow) {
  const expiry = row.expires_at ? displayDate(row.expires_at) : "—";
  return [
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴜʙsᴄʀɪᴘᴛɪᴏɴ",
    "",
    "⛂ اطلاعیه اشتراک",
    "",
    "اشتراک این گروه تا 7 روز دیگر به پایان می‌رسد.",
    "",
    "⛂ تاریخ پایان : " + expiry,
    "",
    "برای ادامه استفاده از امکانات ربات،",
    "اشتراک گروه باید تمدید شود.",
  ].join("\n");
}

function expiredText(row: SubscriptionRow) {
  const expiry = row.expires_at ? new Date(row.expires_at).toISOString().slice(0,10) : "—";
  return [
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴜʙsᴄʀɪᴘᴛɪᴏɴ",
    "",
    "⛂ اشتراک این گروه به پایان رسیده است.",
    "",
    "تاریخ پایان : " + expiry,
    "",
    "برای استفاده مجدد از ربات،",
    "اشتراک گروه باید تمدید شود.",
  ].join("\n");
}

async function sendAndPin(pool: Pool, row: SubscriptionRow) {
  const message = await telegramApi<any>("sendMessage", { chat_id: row.group_id, text: warningText(row) });
  if (!message.ok) throw new Error(message.description || "subscription warning send failed");
  const messageId = Number(message.result?.message_id || 0);
  if (messageId > 0) {
    const pinned = await telegramApi<any>("pinChatMessage", {
      chat_id: row.group_id,
      message_id: messageId,
      disable_notification: true,
    });
    if (!pinned.ok) console.warn("[subscriptions] warning pin failed:", pinned.description);
  }
  await pool.query(
    "UPDATE bot_group_subscriptions SET warning_sent=TRUE,warning_message_id=$1,warning_sent_at=NOW(),updated_at=NOW() WHERE id=$2",
    [messageId || null,row.id],
  );
}

async function expireRow(pool: Pool, row: SubscriptionRow) {
  await pool.query(
    "UPDATE bot_group_subscriptions SET status='EXPIRED',updated_at=NOW() WHERE id=$1 AND status IN ('ACTIVE','EXPIRING')",
    [row.id],
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const current = await pool.query<SubscriptionRow>("SELECT * FROM bot_group_subscriptions WHERE id=$1 LIMIT 1", [row.id]);
  const latest = current.rows[0];
  if (!latest || latest.status === "CANCELLED" || latest.status === "LIFETIME" || (latest.expires_at && new Date(latest.expires_at).getTime() > Date.now())) return;

  try {
    const notice = await telegramApi<any>("sendMessage", { chat_id: latest.group_id, text: expiredText(expired) });
    if (!notice.ok) console.warn("[subscriptions] expiry notice failed:", notice.description);
  } catch (error) {
    console.warn("[subscriptions] expiry notice exception:", error);
  }

  await telegramApi("leaveChat", { chat_id: expired.group_id }).catch((error) => console.warn("[subscriptions] leaveChat exception:", error));
  await pool.query("UPDATE bot_customer_groups SET is_active=FALSE,last_seen_at=NOW() WHERE group_id=$1", [expired.group_id]).catch(() => {});
}

export async function sweepGroupSubscriptions(pool: Pool) {
  const rows = (await pool.query<SubscriptionRow>(
    "SELECT * FROM bot_group_subscriptions WHERE status IN ('ACTIVE','EXPIRING') AND expires_at IS NOT NULL ORDER BY expires_at LIMIT 100",
  )).rows;
  for (const row of rows) {
    const remaining = new Date(row.expires_at!).getTime() - Date.now();
    if (remaining <= 0) {
      await expireRow(pool,row).catch((error) => console.error("[subscriptions] expiry processing failed:",error));
      continue;
    }
    if (remaining <= 7 * 86400000) {
      if (row.status !== "EXPIRING") {
        await pool.query("UPDATE bot_group_subscriptions SET status='EXPIRING',updated_at=NOW() WHERE id=$1 AND status='ACTIVE'", [row.id]);
      }
      if (!row.warning_sent) {
        await sendAndPin(pool,row).catch((error) => console.error("[subscriptions] 7-day warning failed:",error));
      }
    }
  }
}
