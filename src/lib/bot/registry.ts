export type Rank = "owner" | "sudo" | "admin" | "member";
export type Lang = "fa" | "en";
export type Phase = 1 | 2;

export type CommandDef = {
  id: string;
  phase: Phase;
  minRank: Rank;
  aliasesEn: string[];
  aliasesFa: string[];
  usageEn: string;
  usageFa: string;
  descEn: string;
  descFa: string;
};

const defs: CommandDef[] = [
  { id:"robot", phase:1, minRank:"member", aliasesEn:["robot"], aliasesFa:["ربات"], usageEn:"robot", usageFa:"ربات", descEn:"Robot response", descFa:"پاسخ ربات" },
  { id:"id", phase:1, minRank:"member", aliasesEn:["id"], aliasesFa:["آیدی"], usageEn:"id", usageFa:"آیدی", descEn:"User identity", descFa:"اطلاعات هویتی کاربر" },
  { id:"admin", phase:1, minRank:"member", aliasesEn:["admin"], aliasesFa:["ادمین"], usageEn:"admin", usageFa:"ادمین", descEn:"Check admin access", descFa:"بررسی دسترسی ادمین" },
  { id:"info", phase:1, minRank:"member", aliasesEn:["info"], aliasesFa:["اطلاعات"], usageEn:"info", usageFa:"اطلاعات", descEn:"Group information", descFa:"اطلاعات گروه" },
  { id:"rank", phase:1, minRank:"member", aliasesEn:["rank"], aliasesFa:["مقام","اطلاعات مقام"], usageEn:"rank", usageFa:"مقام", descEn:"Show user rank", descFa:"نمایش مقام کاربر" },
  { id:"me", phase:1, minRank:"member", aliasesEn:["me"], aliasesFa:["من"], usageEn:"me", usageFa:"من", descEn:"Show personal profile", descFa:"نمایش پروفایل شخصی" },
  { id:"ping", phase:2, minRank:"member", aliasesEn:["ping"], aliasesFa:["پینگ"], usageEn:"ping", usageFa:"پینگ", descEn:"System status", descFa:"وضعیت سیستم" },
  { id:"bot", phase:2, minRank:"member", aliasesEn:["bot"], aliasesFa:["بات"], usageEn:"bot", usageFa:"بات", descEn:"Technical bot information", descFa:"اطلاعات فنی ربات" },
  { id:"status", phase:2, minRank:"member", aliasesEn:["status"], aliasesFa:["وضعیت"], usageEn:"status", usageFa:"وضعیت", descEn:"Group status", descFa:"وضعیت گروه" },
];

export const COMMANDS = defs;

export const PHASES = [
  { id:1 as Phase, fa:"هسته و اطلاعات", en:"Core & information", blurbFa:"ربات، آیدی، ادمین، اطلاعات گروه، مقام و پروفایل شخصی", blurbEn:"Robot, identity, admin access, group info, rank and personal profile" },
  { id:2 as Phase, fa:"وضعیت و سیستم", en:"Status & system", blurbFa:"پینگ، وضعیت گروه و اطلاعات فنی ربات", blurbEn:"Ping, group status and technical bot information" },
];

export const RANK_ORDER: Rank[] = ["member","admin","sudo","owner"];

export function rankAtLeast(have: Rank, need: Rank): boolean {
  return RANK_ORDER.indexOf(have) >= RANK_ORDER.indexOf(need);
}

export function normalizeToken(value:string){
  return value.trim().replace(/^[/!.]+/,"").replace(/\\s+/g,"").toLowerCase();
}

export function parseDuration(value:string):number|null{
  const m=value.trim().toLowerCase().match(/^(\\d+)(s|m|h|d)?$/);
  if(!m)return null;
  const n=Number(m[1]); const unit=m[2]??"s";
  const mult=unit==="m"?60:unit==="h"?3600:unit==="d"?86400:1;
  return Number.isFinite(n)&&n>0?n*mult:null;
}

export function resolveCommand(token:string):CommandDef|null{
  const key=normalizeToken(token);
  return COMMANDS.find(c=>[...c.aliasesEn,...c.aliasesFa].some(a=>normalizeToken(a)===key))??null;
}
