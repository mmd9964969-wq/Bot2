import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "./defaults.ts";
import {
  handleCommand,
  normalizeToken,
  parseCommand,
  parseDuration,
  resolveCommand,
  type BotContext,
} from "./engine.ts";
import { rankAtLeast } from "./registry.ts";

describe("normalizeToken", () => {
  it("maps arabic yeh/kaf and persian digits", () => {
    assert.equal(normalizeToken("يك"), "یک");
    assert.equal(normalizeToken("بن۱۲"), "بن12");
    assert.equal(normalizeToken("HELP"), "help");
    assert.equal(normalizeToken("آن‌بن"), "انبن");
  });
});

describe("parseDuration", () => {
  it("reads latin and persian units", () => {
    assert.equal(parseDuration("10m"), 600);
    assert.equal(parseDuration("2h"), 7200);
    assert.equal(parseDuration("1d"), 86400);
    assert.equal(parseDuration("30دقیقه"), 1800);
    assert.equal(parseDuration("۲ساعت"), 7200);
    assert.equal(parseDuration("nope"), null);
  });
});

describe("resolveCommand", () => {
  it("matches fa and en aliases", () => {
    assert.equal(resolveCommand("ban")?.id, "ban");
    assert.equal(resolveCommand("بن")?.id, "ban");
    assert.equal(resolveCommand("مسدود")?.id, "ban");
    assert.equal(resolveCommand("سکوت")?.id, "mute");
    assert.equal(resolveCommand("میوت")?.id, "mute");
    assert.equal(resolveCommand("راهنما")?.id, "help");
    assert.equal(resolveCommand("هلپ")?.id, "help");
    assert.equal(resolveCommand("کیک")?.id, "kick");
    assert.equal(resolveCommand("اخراج")?.id, "kick");
    assert.equal(resolveCommand("اخطار")?.id, "warn");
  });
});

describe("parseCommand", () => {
  it("parses target duration reason", () => {
    const p = parseCommand("/بن @ali 1d اسپم تبلیغ", DEFAULT_CONFIG);
    assert.ok(p);
    assert.equal(p.command.id, "ban");
    assert.equal(p.target, "@ali");
    assert.equal(p.durationSec, 86400);
    assert.equal(p.reason, "اسپم تبلیغ");
  });
  it("accepts bang prefix and english", () => {
    const p = parseCommand("!mute 9001 10m flood", DEFAULT_CONFIG);
    assert.ok(p);
    assert.equal(p.command.id, "mute");
    assert.equal(p.target, "9001");
    assert.equal(p.durationSec, 600);
    assert.equal(p.reason, "flood");
  });
  it("rejects unprefixed text", () => {
    assert.equal(parseCommand("پینگ", DEFAULT_CONFIG), null);
    assert.equal(parseCommand("hello", DEFAULT_CONFIG), null);
  });
});

describe("rankAtLeast", () => {
  it("orders ranks", () => {
    assert.equal(rankAtLeast("admin", "member"), true);
    assert.equal(rankAtLeast("member", "admin"), false);
    assert.equal(rankAtLeast("owner", "admin"), true);
  });
});

function ctx(partial: Partial<BotContext> = {}): BotContext {
  return {
    text: "/ping",
    chatType: "supergroup",
    chatId: -100,
    chatTitle: "گروه آزمایش",
    membersCount: 42,
    userId: 1001,
    userName: "owner",
    userRank: "owner",
    lang: "fa",
    config: DEFAULT_CONFIG,
    now: Date.now(),
    staff: [
      { id: 1001, name: "owner", rank: "owner" },
      { id: 2002, name: "nima", rank: "admin" },
    ],
    ...partial,
  };
}

describe("handleCommand", () => {
  it("replies compact ping", () => {
    const r = handleCommand(ctx({ text: "/پینگ" }));
    assert.equal(r.silent, false);
    assert.equal(r.text, "پونگ");
  });
  it("stays silent on unknown in groups", () => {
    const r = handleCommand(ctx({ text: "/nope" }));
    assert.equal(r.silent, true);
  });
  it("stays silent on plain chat", () => {
    const r = handleCommand(ctx({ text: "سلام" }));
    assert.equal(r.silent, true);
  });
  it("gates later phases", () => {
    const r = handleCommand(ctx({ text: "/بن @ali اسپم" }));
    assert.match(r.text, /فاز ۲/);
  });
  it("blocks members from admin commands", () => {
    const r = handleCommand(ctx({ text: "/اطلاعات", userRank: "member" }));
    assert.match(r.text, /ادمین/);
  });
  it("switches language", () => {
    const r = handleCommand(ctx({ text: "/زبان en" }));
    assert.equal(r.lang, "en");
    assert.match(r.text, /English/);
  });
});
