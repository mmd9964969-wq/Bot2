import { getSql } from "../db.ts";

export type TelegramAccount = {
  id: string;
  userId: string;
  telegramUserId: number;
  username: string | null;
};

export async function linkTelegramAccount(
  token: string,
  telegramUserId: number,
  username?: string,
): Promise<
  | {
      ok: true;
      account: TelegramAccount;
    }
  | {
      ok: false;
      reason: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "ALREADY_USED";
    }
> {
  const sql = await getSql();

  const rows = await sql<{
    id: string;
    user_id: string;
    token: string;
    telegram_user_id: number | null;
    expires_at: string;
    used_at: string | null;
  }>`
    select
      id,
      user_id,
      token,
      telegram_user_id,
      expires_at,
      used_at
    from telegram_link_tokens
    where token = ${token}
    limit 1
  `;

  const link = rows[0];

  if (!link) {
    return {
      ok: false,
      reason: "INVALID_TOKEN",
    };
  }

  if (link.used_at) {
    return {
      ok: false,
      reason: "ALREADY_USED",
    };
  }

  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      reason: "EXPIRED_TOKEN",
    };
  }

  const accountId = crypto.randomUUID();

  await sql`
    insert into telegram_accounts (
      id,
      user_id,
      telegram_user_id,
      username
    )
    values (
      ${accountId},
      ${link.user_id},
      ${telegramUserId},
      ${username ?? null}
    )
    on conflict (user_id)
    do update set
      telegram_user_id = excluded.telegram_user_id,
      username = excluded.username,
      updated_at = current_timestamp
  `;

  await sql`
    update telegram_link_tokens
    set
      telegram_user_id = ${telegramUserId},
      used_at = current_timestamp
    where id = ${link.id}
  `;

  return {
    ok: true,
    account: {
      id: accountId,
      userId: link.user_id,
      telegramUserId,
      username: username ?? null,
    },
  };
}
