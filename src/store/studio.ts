import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CONFIG, type BotConfig } from "@/lib/bot/defaults";
import type { AliasOverrides, BotContext } from "@/lib/bot/engine";
import { handleCommand } from "@/lib/bot/engine";
import type { Lang, Rank } from "@/lib/bot/registry";

export type ViewId = "overview" | "config" | "commands" | "sim" | "deploy";

export type SimMessage = {
  id: string;
  from: "user" | "bot" | "system";
  name: string;
  text: string;
  ts: number;
};

export type StudioState = {
  uiLang: Lang;
  view: ViewId;
  config: BotConfig;
  aliasOverrides: AliasOverrides;
  simMode: "group" | "private";
  simRank: Rank;
  simLang: Lang;
  messages: SimMessage[];
  setUiLang: (lang: Lang) => void;
  setView: (view: ViewId) => void;
  patchConfig: (patch: Partial<BotConfig>) => void;
  setAliases: (id: string, side: "en" | "fa", aliases: string[]) => void;
  setSimMode: (mode: "group" | "private") => void;
  setSimRank: (rank: Rank) => void;
  sendSim: (text: string) => void;
  resetSim: () => void;
  resetAll: () => void;
};

const STAFF: BotContext["staff"] = [
  { id: 1001, name: "you", rank: "owner" },
  { id: 2002, name: "nima", rank: "admin" },
];

function nid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      uiLang: "fa",
      view: "overview",
      config: DEFAULT_CONFIG,
      aliasOverrides: {},
      simMode: "group",
      simRank: "owner",
      simLang: "fa",
      messages: [
        {
          id: "w1",
          from: "system",
          name: "",
          text: "گروه آزمایش · دستور فارسی یا انگلیسی بفرست",
          ts: Date.now(),
        },
      ],
      setUiLang: (uiLang) => set({ uiLang }),
      setView: (view) => set({ view }),
      patchConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      setAliases: (id, side, aliases) =>
        set((s) => {
          const prev = s.aliasOverrides[id] ?? {};
          return {
            aliasOverrides: {
              ...s.aliasOverrides,
              [id]: { ...prev, [side]: aliases },
            },
          };
        }),
      setSimMode: (simMode) => set({ simMode }),
      setSimRank: (simRank) => set({ simRank }),
      sendSim: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const s = get();
        const userMsg: SimMessage = {
          id: nid(),
          from: "user",
          name: s.simRank === "owner" ? "you" : s.simRank,
          text: trimmed,
          ts: Date.now(),
        };
        const ctx: BotContext = {
          text: trimmed,
          chatType: s.simMode === "private" ? "private" : "supergroup",
          chatId: s.simMode === "private" ? s.config.ownerIds[0] ? Number(s.config.ownerIds[0]) || 1001 : 1001 : -100123456,
          chatTitle: "گروه آزمایش",
          membersCount: 128,
          userId: 1001,
          userName: "you",
          userRank: s.simRank,
          lang: s.simLang,
          config: s.config,
          now: Date.now(),
          staff: STAFF,
        };
        const reply = handleCommand(ctx, s.aliasOverrides);
        const next: SimMessage[] = [...s.messages, userMsg];
        const patch: Partial<StudioState> = {};
        if (reply.lang) patch.simLang = reply.lang;
        if (!reply.silent && reply.text) {
          next.push({
            id: nid(),
            from: "bot",
            name: s.config.botName,
            text: reply.text,
            ts: Date.now() + 1,
          });
        } else if (reply.silent) {
          next.push({
            id: nid(),
            from: "system",
            name: "",
            text: s.uiLang === "fa" ? "بدون پاسخ · دستور ناشناس در گروه" : "silent · unknown in group",
            ts: Date.now() + 1,
          });
        }
        set({ messages: next.slice(-80), ...patch });
      },
      resetSim: () =>
        set({
          messages: [
            {
              id: nid(),
              from: "system",
              name: "",
              text: "شبیه‌ساز ریست شد",
              ts: Date.now(),
            },
          ],
        }),
      resetAll: () =>
        set({
          config: DEFAULT_CONFIG,
          aliasOverrides: {},
          simLang: DEFAULT_CONFIG.defaultLang,
        }),
    }),
    { name: "nizam-studio", skipHydration: true, partialize: (s) => ({
      uiLang: s.uiLang,
      config: s.config,
      aliasOverrides: s.aliasOverrides,
      simMode: s.simMode,
      simRank: s.simRank,
      simLang: s.simLang,
    }) },
  ),
);
