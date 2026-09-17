export type PanelAction = {
  method: string;
  data?: Record<string, unknown>;
};

export async function runPanelAction(action: PanelAction) {
  const res = await fetch("/api/bot/action", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(action),
  });

  const result = (await res.json()) as {
    ok?: boolean;
    result?: unknown;
    description?: string;
    error?: string;
  };

  if (!res.ok || result.ok === false) {
    throw new Error(
      result.description ??
        result.error ??
        "Telegram action failed",
    );
  }

  return result;
}
