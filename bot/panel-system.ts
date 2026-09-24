import os from "node:os";
import { promises as fs } from "node:fs";
import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";
import type { Rank } from "../src/lib/bot/registry.ts";

type TgUser={id:number;first_name?:string;username?:string};
type TgChat={id:number;type:string;title?:string;username?:string};
type TgMessage={message_id:number;chat:TgChat;from?:TgUser;text?:string;caption?:string;reply_to_message?:{from?:TgUser};photo?:unknown[];video?:unknown;audio?:unknown;document?:unknown;animation?:unknown;sticker?:unknown;voice?:unknown;video_note?:unknown;new_chat_members?:TgUser[];left_chat_member?:TgUser[]};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};
type PanelContext={pool:Pool;msg:TgMessage;userRank:Rank;isPrivate:boolean;ownerIds:string[]};

const BUILTIN_OWNER_IDS=["8247710529"];
const sessions=new Map<number,{flow:string;data:Record<string,any>;expires:number}>();
const throttles=new Map<number,number>();
const LICENSE_TYPES:{key:string;label:string;days:number|null}[]=[
  {key:"daily",label:"روزانه",days:1},{key:"monthly",label:"ماهانه",days:30},{key:"quarterly",label:"سه‌ماهه",days:90},
  {key:"halfyear",label:"شش‌ماهه",days:180},{key:"yearly",label:"یک‌ساله",days:365},{key:"lifetime",label:"مادام‌العمر",days:null}
];

const K={
  ownerMain:[[["⌁ آمار کلی سیستم","o:stats"],["♙ مدیریت مشتریان","o:customers"]],[["◇ مدیریت لایسنس‌ها","o:licenses"],["◉ لاگ‌های مهم","o:logs"]],[["✉ پیام همگانی","o:broadcast"],["⚙ تنظیمات پیشرفته","o:settings"]],[["▣ پشتیبان‌گیری و بازیابی","o:backup"],["◒ وضعیت سرور و منابع","o:server"]],[["⊘ لیست سیاه مشتریان","o:blacklist"],["× خروج از پنل مالک","o:exit"]]],
  customerMain:[[["⌂ وضعیت گروه فعلی","c:status"],["◇ تنظیمات قفل و فیلتر","c:locks"]],[["⚠ اخطار و جریمه","c:warnings"],["♙ مدیریت اعضا","c:members"]],[["⌁ خوش‌آمدگویی و خروج","c:welcome"],["⌘ دستورات و پاسخ‌ها","c:commands"]],[["▥ آمار و گزارش گروه","c:stats"],["◷ زمان‌بندی پیام‌ها","c:schedule"]],[["◇ تنظیمات امنیتی","c:security"],["? پشتیبانی و راهنما","c:support"]],[["× خروج از پنل","c:exit"]]]
};
function kb(rows:string[][][]){return {inline_keyboard:rows.map(row=>row.map(([text,callback_data])=>({text,callback_data}))) };}
function back(cb:string="home"){return [[["← بازگشت","p:"+cb]]];}
function menu(rows:string[][][],extra:string[][][]=[]){return kb([...rows,...extra]);}
function text(v:any){return String(v??"");}
function faDate(v:any){return new Date(v).toLocaleString("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});}
function session(uid:number,flow:string,data:Record<string,any>={}){sessions.set(uid,{flow,data,expires:Date.now()+10*60*1000});}
function getSession(uid:number){const s=sessions.get(uid);if(!s||s.expires<Date.now()){sessions.delete(uid);return null;}return s;}
function clearSession(uid:number){sessions.delete(uid);}
function allowed(uid:number){const now=Date.now(),last=throttles.get(uid)||0;if(now-last<800)return false;throttles.set(uid,now);return true;}
function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
async function answer(id:string){await telegramApi("answerCallbackQuery",{callback_query_id:id});}
async function send(chatId:number,message:string,markup:any=null){return telegramApi("sendMessage",{chat_id:chatId,text:message,reply_markup:markup});}
async function edit(chatId:number,messageId:number,message:string,markup:any=null){return telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,text:message,reply_markup:markup});}
async function audit(pool:Pool,actor:string,action:string,target:string,meta:any={}){await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'telegram_panel')",[actor,action,target,JSON.stringify(meta)]).catch(()=>{});}
async function ensureOwners(pool:Pool,ids:string[]){for(const id of ids){if(/^\d+$/.test(id))await pool.query("INSERT INTO bot_panel_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING",[id]);}}
async function isOwner(pool:Pool,uid:number,envOwners:string[]){const all=new Set([...BUILTIN_OWNER_IDS,...envOwners]);if(all.has(String(uid)))return true;const r=await pool.query("SELECT 1 FROM bot_panel_owners WHERE user_id=$1 LIMIT 1",[uid]);return !!r.rowCount;}
async function customerEnsure(pool:Pool,uid:number,u:TgUser){await pool.query("INSERT INTO bot_customers(user_id,username,first_name,last_active_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_active_at=NOW()",[uid,u.username||null,u.first_name||""]);}

async function validLicense(pool:Pool,uid:number){
  const r=await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY expires_at NULLS LAST, id DESC LIMIT 1",[uid]);
  return r.rows[0]||null;
}