import { json } from "@tanstack/react-start";
import { telegramApi } from "../../../../lib/telegram/api.ts";

export async function POST({ request }: { request: Request }) {
  try {
    const body = (await request.json()) as {
      method?: string;
      data?: Record<string, unknown>;
    };

    if (!body.method) {
      return json(
        {
          ok: false,
          error: "method is required",
        },
        { status: 400 },
      );
    }

    const result = await telegramApi(
      body.method,
      body.data ?? {},
    );

    return json(result);
  } catch (error) {
    console.error(error);

    return json(
      {
        ok: false,
        error: "Telegram API request failed",
      },
      { status: 500 },
    );
  }
}
