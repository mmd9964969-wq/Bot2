export type GameEmojiKey =
  | "world"
  | "player"
  | "money"
  | "work"
  | "market"
  | "home"
  | "law"
  | "npc"
  | "story"
  | "travel"
  | "resource"
  | "success";

const ENV_BY_KEY: Record<GameEmojiKey, string> = {
  world: "GAME_EMOJI_WORLD",
  player: "GAME_EMOJI_PLAYER",
  money: "GAME_EMOJI_MONEY",
  work: "GAME_EMOJI_WORK",
  market: "GAME_EMOJI_MARKET",
  home: "GAME_EMOJI_HOME",
  law: "GAME_EMOJI_LAW",
  npc: "GAME_EMOJI_NPC",
  story: "GAME_EMOJI_STORY",
  travel: "GAME_EMOJI_TRAVEL",
  resource: "GAME_EMOJI_RESOURCE",
  success: "GAME_EMOJI_SUCCESS",
};

const FALLBACK_BY_KEY: Record<GameEmojiKey, string> = {
  world: "◈",
  player: "⛂",
  money: "⛂",
  work: "⛂",
  market: "⛂",
  home: "⛂",
  law: "⛂",
  npc: "⛂",
  story: "⛂",
  travel: "→",
  resource: "⛂",
  success: "✓",
};

export function gameEmoji(key: GameEmojiKey, fallback = FALLBACK_BY_KEY[key]): string {
  const id = String(process.env[ENV_BY_KEY[key]] ?? "").trim();
  if (!id) return fallback;
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

export function gameEmojiIds(): Record<GameEmojiKey, string> {
  return Object.fromEntries(
    Object.entries(ENV_BY_KEY).map(([key, env]) => [key, String(process.env[env] ?? "").trim()]),
  ) as Record<GameEmojiKey, string>;
}
