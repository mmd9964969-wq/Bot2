export type TelegramResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const TOKEN = process.env.BOT_TOKEN ?? "";

if (!TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const API = `https://api.telegram.org/bot${TOKEN}`;

export async function telegramApi<T = unknown>(
  method: string,
  body: Record<string, unknown> = {},
): Promise<TelegramResponse<T>> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return res.json() as Promise<TelegramResponse<T>>;
}
