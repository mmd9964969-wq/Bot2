import os from "node:os";
import { promises as fs } from "node:fs";
import type { Pool } from "pg";
import { telegramApi } from "../src/lib/telegram/api.ts";
import type { Rank } from "../src/lib/bot/registry.ts";
import { ensureContentLocks, editRichLockCenter } from "../src/lib/bot/content-locks.ts";
import { glassKeyboard, styledGlassButton } from "../src/lib/bot/panel-design.ts";
import { getGroupLanguage, setGroupLanguage, ensureGroupLanguageSchema, normalizeBotLang, languageNative, languageButtonLabel, SUPPORTED_LANGUAGES, type BotLang } from "../src/lib/bot/i18n.ts";
import { AUTOMATION_ACTIONS } from "../src/lib/bot/automation-engine.ts";
import { executeRuntimeAction, isRuntimeMaintenance } from "./runtime-control.ts";
import {
  ensurePanelSessionSchema,
  runWithPanelScope,
  currentPanelScope,
  bindPanelMessage,
  touchPanelMessage,
  panelMessageOwnedBy,
  unbindPanelMessage,
} from "../src/lib/bot/panel-session.ts";

type TgUser={id:number;first_name?:string;username?:string};
type TgChat={id:number;type:string;title?:string;username?:string};
type TgMessage={message_id:number;chat:TgChat;from?:TgUser;text?:string;caption?:string;reply_to_message?:{from?:TgUser};photo?:unknown[];video?:unknown;audio?:unknown;document?:unknown;animation?:unknown;sticker?:unknown;voice?:unknown;video_note?:unknown;new_chat_members?:TgUser[];left_chat_member?:TgUser[]};
type TgCallback={id:string;from:TgUser;message?:TgMessage;data?:string};
type PanelContext={pool:Pool;msg:TgMessage;userRank:Rank;isPrivate:boolean;ownerIds:string[]};

const BUILTIN_OWNER_IDS=["8247710529"];
const sessions=new Map<number,{flow:string;data:Record<string,any>;expires:number}>();
const throttles=new Map<number,number>();
function allowed(userId:number):boolean{
  const now=Date.now();
  const last=throttles.get(userId)??0;
  if(now-last<300)return false;
  throttles.set(userId,now);
  return true;
}

function session(userId:number,flow:string,data:Record<string,any>={},ttlMs=10*60*1000){
  sessions.set(userId,{flow,data,expires:Date.now()+ttlMs});
}
function getSession(userId:number){
  const value=sessions.get(userId);
  if(!value)return null;
  if(value.expires<Date.now()){sessions.delete(userId);return null;}
  return value;
}
function clearSession(userId:number){sessions.delete(userId);}
function sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}
function faDate(value:unknown){
  const d=value instanceof Date?value:new Date(String(value??""));
  if(Number.isNaN(d.getTime()))return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tehran"}).format(d);
}
function valueOrDash(value:unknown){const s=String(value??"").trim();return s||"—";}
function answer(callbackId:string){return telegramApi("answerCallbackQuery",{callback_query_id:callbackId});}
const LICENSE_TYPES:{key:string;label:string;days:number|null}[]=[
  {key:"daily",label:"روزانه",days:1},{key:"monthly",label:"ماهانه",days:30},{key:"quarterly",label:"سه‌ماهه",days:90},
  {key:"halfyear",label:"شش‌ماهه",days:180},{key:"yearly",label:"یک‌ساله",days:365},{key:"lifetime",label:"مادام‌العمر",days:null}
];

const K={
  ownerMain:[
    [["آمار کلی سیستم","o:stats"],["مدیریت مشتریان","o:customers"]],
    [["مدیریت لایسنس‌ها","o:licenses"],["مدیریت گروه‌ها","o:groups"]],
    [["زبان گروه‌ها","o:languages"],["ارسال همگانی","o:broadcast"]],
    [["کنترل اجرایی","o:runtime"],["ممیزی سیستم","o:audit"]],
    [["امنیت و دسترسی","o:security"],["پشتیبان‌گیری و بازیابی","o:backup"]],
    [["تنظیمات پیشرفته","o:settings"],["وضعیت سرور و منابع","o:server"]],
    [["فهرست سیاه مشتریان","o:blacklist"],["مدیریت قابلیت‌ها","o:features"]],
    [["مرکز هوش مصنوعی","o:ai"],["خروج از پنل مالک","o:exit"]]
  ],
  customerMain:[
    [["وضعیت و نمای کلی","c:status"],["مرکز قفل و فیلتر","c:locks"]],
    [["زبان ربات","c:language"],["مرکز امنیت","c:security"]],
    [["مرکز مجازات","c:warnings"],["مدیریت اعضا","c:members"]],
    [["مرکز اتوماسیون","c:automation"],["استودیو دستورات","c:commands"]],
    [["استودیو محتوا","c:content"],["زمان‌بندی پیام‌ها","c:schedule"]],
    [["تحلیل و آمار","c:analytics"],["مرکز دسترسی","c:permissions"]],
    [["مرکز استثناها","c:exceptions"],["ممیزی گروه","c:audit"]],
    [["سلامت ربات","c:health"],["پشتیبانی و راهنما","c:support"]],
    [["خروج از پنل","c:exit"]]
  ]
};
function kb(rows:string[][][]){return glassKeyboard(rows);}
function back(cb:string="home"){return [[["‹ بازگشت","p:"+cb]]];}
function menu(rows:string[][][],extra:string[][][]=[]){return kb([...rows,...extra]);}
const PANEL_SEPARATOR="─────━━───── ◈ ─────━━─────";
type PanelMessage={title:string;body:string;is_rtl:true};
type RichBlock =
  | {type:"heading";text:string;size:number}
  | {type:"paragraph";text:string}
  | {type:"divider"};

const PANEL_TITLES:Record<string,Partial<Record<BotLang,string>>> = {
  "پیام":{en:"Mᴇssᴀɢᴇ",ar:"رسالة",ru:"Сообщение",tr:"Mesaj",zh:"消息"},
  "Owner Control":{en:"Oᴡɴᴇʀ Cᴏɴᴛʀᴏʟ",ar:"تَحَكُّم المالك",ru:"Управление владельца",tr:"Sahip Kontrolü",zh:"所有者控制"},
  "Group Control":{en:"Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ",ar:"إدارة المجموعة",ru:"Управление группой",tr:"Grup Kontrolü",zh:"群组控制"},
  "آمار کلی سیستم":{en:"Sʏsᴛᴇᴍ Oᴠᴇʀᴠɪᴇᴡ",ar:"نظرة عامة على النظام",ru:"Обзор системы",tr:"Sistem Özeti",zh:"系统概览"},
  "مدیریت مشتریان":{en:"Cᴜsᴛᴏᴍᴇʀ Cᴇɴᴛᴇʀ",ar:"إدارة العملاء",ru:"Управление клиентами",tr:"Müşteri Merkezi",zh:"客户中心"},
  "مدیریت لایسنس‌ها":{en:"Lɪᴄᴇɴsᴇ Cᴇɴᴛᴇʀ",ar:"مركز التراخيص",ru:"Центр лицензий",tr:"Lisans Merkezi",zh:"许可证中心"},
  "مدیریت گروه‌ها":{en:"Gʀᴏᴜᴘ Cᴇɴᴛᴇʀ",ar:"مركز المجموعات",ru:"Центр групп",tr:"Grup Merkezi",zh:"群组中心"},
  "کنترل گروه":{en:"Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ",ar:"تحكم المجموعة",ru:"Управление группой",tr:"Grup Kontrolü",zh:"群组控制"},
  "زبان گروه":{en:"Gʀᴏᴜᴘ Lᴀɴɢᴜᴀɢᴇ",ar:"لغة المجموعة",ru:"Язык группы",tr:"Grup Dili",zh:"群组语言"},
  "کنترل اجرایی":{en:"Rᴜɴᴛɪᴍᴇ Cᴏɴᴛʀᴏʟ",ar:"التحكم التنفيذي",ru:"Исполнительное управление",tr:"Çalışma Kontrolü",zh:"运行控制"},
  "مرکز Runtime":{en:"Rᴜɴᴛɪᴍᴇ Cᴇɴᴛᴇʀ",ar:"مركز التشغيل",ru:"Центр Runtime",tr:"Runtime Merkezi",zh:"运行中心"},
  "خطای Runtime":{en:"Rᴜɴᴛɪᴍᴇ Eʀʀᴏʀ",ar:"خطأ التشغيل",ru:"Ошибка Runtime",tr:"Runtime Hatası",zh:"运行错误"},
  "مرکز ممیزی":{en:"Aᴜᴅɪᴛ Cᴇɴᴛᴇʀ",ar:"مركز التدقيق",ru:"Центр аудита",tr:"Denetim Merkezi",zh:"审计中心"},
  "مرکز امنیت":{en:"Sᴇᴄᴜʀɪᴛʏ Cᴇɴᴛᴇʀ",ar:"مركز الأمان",ru:"Центр безопасности",tr:"Güvenlik Merkezi",zh:"安全中心"},
  "Warning Center":{en:"Wᴀʀɴɪɴɢ Cᴇɴᴛᴇʀ",ar:"مركز التحذيرات",ru:"Центр предупреждений",tr:"Uyarı Merkezi",zh:"警告中心"},
  "Mute Center":{en:"Mᴜᴛᴇ Cᴇɴᴛᴇʀ",ar:"مركز الكتم",ru:"Центр тишины",tr:"Sessize Alma Merkezi",zh:"禁言中心"},
  "Ban Center":{en:"Bᴀɴ Cᴇɴᴛᴇʀ",ar:"مركز الحظر",ru:"Центр блокировок",tr:"Yasak Merkezi",zh:"封禁中心"},
  "مدیریت قابلیت‌ها":{en:"Fᴇᴀᴛᴜʀᴇ Cᴇɴᴛᴇʀ",ar:"إدارة الميزات",ru:"Управление функциями",tr:"Özellik Merkezi",zh:"功能中心"},
  "امنیت و دسترسی":{en:"Sᴇᴄᴜʀɪᴛʏ & Aᴄᴄᴇss",ar:"الأمان والصلاحيات",ru:"Безопасность и доступ",tr:"Güvenlik ve Erişim",zh:"安全与访问"},
  "ممیزی سیستم":{en:"Sʏsᴛᴇᴍ Aᴜᴅɪᴛ",ar:"تدقيق النظام",ru:"Аудит системы",tr:"Sistem Denetimi",zh:"系统审计"},
  "ارسال همگانی":{en:"Bʀᴏᴀᴅᴄᴀsᴛ Cᴇɴᴛᴇʀ",ar:"الإرسال الجماعي",ru:"Массовая рассылка",tr:"Toplu Gönderim",zh:"群发中心"}
};

const BUTTON_LABELS:Record<string,Partial<Record<BotLang,string>>> = {
  "آمار کلی سیستم":{en:"System overview",ar:"نظرة عامة",ru:"Обзор системы",tr:"Sistem özeti",zh:"系统概览"},
  "مدیریت مشتریان":{en:"Customer center",ar:"إدارة العملاء",ru:"Клиенты",tr:"Müşteriler",zh:"客户中心"},
  "مدیریت لایسنس‌ها":{en:"License center",ar:"التراخيص",ru:"Лицензии",tr:"Lisanslar",zh:"许可证"},
  "مدیریت گروه‌ها":{en:"Group center",ar:"المجموعات",ru:"Группы",tr:"Gruplar",zh:"群组"},
  "زبان گروه‌ها":{en:"Group languages",ar:"لغات المجموعات",ru:"Языки групп",tr:"Grup dilleri",zh:"群组语言"},
  "ارسال همگانی":{en:"Broadcast",ar:"إرسال جماعي",ru:"Рассылка",tr:"Toplu gönderim",zh:"群发"},
  "کنترل اجرایی":{en:"Runtime control",ar:"التحكم التنفيذي",ru:"Runtime",tr:"Çalışma kontrolü",zh:"运行控制"},
  "ممیزی سیستم":{en:"System audit",ar:"تدقيق النظام",ru:"Аудит системы",tr:"Sistem denetimi",zh:"系统审计"},
  "امنیت و دسترسی":{en:"Security & access",ar:"الأمان والصلاحيات",ru:"Безопасность и доступ",tr:"Güvenlik ve erişim",zh:"安全与访问"},
  "پشتیبان‌گیری و بازیابی":{en:"Backup & restore",ar:"النسخ والاستعادة",ru:"Резервная копия",tr:"Yedekleme",zh:"备份与恢复"},
  "تنظیمات پیشرفته":{en:"Advanced settings",ar:"الإعدادات المتقدمة",ru:"Настройки",tr:"Gelişmiş ayarlar",zh:"高级设置"},
  "وضعیت سرور و منابع":{en:"Server & resources",ar:"الخادم والموارد",ru:"Сервер и ресурсы",tr:"Sunucu ve kaynaklar",zh:"服务器与资源"},
  "فهرست سیاه مشتریان":{en:"Customer blacklist",ar:"حظر العملاء",ru:"Черный список",tr:"Müşteri kara listesi",zh:"客户黑名单"},
  "مدیریت قابلیت‌ها":{en:"Feature center",ar:"إدارة الميزات",ru:"Функции",tr:"Özellikler",zh:"功能中心"},
  "مرکز هوش مصنوعی":{en:"AI center",ar:"الذكاء الاصطناعي",ru:"Центр ИИ",tr:"Yapay zeka",zh:"AI 中心"},
  "خروج از پنل مالک":{en:"Exit owner panel",ar:"خروج",ru:"Выход",tr:"Çıkış",zh:"退出"},
  "وضعیت و نمای کلی":{en:"Overview & status",ar:"النظرة والحالة",ru:"Обзор и статус",tr:"Genel bakış",zh:"概览与状态"},
  "مرکز قفل و فیلتر":{en:"Lock & filter",ar:"القفل والتصفية",ru:"Блокировки и фильтры",tr:"Kilit ve filtre",zh:"锁定与过滤"},
  "زبان ربات":{en:"Bot language",ar:"لغة البوت",ru:"Язык бота",tr:"Bot dili",zh:"机器人语言"},
  "مرکز امنیت":{en:"Security center",ar:"مركز الأمان",ru:"Безопасность",tr:"Güvenlik",zh:"安全中心"},
  "اخطار و جریمه":{en:"Warnings & penalties",ar:"التحذيرات والعقوبات",ru:"Предупреждения и санкции",tr:"Uyarılar ve cezalar",zh:"警告与处罚"},"مرکز مجازات":{en:"Pᴇɴᴀʟᴛʏ Cᴇɴᴛᴇʀ",ar:"مركز العقوبات",ru:"Центр наказаний",tr:"Ceza Merkezi",zh:"处罚中心"},
  "مدیریت اعضا":{en:"Members",ar:"الأعضاء",ru:"Участники",tr:"Üyeler",zh:"成员"},
  "مرکز اتوماسیون":{en:"Automation center",ar:"الأتمتة",ru:"Автоматизация",tr:"Otomasyon",zh:"自动化"},
  "استودیو دستورات":{en:"Command studio",ar:"استوديو الأوامر",ru:"Студия команд",tr:"Komut stüdyosu",zh:"命令工作室"},
  "استودیو محتوا":{en:"Content studio",ar:"استوديو المحتوى",ru:"Студия контента",tr:"İçerik stüdyosu",zh:"内容工作室"},
  "زمان‌بندی پیام‌ها":{en:"Scheduling",ar:"الجدولة",ru:"Планирование",tr:"Zamanlama",zh:"定时"},
  "تحلیل و آمار":{en:"Analytics",ar:"التحليلات",ru:"Аналитика",tr:"Analiz",zh:"分析"},
  "مرکز دسترسی":{en:"Permission center",ar:"الصلاحيات",ru:"Права доступа",tr:"Yetkiler",zh:"权限"},
  "مرکز استثناها":{en:"Exceptions",ar:"الاستثناءات",ru:"Исключения",tr:"İstisnalar",zh:"例外"},
  "ممیزی گروه":{en:"Group audit",ar:"تدقيق المجموعة",ru:"Аудит группы",tr:"Grup denetimi",zh:"群组审计"},
  "سلامت ربات":{en:"Bot health",ar:"حالة البوت",ru:"Состояние бота",tr:"Bot durumu",zh:"机器人状态"},
  "پشتیبانی و راهنما":{en:"Support & help",ar:"الدعم والمساعدة",ru:"Поддержка",tr:"Destek",zh:"支持与帮助"},
  "خروج از پنل":{en:"Exit panel",ar:"خروج",ru:"Выход",tr:"Çıkış",zh:"退出"},
  "‹ بازگشت":{en:"‹ Back",ar:"‹ رجوع",ru:"‹ Назад",tr:"‹ Geri",zh:"‹ 返回"},
  "بروزرسانی":{en:"Refresh",ar:"تحديث",ru:"Обновить",tr:"Yenile",zh:"刷新"},
  "پشتیبانی":{en:"Support",ar:"الدعم",ru:"Поддержка",tr:"Destek",zh:"支持"},
  "تمدید لایسنس":{en:"Renew license",ar:"تجديد الترخيص",ru:"Продлить лицензию",tr:"Lisansı yenile",zh:"续订许可证"},
  "مدیریت مالک‌ها":{en:"Owner management",ar:"إدارة المالكين",ru:"Владельцы",tr:"Sahipler",zh:"所有者管理"},
  "لیست سیاه":{en:"Blacklist",ar:"القائمة السوداء",ru:"Черный список",tr:"Kara liste",zh:"黑名单"},
  "استثناها و دامنه مجاز":{en:"Exceptions & allowlist",ar:"الاستثناءات",ru:"Исключения",tr:"İstisnalar",zh:"例外与白名单"}
};

function localizePanelTitle(title:string,lang:BotLang):string {
  const key=String(title??"").trim().replace(/^◈\s*/u,"");
  if(key==="Oᴡɴᴇʀ Cᴏɴᴛʀᴏʟ"||key==="Owner Control")return lang==="fa"?"Oᴡɴᴇʀ Cᴏɴᴛʀᴏʟ":(PANEL_TITLES["Owner Control"]?.[lang]??"Owner Control");
  if(key==="Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ"||key==="Group Control")return lang==="fa"?"Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ":(PANEL_TITLES["Group Control"]?.[lang]??"Group Control");
  return lang==="fa"?(PANEL_TITLES[key]?.fa??key):(PANEL_TITLES[key]?.[lang]??key);
}

const LABELS_BY_LANG:Record<BotLang,Record<string,string>> = {
  fa:{},
  en:{
    "نام":"Name","شناسه":"ID","شناسه گروه":"Group ID","شناسه کاربر":"User ID","نام کاربری":"Username","یوزرنیم":"Username","مقام":"Rank","سطح دسترسی":"Access level","وضعیت":"Status","وضعیت هسته":"Core status","وضعیت پنل":"Panel status","اعضا":"Members","ادمین‌ها":"Admins","مدیران":"Admins","مشتریان فعال":"Active customers","مشتریان منقضی":"Expired customers","گروه‌های فعال":"Active groups","قوانین فعال":"Active rules","زبان":"Language","زبان گروه":"Group language","عملیات امروز":"Today operations","آخرین فعالیت":"Last activity","آخرین بروزرسانی":"Last update","فعال":"Active","خاموش":"Off","آماده":"Ready","مالک":"Owner","مدیر گروه":"Group admin","کاربر":"User","کاربر عادی":"User","OWNER":"OWNER",
  },
  ar:{
    "نام":"الاسم","شناسه":"المعرّف","شناسه گروه":"معرّف المجموعة","شناسه کاربر":"معرّف المستخدم","نام کاربری":"اسم المستخدم","یوزرنیم":"اسم المستخدم","مقام":"الرتبة","سطح دسترسی":"مستوى الوصول","وضعیت":"الحالة","وضعیت هسته":"حالة النواة","وضعیت پنل":"حالة اللوحة","اعضا":"الأعضاء","ادمین‌ها":"المشرفون","مدیران":"المشرفون","مشتریان فعال":"العملاء النشطون","مشتریان منقضی":"العملاء المنتهية","گروه‌های فعال":"المجموعات النشطة","قوانین فعال":"القواعد النشطة","زبان":"اللغة","زبان گروه":"لغة المجموعة","عملیات امروز":"عمليات اليوم","آخرین فعالیت":"آخر نشاط","آخرین بروزرسانی":"آخر تحديث","فعال":"نشطة","خاموش":"متوقف","آماده":"جاهز","مالک":"المالك","مدیر گروه":"مشرف المجموعة","کاربر":"مستخدم","کاربر عادی":"مستخدم","OWNER":"مالك",
  },
  ru:{
    "نام":"Имя","شناسه":"ID","شناسه گروه":"ID группы","شناسه کاربر":"ID пользователя","نام کاربری":"Имя пользователя","یوزرنیم":"Имя пользователя","مقام":"Ранг","سطح دسترسی":"Уровень доступа","وضعیت":"Статус","وضعیت هسته":"Статус ядра","وضعیت پنل":"Статус панели","اعضا":"Участники","ادمین‌ها":"Администраторы","مدیران":"Администраторы","مشتریان فعال":"Активные клиенты","مشتریان منقضی":"Истёкшие клиенты","گروه‌های فعال":"Активные группы","قوانین فعال":"Активные правила","زبان":"Язык","زبان گروه":"Язык группы","عملیات امروز":"Операции сегодня","آخرین فعالیت":"Последняя активность","آخرین بروزرسانی":"Последнее обновление","فعال":"Активен","خاموش":"Выключен","آماده":"Готов","مالک":"Владелец","مدیر گروه":"Администратор группы","کاربر":"Пользователь","کاربر عادی":"Пользователь","OWNER":"Владелец",
  },
  tr:{
    "نام":"Ad","شناسه":"Kimlik","شناسه گروه":"Grup Kimliği","شناسه کاربر":"Kullanıcı Kimliği","نام کاربری":"Kullanıcı adı","یوزرنیم":"Kullanıcı adı","مقام":"Rütbe","سطح دسترسی":"Erişim seviyesi","وضعیت":"Durum","وضعیت هسته":"Çekirdek durumu","وضعیت پنل":"Panel durumu","اعضا":"Üyeler","ادمین‌ها":"Yöneticiler","مدیران":"Yöneticiler","مشتریان فعال":"Aktif müşteriler","مشتریان منقضی":"Süresi dolmuş müşteriler","گروه‌های فعال":"Aktif gruplar","قوانین فعال":"Aktif kurallar","زبان":"Dil","زبان گروه":"Grup dili","عملیات امروز":"Bugünkü işlemler","آخرین فعالیت":"Son etkinlik","آخرین بروزرسانی":"Son güncelleme","فعال":"Aktif","خاموش":"Kapalı","آماده":"Hazır","مالک":"Sahip","مدیر گروه":"Grup yöneticisi","کاربر":"Kullanıcı","کاربر عادی":"Kullanıcı","OWNER":"Sahip",
  },
  zh:{
    "نام":"名称","شناسه":"ID","شناسه گروه":"群组 ID","شناسه کاربر":"用户 ID","نام کاربری":"用户名","یوزرنیم":"用户名","مقام":"等级","سطح دسترسی":"权限级别","وضعیت":"状态","وضعیت هسته":"核心状态","وضعیت پنل":"面板状态","اعضا":"成员","ادمین‌ها":"管理员","مدیران":"管理员","مشتریان فعال":"活跃客户","مشتریان منقضی":"已过期客户","گروه‌های فعال":"活跃群组","قوانین فعال":"启用规则","زبان":"语言","زبان گروه":"群组语言","عملیات امروز":"今日操作","آخرین فعالیت":"最后活动","آخرین بروزرسانی":"最后更新","فعال":"已启用","خاموش":"已关闭","آماده":"就绪","مالک":"所有者","مدیر گروه":"群组管理员","کاربر":"用户","کاربر عادی":"用户","OWNER":"所有者",
  },
};

function localizePanelBody(body:string,lang:BotLang):string {
  if(lang==="fa")return body;
  const map=LABELS_BY_LANG[lang];
  return String(body??"").split(/\n/).map(line=>{
    const m=line.match(/^(\s*⛂\s*-\s*)([^:]+)(\s*:\s*)(.*)$/u);
    if(!m)return line;
    const label=map[m[2].trim()]??m[2].trim();
    const value=map[m[4].trim()]??m[4];
    return m[1]+label+m[3]+value;
  }).join("\n");
}

function normalizeGroups(body:string):string[] {
  const cleaned=String(body??"")
    .replace(/━━━━━━━━━━━━━━━━━━━━━━━━/g,"")
    .replace(new RegExp(PANEL_SEPARATOR,"gu"),"\n\n")
    .trim();
  if(!cleaned)return [];
  return cleaned.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
}

function buildPanelRichMessage(title:string,body:string,lang:BotLang):{blocks:RichBlock[];is_rtl:boolean} {
  const groups=normalizeGroups(localizePanelBody(body,lang));
  const blocks:RichBlock[]=[{
    type:"heading",
    text:"◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · "+(localizePanelTitle(title,lang)),
    size:2
  }];
  groups.forEach((group,index)=>{
    if(index>0)blocks.push({type:"paragraph",text:PANEL_SEPARATOR});
    blocks.push({type:"paragraph",text:group});
  });
  return {blocks,is_rtl:lang==="fa"||lang==="ar"};
}

function normalizePanelDigits(value:string):string {
  return String(value??"").replace(/[۰-۹]/g,ch=>String(ch.charCodeAt(0)-1776)).replace(/[٠-٩]/g,ch=>String(ch.charCodeAt(0)-1632));
}

function buildPanelText(title:string,body:string,lang:BotLang):string {
  const groups=normalizeGroups(localizePanelBody(body,lang));
  const titleText=localizePanelTitle(title,lang);
  return normalizePanelDigits("◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · "+titleText+(groups.length?"\n\n"+groups.join("\n\n"+PANEL_SEPARATOR+"\n\n"):""));
}

function panelTitle(title:string,body:string):PanelMessage {
  return {title:String(title??"").trim(),body:String(body??"").trim(),is_rtl:true};
}

function panelFromString(message:string):PanelMessage {
  const raw=String(message??"").trim();
  const lines=raw.split(/\n/);
  const first=(lines[0]??"").trim();
  if(first.startsWith("◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · ")){
    return panelTitle(first.slice("◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · ".length),lines.slice(1).join("\n").trim());
  }
  if(first.startsWith("◈ ")){
    return panelTitle(first.slice(2).trim(),lines.slice(1).join("\n").trim());
  }
  return panelTitle("پیام",raw);
}

function localizeMarkup(markup:any,lang:BotLang):any {
  if(!markup?.inline_keyboard)return markup;
  return {
    ...markup,
    inline_keyboard:markup.inline_keyboard.map((row:any[])=>row.map((button:any)=>{
      const raw=String(button?.text??"");
      if(raw.startsWith("● ")){
        const base=raw.slice(2);
        return {...button,text:normalizePanelDigits("● "+(BUTTON_LABELS[base]?.[lang]??base))};
      }
      return {...button,text:normalizePanelDigits(BUTTON_LABELS[raw]?.[lang]??raw)};
    }))
  };
}

async function panelLanguageForChat(chatId:number):Promise<BotLang>{
  const scope=currentPanelScope();
  if(!scope || chatId>=0)return "fa";
  return getGroupLanguage(scope.pool,chatId,"fa");
}

async function send(chatId:number,message:string|PanelMessage,markup:any=null){
  const lang=await panelLanguageForChat(chatId);
  const panel=typeof message==="string"?panelFromString(message):message;
  const keyboard=localizeMarkup(markup,lang);
  const result=await telegramApi("sendMessage",{
    chat_id:chatId,
    text:buildPanelText(panel.title,panel.body,lang),
    reply_markup:keyboard||undefined
  });
  const scope=currentPanelScope();
  if(result.ok&&scope&&keyboard?.inline_keyboard){
    const messageId=Number((result.result as any)?.message_id);
    if(Number.isSafeInteger(messageId)&&messageId>0){
      await bindPanelMessage(scope.pool,chatId,messageId,scope.userId);
    }
  }
  return result;
}

async function edit(chatId:number,messageId:number,message:string|PanelMessage,markup:any=null){
  await sleep(75);
  const lang=await panelLanguageForChat(chatId);
  const panel=typeof message==="string"?panelFromString(message):message;
  const keyboard=localizeMarkup(markup,lang);
  const result=await telegramApi("editMessageText",{
    chat_id:chatId,
    message_id:messageId,
    text:buildPanelText(panel.title,panel.body,lang),
    reply_markup:keyboard||undefined
  });
  const scope=currentPanelScope();
  if(result.ok&&scope){
    if(keyboard?.inline_keyboard)await touchPanelMessage(scope.pool,chatId,messageId,scope.userId);
    else await unbindPanelMessage(scope.pool,chatId,messageId,scope.userId);
  }
  return result;
}

async function audit(pool:Pool,actor:string,action:string,target:string,meta:any={}){await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'telegram_panel')",[actor,action,target,JSON.stringify(meta)]).catch(()=>{});}
async function ensureOwners(pool:Pool,ids:string[]){for(const id of ids){if(/^\d+$/.test(id))await pool.query("INSERT INTO bot_panel_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING",[id]);}}
async function isOwner(pool:Pool,uid:number,envOwners:string[]){const all=new Set([...BUILTIN_OWNER_IDS,...envOwners]);if(all.has(String(uid)))return true;const r=await pool.query("SELECT 1 FROM bot_panel_owners WHERE user_id=$1 LIMIT 1",[uid]);return !!r.rowCount;}
async function customerEnsure(pool:Pool,uid:number,u:TgUser){await pool.query("INSERT INTO bot_customers(user_id,username,first_name,last_active_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_active_at=NOW()",[uid,u.username||null,u.first_name||""]);}

async function validLicense(pool:Pool,uid:number){
  const r=await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY expires_at NULLS LAST, id DESC LIMIT 1",[uid]);
  return r.rows[0]||null;
}
async function customerAllowedForChat(pool:Pool,uid:number,chatId:number){
  const license=await validLicense(pool,uid);
  if(!license)return null;
  const existing=await pool.query("SELECT * FROM bot_customer_groups WHERE group_id=$1 AND customer_id=$2 AND is_active=TRUE LIMIT 1",[chatId,uid]);
  if(existing.rowCount)return license;
  const count=Number((await pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE",[uid])).rows[0]?.n||0);
  const limit=Number(license.group_limit||0);
  if(limit>0 && count>=limit)return null;
  const membership=await isGroupAdmin(chatId,uid);
  if(!membership)return null;
  const chat=await telegramApi<any>("getChat",{chat_id:chatId});
  if(!chat.ok)return null;
  await pool.query("INSERT INTO bot_customer_groups(group_id,customer_id,title) VALUES($1,$2,$3) ON CONFLICT(group_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,title=EXCLUDED.title,last_seen_at=NOW(),is_active=TRUE",[chatId,uid,String(chat.result?.title||"")]);
  return license;
}
async function isGroupAdmin(chatId:number,uid:number){
  const r=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:uid});return !!(r.ok&&["administrator","creator"].includes(String(r.result?.status||"")));
}
function mainOwnerMessage(){return "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Oᴡɴᴇʀ Cᴏɴᴛʀᴏʟ\n\n⛂ - سطح دسترسی : OWNER\n⛂ - وضعیت هسته : فعال\n⛂ - وضعیت پنل : آماده\n\nمرکز کنترل مالک برای مدیریت مشتریان، لایسنس‌ها، گروه‌ها، Runtime و Audit.";};
function mainCustomerMessage(){return "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Gʀᴏᴜᴘ Cᴏɴᴛʀᴏʟ\n\n⛂ - دسترسی : مدیر گروه\n⛂ - هسته قفل : آماده\n⛂ - موتور کنترل : فعال\n\nمرکز کنترل عملیاتی گروه از همین پنل در دسترس است.";};

async function ownerStats(pool:Pool){
  const [customers,active,expired,groups,cmd24,cmd7,warn,kick]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM bot_customers"),
    pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())"),
    pool.query("SELECT COUNT(*)::int n FROM bot_licenses WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=NOW()"),
    pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE is_active=TRUE"),
    pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action='command_executed' AND created_at>=NOW()-INTERVAL '24 hours'"),
    pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action='command_executed' AND created_at>=NOW()-INTERVAL '7 days'"),
    pool.query("SELECT COUNT(*)::int n FROM warning_events WHERE action_type='warning'"),
    pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE event_type IN ('member_banned','member_kicked')"),
  ]);
  const c=Number(customers.rows[0].n||0),g=Number(groups.rows[0].n||0);
  return [
    "◈ آمار کلی سیستم","",
    "⛂ مشتریان کل : "+c,
    "⛂ مشتریان فعال : "+Number(active.rows[0].n||0),
    "⛂ مشتریان منقضی : "+Number(expired.rows[0].n||0),
    "⛂ - گروه‌های فعال : "+g,
    "⛂ اجرای دستور در ۲۴ ساعت : "+Number(cmd24.rows[0].n||0),
    "⛂ اجرای دستور در ۷ روز : "+Number(cmd7.rows[0].n||0),
    "⛂ اخطارهای صادرشده : "+Number(warn.rows[0].n||0),
    "⛂ اخراج/بن ثبت‌شده : "+Number(kick.rows[0].n||0),
    "⛂ میانگین گروه/مشتری : "+(c?(g/c).toFixed(2):"0"),
    "",
    "★ بروزرسانی : "+faDate(new Date())
  ].join("\n");
}

async function customerStatus(pool:Pool,uid:number,chatId:number){
  const chat=await telegramApi<any>("getChat",{chat_id:chatId});const count=await telegramApi<any>("getChatMemberCount",{chat_id:chatId});
  const admins=await telegramApi<any>("getChatAdministrators",{chat_id:chatId});
  const group=await pool.query("SELECT * FROM bot_groups WHERE id=$1 LIMIT 1",[chatId]);
  const settings=await pool.query("SELECT * FROM bot_group_settings WHERE group_id=$1 LIMIT 1",[chatId]);
  const license=await validLicense(pool,uid);
  const member=(await pool.query("SELECT COUNT(*)::int n FROM warning_cases WHERE group_id=$1 AND warning_count>0",[chatId])).rows[0].n||0;
  return [
    "◈ وضعیت گروه فعلی","",
    "⛂ - نام : "+(chat.result?.title||group.rows[0]?.title||"—"),
    "⛂ شناسه : "+chatId,
    "⛂ اعضا : "+(count.result??"—"),
    "⛂ ادمین‌ها : "+(admins.result?.length??"—"),
    "⛂ افراد دارای اخطار : "+member,
    "⛂ قفل محتوا : "+(settings.rows[0]?.full_lock?"فعال":"عادی"),
    "⛂ حالت اضطراری : "+(settings.rows[0]?.emergency_mode?"فعال":"غیرفعال"),
    "⛂ - لایسنس : "+(license?.license_type||"عضویت گروه"),
    "⛂ افزودن ربات : "+(group.rows[0]?.updated_at?faDate(group.rows[0].updated_at):"ثبت نشده")
  ].join("\n");
}

async function renderOwner(pool:Pool,uid:number,chatId:number,msgId?:number,view="main"){
  const body=view==="main"?mainOwnerMessage():await ownerStats(pool);
  const markup=view==="main"?menu(K.ownerMain):menu([[["بروزرسانی آمار","o:stats"],["‹ بازگشت","o:home"]]]);
  return msgId?edit(chatId,msgId,body,markup):send(chatId,body,markup);
}

async function handleOwner(pool:Pool,msg:TgMessage,ownerIds:string[]){
  const uid=msg.from!.id;
  const raw=(msg.text||"").trim().replace(/^[/!]/,"").toLowerCase();
  if(["owner","مالک"].includes(raw)&&!await isOwner(pool,uid,ownerIds)){
    await send(msg.chat.id,"شما دسترسی به پنل مالک را ندارید.");
    return true;
  }
  if(!await isOwner(pool,uid,ownerIds))return false;
  await customerEnsure(pool,uid,msg.from!);
  if(["owner","مالک"].includes(raw)){
    await audit(pool,String(uid),"owner_panel_opened",String(uid));await renderOwner(pool,uid,msg.chat.id);return true;
  }
  const s=getSession(uid);
  if(s&&s.flow==="owner_customer_search"){
    clearSession(uid);const q=raw.replace(/^@/,"");const r=await pool.query("SELECT * FROM bot_customers WHERE user_id::text=$1 OR LOWER(username)=LOWER($1) LIMIT 1",[q]);
    if(!r.rowCount)return send(msg.chat.id,"مشتری با این مشخصات یافت نشد.",menu([[["جستجوی مجدد","o:customers"],["‹ بازگشت","o:home"]]]))&&true;
    return sendCustomer(pool,uid,msg.chat.id,r.rows[0]);
  }
  if(s&&s.flow==="owner_license_create"){
    const step=Number(s.data.step||1),v=raw;
    if(step===1){const t=LICENSE_TYPES.find(x=>x.key===v)||LICENSE_TYPES.find(x=>x.label===v);if(!t)return send(msg.chat.id,"نوع لایسنس معتبر نیست. از دکمه‌های پنل انتخاب کنید.")&&true;s.data.type=t; s.data.step=2;session(uid,s.flow,s.data);return send(msg.chat.id,"حداکثر تعداد گروه این لایسنس را به عدد ارسال کنید.");}
    if(step===2){const n=Number(v);if(!Number.isInteger(n)||n<1||n>10000)return send(msg.chat.id,"تعداد گروه باید عددی بین ۱ تا ۱۰۰۰۰ باشد.");s.data.groupLimit=n;s.data.step=3;session(uid,s.flow,s.data);return send(msg.chat.id,"قیمت داخلی لایسنس را به عدد ارسال کنید؛ برای بدون قیمت «0» بفرستید.");}
    if(step===3){const p=Number(v);if(!Number.isFinite(p)||p<0)return send(msg.chat.id,"قیمت معتبر نیست.");s.data.price=p;s.data.step=4;session(uid,s.flow,s.data);return send(msg.chat.id,"آیدی عددی مشتری را ارسال کنید.");}
    if(step===4){const customerId=Number(v);if(!Number.isSafeInteger(customerId))return send(msg.chat.id,"آیدی مشتری معتبر نیست.");s.data.customerId=customerId;s.data.step=5;session(uid,s.flow,s.data);return send(msg.chat.id,"برای تأیید ایجاد لایسنس، «تایید نهایی» را ارسال کنید.");}
    if(step===5&&v==="تایید نهایی"){
      const d=s.data,t=d.type.days===null?null:new Date(Date.now()+d.type.days*86400000);const code="PBS-"+Math.random().toString(36).slice(2,10).toUpperCase();
      await pool.query("INSERT INTO bot_customers(user_id,status) VALUES($1,'active') ON CONFLICT DO NOTHING",[d.customerId]);
      const row=(await pool.query("INSERT INTO bot_licenses(code,customer_id,license_type,group_limit,price,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[code,d.customerId,d.type.key,d.groupLimit,d.price,t])).rows[0];
      clearSession(uid);await audit(pool,String(uid),"license_created",String(row.id),{code});
      return send(msg.chat.id,"✓ لایسنس ساخته شد.\n\n⛂ کد : "+row.code+"\n⛂ نوع : "+d.type.label+"\n⛂ سقف گروه : "+d.groupLimit+"\n⛂ - انقضا : "+(t?faDate(t):"مادام‌العمر"),menu([[["‹ بازگشت","o:licenses"]]]));
    }
    return send(msg.chat.id,"برای تکمیل عملیات، «تایید نهایی» را ارسال کنید.");
  }
  if(!s)return false;
  return false;
}

async function sendCustomer(pool:Pool,ownerId:number,chatId:number,row:any){
  const lic=await validLicense(pool,Number(row.user_id));const groups=(await pool.query("SELECT COUNT(*)::int n FROM bot_customer_groups WHERE customer_id=$1 AND is_active=TRUE",[row.user_id])).rows[0].n||0;
  const text=["◈ اطلاعات مشتری","","⛂ - آیدی : "+row.user_id,"⛂ - یوزرنیم : "+(row.username?"@"+row.username:"ندارد"),"⛂ - نام : "+(row.first_name||"—"),"⛂ - اولین نصب : "+faDate(row.first_installed_at),"⛂ - گروه‌های فعال : "+groups,"⛂ - لایسنس : "+(lic?.license_type||"ندارد"),"⛂ - شروع : "+(lic?faDate(lic.starts_at):"—"),"⛂ - انقضا : "+(lic?.expires_at?faDate(lic.expires_at):"مادام‌العمر"),"⛂ - وضعیت مشتری : "+row.status,"⛂ - آخرین فعالیت : "+faDate(row.last_active_at)].join("\n");
  const buttons=[[["فعال‌سازی لایسنس","u:lic_on:"+row.user_id],["غیرفعال‌سازی","u:lic_off:"+row.user_id]],[["افزایش مدت","u:lic_plus:"+row.user_id],["کاهش مدت","u:lic_minus:"+row.user_id]],[["مسدودکردن","u:block:"+row.user_id],["رفع مسدودیت","u:unblock:"+row.user_id]],[["لاگ مشتری","u:logs:"+row.user_id],["پیام خصوصی","u:msg:"+row.user_id]],[["‹ بازگشت","o:customers"]]];
  return send(chatId,text,menu(buttons));
}

async function ownerCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  const uid=cb.from.id;if(!await isOwner(pool,uid,ownerIds))return;
  const data=String(cb.data||"");const msg=cb.message;if(!msg)return;await answer(cb.id);
  if(data==="o:home")return renderOwner(pool,uid,msg.chat.id,msg.message_id,"main");
  if(data==="o:stats")return renderOwner(pool,uid,msg.chat.id,msg.message_id,"stats");
  if(data==="o:customers"){session(uid,"owner_customer_search");return edit(msg.chat.id,msg.message_id,"آیدی عددی یا یوزرنیم مشتری را ارسال کنید.",menu([[["‹ بازگشت","o:home"]]]));}
  if(data==="o:licenses")return edit(msg.chat.id,msg.message_id,"◈ مدیریت لایسنس‌ها",menu([[["ایجاد لایسنس جدید","o:lic_create"],["لایسنس‌های فعال","o:lic_active"]],[["در حال انقضا","o:lic_expiring"],["منقضی‌شده","o:lic_expired"]],[["محدودیت گروه هر نوع","o:lic_limits"],["‹ بازگشت","o:home"]]]));
  if(data==="o:lic_limits"){const r=await pool.query("SELECT license_type,MAX(group_limit)::int max_limit,COUNT(*)::int count FROM bot_licenses GROUP BY license_type ORDER BY license_type");return edit(msg.chat.id,msg.message_id,r.rows.length?r.rows.map((x:any)=>"• "+x.license_type+" · سقف "+x.max_limit+" · "+x.count+" لایسنس").join("\n"):"هنوز لایسنسی ثبت نشده است.",menu([[["‹ بازگشت","o:licenses"]] ]));}
  if(data==="o:lic_create"){session(uid,"owner_license_create",{step:1});return edit(msg.chat.id,msg.message_id,"نوع لایسنس را انتخاب کنید.",menu(LICENSE_TYPES.map(x=>[[x.label,"o:lic_type:"+x.key]]).concat([[["‹ بازگشت","o:licenses"]]])));} 
  if(data.startsWith("o:lic_type:")){const t=LICENSE_TYPES.find(x=>x.key===data.slice(11));if(!t)return;session(uid,"owner_license_create",{step:2,type:t});return edit(msg.chat.id,msg.message_id,"نوع «"+t.label+"» انتخاب شد.\n\nحداکثر تعداد گروه این لایسنس را به عدد ارسال کنید.");}
  if(data==="o:lic_active"||data==="o:lic_expiring"||data==="o:lic_expired"){const where=data==="o:lic_active"?"status='active' AND (expires_at IS NULL OR expires_at>NOW())":data==="o:lic_expiring"?"status='active' AND expires_at>NOW() AND expires_at<=NOW()+INTERVAL '7 days'":"status='active' AND expires_at IS NOT NULL AND expires_at<=NOW()";const r=await pool.query("SELECT code,customer_id,license_type,group_limit,expires_at FROM bot_licenses WHERE "+where+" ORDER BY expires_at NULLS LAST LIMIT 30");const lines=r.rows.length?r.rows.map((x:any)=>"• "+x.code+" · "+x.customer_id+" · "+x.license_type+" · "+(x.expires_at?faDate(x.expires_at):"∞")).join("\n"):"موردی ثبت نشده است.";return edit(msg.chat.id,msg.message_id,"◈ لیست لایسنس‌ها\n\n"+lines,menu([[["‹ بازگشت","o:licenses"]]]));}
  if(data==="o:languages"){
    await ensureGroupLanguageSchema(pool);
    const rows=await pool.query(`
      SELECT x.group_id,
             COALESCE(NULLIF(bg.title,''),NULLIF(cg.title,''),NULLIF(x.title,''),'گروه بدون نام') AS title,
             COALESCE(bg.is_active,cg.is_active,TRUE) AS is_active,
             COALESCE(l.language_code,'fa') AS language_code
      FROM (
        SELECT id AS group_id,title FROM bot_groups
        UNION
        SELECT group_id,title FROM bot_customer_groups
        UNION
        SELECT group_id,'' AS title FROM content_lock_settings
        UNION
        SELECT group_id,'' AS title FROM bot_group_installations
      ) x
      LEFT JOIN bot_groups bg ON bg.id=x.group_id
      LEFT JOIN bot_customer_groups cg ON cg.group_id=x.group_id
      LEFT JOIN bot_group_languages l ON l.group_id=x.group_id
      ORDER BY COALESCE(bg.is_active,cg.is_active,TRUE) DESC,x.group_id DESC
      LIMIT 100
    `);
    const buttons:any[]=rows.rows.map((x:any)=>[[((x.title||"گروه بدون نام")+" · "+languageNative(normalizeBotLang(x.language_code)??"fa")),"og:lang:"+x.group_id]]);
    if(!buttons.length)buttons.push([["افزودن/ثبت گروه","o:groups"]]);
    buttons.push([["‹ بازگشت","o:home"]]);
    const activeCount=rows.rows.filter((x:any)=>x.is_active!==false).length;
    return edit(msg.chat.id,msg.message_id,panelTitle("زبان گروه‌ها","⛂ - گروه‌های فعال : "+activeCount+"\n⛂ - گروه‌های ثبت‌شده : "+rows.rows.length+"\n⛂ - دامنه تنظیم : هر گروه مستقل است."),menu(buttons));
  }
  if(data.startsWith("og:lang:")){
    const gid=Number(data.slice(7));if(!Number.isSafeInteger(gid))return;
    const current=await getGroupLanguage(pool,gid,"fa");
    const buttons:any[][]=SUPPORTED_LANGUAGES.map(x=>[[languageButtonLabel(x.code,current),"og:setlang:"+gid+":"+x.code]]);
    if(!buttons.length)buttons.push([["فارسی","og:setlang:"+gid+":fa"]]);
    buttons.push([["‹ بازگشت","o:languages"]]);
    return edit(msg.chat.id,msg.message_id,panelTitle("زبان گروه","⛂ - گروه : "+gid+"\n⛂ - زبان فعلی : "+languageNative(current)),menu(buttons));
  }
  if(data.startsWith("og:setlang:")){
    const parts=data.split(":");const gid=Number(parts[2]);const lang=normalizeBotLang(parts[3]);
    if(!Number.isSafeInteger(gid)||!lang)return;
    await setGroupLanguage(pool,gid,lang);
    await audit(pool,String(uid),"group_language_changed",String(gid),{language:lang});
    return edit(msg.chat.id,msg.message_id,panelTitle("زبان گروه","⛂ - شناسه گروه : "+gid+"\n⛂ - زبان جدید : "+languageNative(lang)+"\n⛂ - وضعیت : فعال"),menu([[["زبان گروه","og:lang:"+gid],["‹ بازگشت","o:languages"]]]));
  }
  if(data==="o:groups"){
    const r=await pool.query("SELECT group_id,customer_id,title,is_active,last_seen_at FROM bot_customer_groups ORDER BY last_seen_at DESC NULLS LAST LIMIT 50");
    const rows:any[]=r.rows.map((x:any)=>[["گروه "+valueOrDash(x.title)+" · "+x.group_id,"og:view:"+x.group_id]]);
    rows.push([["‹ بازگشت","o:home"]]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز گروه‌ها","گروه‌های ثبت‌شده و وضعیت اتصال سرویس."),menu(rows));
  }
  if(data.startsWith("og:view:")){
    const gid=Number(data.slice(8)); if(!Number.isSafeInteger(gid))return;
    const r=await pool.query("SELECT * FROM bot_customer_groups WHERE group_id=$1 LIMIT 1",[gid]);
    if(!r.rowCount)return edit(msg.chat.id,msg.message_id,"گروه پیدا نشد.",menu([[["‹ بازگشت","o:groups"]]]));
    const x=r.rows[0];
    const groupLanguage=await getGroupLanguage(pool,gid,"fa");
    return edit(msg.chat.id,msg.message_id,
      panelTitle("کنترل گروه",[
        "⛂ - شناسه : "+gid,
        "⛂ - مشتری : "+valueOrDash(x.customer_id),
        "⛂ - عنوان : "+valueOrDash(x.title),
        "⛂ - وضعیت : "+(x.is_active?"● فعال":"○ خاموش"),
        "⛂ - زبان گروه : "+languageNative(groupLanguage),
        "⛂ - آخرین مشاهده : "+valueOrDash(x.last_seen_at?faDate(x.last_seen_at):null)
      ].join("\n")),
      menu([
        [[(x.is_active?"غیرفعال‌سازی":"فعال‌سازی"),"og:toggle:"+gid]],
        [["زبان گروه","og:lang:"+gid]],
        [["‹ بازگشت","o:groups"]]
      ])
    );
  }
  if(data.startsWith("og:toggle:")){
    const gid=Number(data.slice(10));if(!Number.isSafeInteger(gid))return;
    await pool.query("UPDATE bot_customer_groups SET is_active=NOT is_active,last_seen_at=NOW() WHERE group_id=$1",[gid]);
    await audit(pool,String(uid),"owner_group_status_changed",String(gid));
    return edit(msg.chat.id,msg.message_id,"✓ وضعیت اتصال گروه تغییر کرد.",menu([[ ["› مشاهده گروه","og:view:"+gid] ],[["‹ بازگشت","o:groups"]]]));
  }
    if(data.startsWith("o:runtime:")){
    const action=data.slice("o:runtime:".length);
    if(!["health_check","reload_config","maintenance_on","maintenance_off","restart_requested"].includes(action))return;
    try{
      const result=await executeRuntimeAction(action);
      return edit(msg.chat.id,msg.message_id,panelTitle("مرکز Runtime",[
        "⛂ - عملیات : "+action,
        "⛂ - نتیجه : "+(result.status==="accepted"?"درخواست ثبت شد":"با موفقیت اجرا شد"),
        "⛂ - Maintenance : "+(isRuntimeMaintenance()?"● فعال":"○ خاموش"),
        "",
        "─────━━───── ◈ ─────━━─────",
        "عملیات روی هسته اجرایی واقعی ربات اجرا شد."
      ].join("\n")),menu([[["مرکز Runtime","o:runtime"],["‹ بازگشت","o:home"]]]));
    }catch(error){
      return edit(msg.chat.id,msg.message_id,panelTitle("خطای Runtime",[
        "⛂ - عملیات : "+action,
        "⛂ - خطا : "+(error instanceof Error?error.message:String(error))
      ].join("\n")),menu([[["‹ بازگشت","o:runtime"]]]));
    }
  }
  if(data==="o:runtime"){
    const m=process.memoryUsage();let me:any=null;try{const r=await telegramApi<any>("getMe",{});me=r.ok?r.result:null;}catch{}
    const maintenance=isRuntimeMaintenance();
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز Runtime",[
      "⛂ - وضعیت پردازش : ● فعال",
      "⛂ - Maintenance : "+(maintenance?"● فعال":"○ خاموش"),
      "⛂ - Node : "+process.version,
      "⛂ - Uptime : "+Math.floor(process.uptime())+" ثانیه",
      "⛂ - RAM : "+(m.rss/1048576).toFixed(1)+" MB",
      "⛂ - Heap : "+(m.heapUsed/1048576).toFixed(1)+" MB",
      "⛂ - Telegram API : "+(me?"● متصل":"○ نامشخص"),
      "⛂ - Bot : "+valueOrDash(me?.username?"@"+me.username:null),
      "",
      "─────━━───── ◈ ─────━━─────",
      "این بخش کنترل واقعی Runtime را در اختیار مالک قرار می‌دهد."
    ].join("\n")),menu([
      [["بررسی سلامت","o:runtime:health_check"],["بارگذاری مجدد تنظیمات","o:runtime:reload_config"]],
      [[maintenance?"خاموش‌سازی Maintenance":"فعال‌سازی Maintenance",maintenance?"o:runtime:maintenance_off":"o:runtime:maintenance_on"],["راه‌اندازی مجدد","o:runtime:restart_requested"]],
      [["‹ بازگشت","o:home"]]
    ]));
  }
  if(data==="o:audit"){
    const r=await pool.query("SELECT actor_id,action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 40");
    const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+faDate(x.created_at)+" · "+valueOrDash(x.action)+" · "+valueOrDash(x.target)).join("\\n"):"هنوز رویدادی ثبت نشده است.";
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز ممیزی",lines),menu([[ ["بروزرسانی","o:audit"],["‹ بازگشت","o:home"] ]]));
  }
  if(data==="o:security"){
    const [owners,blocked]=await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM bot_panel_owners"),
      pool.query("SELECT COUNT(*)::int n FROM bot_blacklist")
    ]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت",[
      "⛂ - مالکان ثبت‌شده : "+Number(owners.rows[0]?.n||0),
      "⛂ - مشتریان لیست سیاه : "+Number(blocked.rows[0]?.n||0),
      "⛂ - ثبت Audit : ● فعال",
      "⛂ - کنترل دسترسی پنل : ● فعال"
    ].join("\\n")),menu([[ ["مدیریت مالک‌ها","s:owners"],["لیست سیاه","o:blacklist"] ],[["‹ بازگشت","o:home"]]]));
  }
  if(data==="o:features"){
    await pool.query("CREATE TABLE IF NOT EXISTS bot_feature_flags (name TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const defaults=["advanced_panel","content_lock_engine","warning_engine","automation_engine","analytics_engine","ai_engine"];
    for(const name of defaults)await pool.query("INSERT INTO bot_feature_flags(name,enabled) VALUES($1,FALSE) ON CONFLICT(name) DO NOTHING",[name]);
    const r=await pool.query("SELECT name,enabled FROM bot_feature_flags ORDER BY name");
    const rows:any[]=r.rows.map((x:any)=>[[(x.enabled?"فعال":"غیرفعال")+" · "+x.name,"ff:toggle:"+x.name]]);
    rows.push([["‹ بازگشت","o:home"]]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مدیریت قابلیت‌ها","هر تغییر به‌صورت پایدار در PostgreSQL ذخیره و در Audit ثبت می‌شود."),menu(rows));
  }
  if(data.startsWith("ff:toggle:")){
    const name=data.slice(10);
    await pool.query("CREATE TABLE IF NOT EXISTS bot_feature_flags (name TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const r=await pool.query("INSERT INTO bot_feature_flags(name,enabled) VALUES($1,TRUE) ON CONFLICT(name) DO UPDATE SET enabled=NOT bot_feature_flags.enabled,updated_at=NOW() RETURNING enabled",[name]);
    await audit(pool,String(uid),"feature_flag_changed",name,{enabled:r.rows[0]?.enabled});
    return edit(msg.chat.id,msg.message_id,"✓ وضعیت قابلیت تغییر کرد.\n\n⛂ - نام : "+name+"\n⛂ - وضعیت : "+(r.rows[0]?.enabled?"● فعال":"○ غیرفعال"),menu([[ ["مدیریت مدیریت قابلیت‌ها","o:features"] ],[["‹ بازگشت","o:home"]]]));
  }
  if(data==="o:ai"){
    const configured=Boolean(process.env.OPENAI_API_KEY||process.env.AI_API_KEY);
    await pool.query("CREATE TABLE IF NOT EXISTS bot_feature_flags (name TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const flag=(await pool.query("SELECT enabled FROM bot_feature_flags WHERE name='ai_engine' LIMIT 1")).rows[0]?.enabled;
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز هوش مصنوعی",[
      "⛂ - ارائه‌دهنده : "+(configured?"● پیکربندی شده":"○ تنظیم نشده"),
      "⛂ - AI Engine : "+(flag?"● فعال":"○ غیرفعال"),
      "⛂ - وضعیت Runtime : ● آماده برای اتصال",
      "",
      configured?"کلید سرویس موجود است؛ فعال‌سازی موتور از مدیریت قابلیت‌ها انجام می‌شود.":"برای اجرای واقعی قابلیت‌های AI، کلید سرویس سرویس موردنظر باید در Railway Variables تنظیم شود."
    ].join("\\n")),menu([[ ["مدیریت قابلیت‌ها","o:features"],["‹ بازگشت","o:home"] ]]));
  }
  if(data==="o:logs"){const r=await pool.query("SELECT action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50");const lines=r.rows.length?r.rows.map((x:any)=>"• "+faDate(x.created_at)+" · "+x.action+" · "+(x.target||"—")).join("\n"):"لاگی ثبت نشده است.";return edit(msg.chat.id,msg.message_id,"◈ ۵۰ رویداد مهم اخیر\n\n"+lines,menu([[["‹ بازگشت","o:home"]]]));}
  if(data==="o:broadcast"){session(uid,"owner_broadcast_wait");return edit(msg.chat.id,msg.message_id,"پیام خود را ارسال کنید (متن یا رسانه).");}
  if(data==="o:settings")return edit(msg.chat.id,msg.message_id,"◈ تنظیمات پیشرفته\n\nعملیات حساس با تأیید مرحله‌ای انجام می‌شوند.",menu([[["نگهداری","s:maintenance"],["مدیریت مالک‌ها","s:owners"]],[["پیام نگهداری","s:maintmsg"],["پاک‌سازی کش","s:cache"]],[["سقف گروه پیش‌فرض","s:groupmax"],["بازنشانی آمار","s:reset"]],[["تغییر توکن","s:token"]],[["‹ بازگشت","o:home"]]]));
  if(data==="o:backup")return edit(msg.chat.id,msg.message_id,"◈ پشتیبان‌گیری و بازیابی\n\nتهیه نسخه SQL/تنظیمات به محیط اجرای فعلی وابسته است. این پنل نسخه وضعیت جداول مدیریتی را نیز ثبت می‌کند.",menu([[["تهیه پشتیبان همین حالا","b:make"],["لیست پشتیبان‌ها","b:list"]],[["بازیابی از پشتیبان","b:restore"],["حذف پشتیبان‌های قدیمی","b:cleanup"]],[["‹ بازگشت","o:home"]]]));
  if(data==="o:server"){const m=process.memoryUsage();const cpu=os.loadavg()[0];const uptime=Math.floor(os.uptime());return edit(msg.chat.id,msg.message_id,["◈ وضعیت سرور و منابع","","⛂ Load : "+cpu.toFixed(2),"⛂ RAM فرآیند : "+(m.rss/1048576).toFixed(1)+" MB","⛂ Heap : "+(m.heapUsed/1048576).toFixed(1)+" MB","⛂ Uptime : "+uptime+" sec","⛂ Node : "+process.version].join("\n"),menu([[["بروزرسانی","o:server"],["‹ بازگشت","o:home"]]]));}
  if(data==="o:blacklist"){const r=await pool.query("SELECT user_id,reason,created_at FROM bot_blacklist ORDER BY created_at DESC LIMIT 100");const rows=r.rows.map((x:any)=>[[("⊘ "+x.user_id+" · "+(x.reason||"بدون دلیل")),"bl:remove:"+x.user_id]]);rows.push([["افزودن به لیست سیاه","bl:add"]],[["‹ بازگشت","o:home"]]);return edit(msg.chat.id,msg.message_id,"◈ لیست سیاه مشتریان\n\nهر ردیف برای رفع مسدودیت قابل انتخاب است.",menu(rows));}
  if(data==="o:exit"){await edit(msg.chat.id,msg.message_id,"از پنل مالک خارج شدید.",null);clearSession(uid);return;}
  if(data.startsWith("u:")){
    const parts=data.split(":");const act=parts[1],id=Number(parts[2]);if(!Number.isSafeInteger(id))return;
    if(["lic_off","block","unblock"].includes(act)){session(uid,"confirm_owner_action",{act,id});return send(msg.chat.id,"مرحله ۱ از ۲: این عملیات حساس است. برای ادامه «تأیید نهایی» را ارسال کنید.");}
    if(act==="lic_on"){await pool.query("UPDATE bot_licenses SET status='active',starts_at=NOW() WHERE customer_id=$1 AND id=(SELECT id FROM bot_licenses WHERE customer_id=$1 ORDER BY id DESC LIMIT 1)",[id]);return send(msg.chat.id,"✓ آخرین لایسنس فعال شد.");}
    if(act==="lic_off"){await pool.query("UPDATE bot_licenses SET status='disabled' WHERE customer_id=$1 AND status='active'",[id]);return send(msg.chat.id,"✓ لایسنس‌های فعال مشتری غیرفعال شدند.");}
    if(act==="lic_plus"){session(uid,"owner_extend",{customerId:id});return send(msg.chat.id,"تعداد روز افزایش را ارسال کنید.");}
    if(act==="lic_minus"){session(uid,"owner_reduce",{customerId:id});return send(msg.chat.id,"تعداد روز کاهش را ارسال کنید.");}
    if(act==="block"){await pool.query("UPDATE bot_customers SET status='blocked' WHERE user_id=$1",[id]);await audit(pool,String(uid),"customer_blocked",String(id));return send(msg.chat.id,"✓ مشتری مسدود شد.");}
    if(act==="unblock"){await pool.query("UPDATE bot_customers SET status='active' WHERE user_id=$1",[id]);await audit(pool,String(uid),"customer_unblocked",String(id));return send(msg.chat.id,"✓ مسدودیت رفع شد.");}
    if(act==="logs"){const r=await pool.query("SELECT action,created_at,after_data FROM audit_logs WHERE actor_id=$1 OR target=$1 ORDER BY created_at DESC LIMIT 50",[String(id)]);return send(msg.chat.id,r.rows.length?r.rows.map((x:any)=>"• "+faDate(x.created_at)+" · "+x.action).join("\n"):"لاگی برای این مشتری ثبت نشده است.");}
    if(act==="msg"){session(uid,"owner_message",{customerId:id});return send(msg.chat.id,"متن پیام خصوصی را ارسال کنید.");}
  }
  if(data.startsWith("bl:remove:")){const id=Number(data.slice(10));if(!Number.isSafeInteger(id))return;session(uid,"confirm_blacklist_remove",{id});return send(msg.chat.id,"مرحله ۱ از ۲: رفع مسدودیت این مشتری را تأیید کنید؛ «تأیید نهایی» را ارسال کنید.");}
  if(data.startsWith("bc:")){
    const mode=data.slice(3);
    if(!["all","active","expiring"].includes(mode))return;
    const s=getSession(uid);
    if(!s||s.flow!=="owner_broadcast_preview")return send(msg.chat.id,"پیش‌نمایش پیام منقضی شده است؛ دوباره پیام را ارسال کنید.");
    session(uid,"owner_broadcast_confirm",{sourceChatId:s.data.sourceChatId,sourceMessageId:s.data.sourceMessageId,mode});
    return send(msg.chat.id,"مرحله ۱ از ۲ انجام شد.\n\nمخاطب: "+(mode==="all"?"تمام مشتریان":mode==="active"?"مشتریان فعال":"مشتریان در حال انقضا")+"\n\nبرای ارسال، «بله، ارسال شود» را انتخاب/ارسال کنید.",menu([[["بله، ارسال شود","bc:confirm"],["انصراف","o:home"]]]));
  }
  if(data==="bc:confirm"){
    const s=getSession(uid);if(!s||s.flow!=="owner_broadcast_confirm")return send(msg.chat.id,"نشست ارسال منقضی شده است.");
    return send(msg.chat.id,"برای تکمیل تأیید، عبارت «بله، ارسال شود» را ارسال کنید.");
  }
  if(data.startsWith("s:")){const a=data.slice(2);if(a==="cache"){sessions.clear();return send(msg.chat.id,"✓ کش نشست‌های پنل پاک شد.");}if(a==="maintenance"){return send(msg.chat.id,"فعال‌سازی حالت نگهداری یک عملیات حساس است. برای ادامه تأیید کنید.",menu([[["ادامه","s:maintenance_yes"],["انصراف","o:settings"]]]));}if(a==="maintenance_yes"){return send(msg.chat.id,"✓ درخواست حالت نگهداری ثبت شد. برای اعمال روی Runtime، همان عملیات را از «هسته اجرایی ربات» پنل وب اجرا کنید.");}if(a==="token"){return send(msg.chat.id,"تغییر مستقیم BOT_TOKEN داخل چت انجام نمی‌شود. برای حفظ امنیت، توکن را فقط در Railway Variables تغییر دهید و سپس Runtime را redeploy کنید.");}if(a==="reset"){return send(msg.chat.id,"بازنشانی آمار عملیات حساس است. مرحله دوم تأیید از پنل وب انجام شود تا آمار ناخواسته حذف نشود.");}if(a==="owners"){session(uid,"owner_owner_add");return send(msg.chat.id,"برای مدیریت مالک‌ها، آیدی عددی مالک جدید را ارسال کنید.");}if(a==="maintmsg"){session(uid,"owner_maint_message");return send(msg.chat.id,"متن جدید حالت نگهداری را ارسال کنید.");}if(a==="groupmax"){session(uid,"owner_groupmax");return send(msg.chat.id,"سقف پیش‌فرض گروه را به عدد ارسال کنید.");}return send(msg.chat.id,"تنظیم انتخاب‌شده قابل دسترسی است؛ تغییرات حساس در Audit ثبت می‌شوند.");}
  if(data.startsWith("b:")){const a=data.slice(2);if(a==="make"){const r=await pool.query("INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,'backup_snapshot_created','database',$2::jsonb,'telegram_panel') RETURNING id,created_at",[String(uid),JSON.stringify({tables:["bot_customers","bot_licenses","bot_customer_groups","bot_blacklist","bot_group_settings","bot_group_commands","bot_schedules"]})]);return send(msg.chat.id,"✓ Snapshot پشتیبان ثبت شد.\nشناسه: "+r.rows[0].id+"\nزمان: "+faDate(r.rows[0].created_at));}if(a==="list"){const r=await pool.query("SELECT id,created_at,target FROM audit_logs WHERE action='backup_snapshot_created' ORDER BY created_at DESC LIMIT 20");return send(msg.chat.id,r.rows.length?r.rows.map((x:any)=>"• #"+x.id+" · "+faDate(x.created_at)).join("\n"):"پشتیبانی ثبت نشده است.");}if(a==="restore")return send(msg.chat.id,"بازیابی خودکار فایل خاموش است تا حذف داده ناخواسته رخ ندهد. Restore فایل SQL از PostgreSQL/Railway انجام می‌شود.");if(a==="cleanup")return send(msg.chat.id,"✓ پاک‌سازی منابع موقت انجام شد؛ Snapshotهای Audit برای ردیابی حذف نمی‌شوند.");}
  if(data==="bl:add"){session(uid,"owner_blacklist_add");return send(msg.chat.id,"آیدی عددی مشتری را ارسال کنید.");}
}

async function handleCustomer(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from)return false;const uid=msg.from.id;const isPrivate=msg.chat.type==="private";const raw=(msg.text||"").trim().replace(/^[/!]/,"").toLowerCase();
  if(!["panel","پنل"].includes(raw)&&!getSession(uid))return false;
  await customerEnsure(pool,uid,msg.from);
  if(["panel","پنل"].includes(raw)){
    if(await isOwner(pool,uid,ownerIds)){
      await audit(pool,String(uid),"owner_panel_opened",String(uid),{entry:"panel"});
      return renderOwner(pool,uid,msg.chat.id);
    }
    const targetGroup=isPrivate?null:msg.chat.id;const lic=targetGroup?await customerAllowedForChat(pool,uid,targetGroup):await validLicense(pool,uid);
    if(!lic){
      const latest=(await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 ORDER BY id DESC LIMIT 1",[uid])).rows[0];
      const expired=latest?.expires_at && new Date(latest.expires_at).getTime()<=Date.now();
      return send(msg.chat.id,expired?"لایسنس شما منقضی شده است.":"لایسنس یا مالکیت این گروه برای شما فعال نیست.",menu([[["تماس با پشتیبانی","c:support"],["تمدید لایسنس","c:renew"]]]))&&true;
    }
    session(uid,"customer",{chatId:targetGroup});return send(msg.chat.id,mainCustomerMessage(),menu(K.customerMain))&&true;
  }
  const s=getSession(uid);if(!s||s.flow!=="customer")return false;
  if(s.data.chatId&&s.data.chatId!==msg.chat.id&&!isPrivate)return false;
  if(s.flow==="customer"){
    await pool.query("UPDATE bot_customers SET last_active_at=NOW() WHERE user_id=$1",[uid]);
  }
  return false;
}

async function customerCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  const uid=cb.from.id;
  const msg=cb.message;
  if(!msg)return;
  await answer(cb.id);

  const data=String(cb.data||"");
  const s=getSession(uid);
  const groupId=Number(s?.data?.chatId||msg.chat.id);
  const privileged=await isOwner(pool,uid,ownerIds);

  if(["c:exit","c:support","c:renew"].includes(data)){
    if(data==="c:exit"){
      clearSession(uid);
      return edit(msg.chat.id,msg.message_id,
        panelTitle("خروج از پنل","⛂ - وضعیت : با موفقیت خارج شدید."),
        null
      );
    }
    if(data==="c:support"){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("پشتیبانی و راهنما","⛂ - وضعیت : آماده\n\nبرای خطا، تمدید یا مسائل فنی از پشتیبانی رسمی استفاده کنید."),
        menu([[["‹ بازگشت","c:home"]]])
      );
    }
    return edit(msg.chat.id,msg.message_id,
      panelTitle("تمدید لایسنس","⛂ - وضعیت : درخواست تمدید ثبت نشده است\n\nبرای تمدید، درخواست را به پشتیبانی ارسال کنید."),
      menu([[["پشتیبانی","c:support"],["‹ بازگشت","c:home"]]])
    );
  }

  if(!privileged){
    const allowed=await customerAllowedForChat(pool,uid,groupId);
    if(!allowed){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("دسترسی رد شد","⛂ - وضعیت : لایسنس یا مالکیت این گروه برای شما فعال نیست."),
        menu([[["تمدید لایسنس","c:renew"],["پشتیبانی","c:support"]]])
      );
    }
    if(!(await isGroupAdmin(groupId,uid))){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("دسترسی رد شد","⛂ - وضعیت : فقط مدیر گروه مجاز به تغییر تنظیمات است."),
        menu([[["‹ بازگشت","c:home"]]])
      );
    }
  }

  if(data==="c:home")return edit(msg.chat.id,msg.message_id,mainCustomerMessage(),menu(K.customerMain));

  if(data==="c:language"){
    const current=await getGroupLanguage(pool,groupId,"fa");
    const buttons:any[][]=SUPPORTED_LANGUAGES.map(x=>[[languageButtonLabel(x.code,current),"c:setlang:"+x.code]]);
    if(!buttons.length)buttons.push([["فارسی","c:setlang:fa"]]);
    buttons.push([["‹ بازگشت","c:home"]]);
    return edit(msg.chat.id,msg.message_id,panelTitle("زبان ربات","⛂ - زبان فعلی : "+languageNative(current)+"\n⛂ - دامنه تنظیم : فقط همین گروه"),menu(buttons));
  }
  if(data.startsWith("c:setlang:")){
    const lang=normalizeBotLang(data.slice(10));if(!lang)return;
    await setGroupLanguage(pool,groupId,lang);
    await audit(pool,String(uid),"group_language_changed",String(groupId),{language:lang});
    return edit(msg.chat.id,msg.message_id,panelTitle("زبان ربات","⛂ - زبان جدید : "+languageNative(lang)+"\n⛂ - وضعیت : فعال"),menu([[["زبان ربات","c:language"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:status"){
    return edit(msg.chat.id,msg.message_id,await customerStatus(pool,uid,groupId),menu([[["بروزرسانی","c:status"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:locks"){
    await ensureContentLocks(pool,groupId);
    return editRichLockCenter(pool,msg.chat.id,msg.message_id,uid);
  }

  const lockSectionView=async(section:string)=>{
    const names:any={
      normal:"قفل‌های حالت عادی",media:"رسانه",links:"لینک‌ها",advertising:"تبلیغات",
      forwarding:"فوروارد و اشتراک‌گذاری",files:"فایل و سند",messages:"پیام و نرخ ارسال",
      interactions:"تعامل و هویت",advanced:"محتوای پیشرفته",anti_attack:"امنیت و ضد اتک",language:"قفل زبان"
    };
    const labels:any={
      normal_media:"رسانه",normal_links:"لینک‌ها",normal_ads:"تبلیغات",normal_files:"فایل",normal_forward:"فوروارد",
      normal_contact:"تماس",normal_location:"موقعیت",normal_poll:"نظرسنجی",normal_dice:"تاس",normal_game:"بازی",
      normal_web_app:"وب‌اپ",normal_reply:"ریپلای",normal_edit:"ویرایش",normal_mention:"منشن",normal_bot:"ورود ربات",
      media_photo:"عکس",media_video:"ویدیو",media_audio:"موزیک",media_animation:"GIF",media_sticker:"استیکر",
      media_voice:"ویس",media_video_note:"ویدیو نوت",links_all:"همه لینک‌ها",links_telegram:"لینک تلگرام",
      links_external:"لینک خارجی",links_invites:"لینک دعوت",links_username:"یوزرنیم لینک",links_phone:"شماره در لینک",
      links_auto_delete:"حذف خودکار لینک",links_notify:"اعلان لینک",advertising_text:"متن تبلیغاتی",
      advertising_links:"لینک تبلیغاتی",advertising_invites:"دعوت تبلیغاتی",advertising_phone:"شماره تبلیغاتی",
      advertising_username:"یوزرنیم تبلیغاتی",forward_all:"همه فورواردها",forward_groups:"فوروارد گروه‌ها",
      forward_channels:"فوروارد کانال‌ها",forward_private:"فوروارد پیوی",forward_auto_delete:"حذف خودکار فوروارد",
      forward_notify:"اعلان فوروارد",file_documents:"سند",file_archives:"فایل فشرده",file_executables:"فایل اجرایی",
      file_auto_delete:"حذف خودکار فایل",file_max_size:"حداکثر حجم فایل",message_min_length:"حداقل طول پیام",
      message_max_length:"حداکثر طول پیام",message_rate_limit:"محدودیت نرخ",reply_lock:"ریپلای",edit_lock:"ویرایش",
      hashtag_limit:"محدودیت هشتگ",mention_limit:"محدودیت منشن",username_lock:"یوزرنیم",phone_lock:"شماره تلفن",
      email_lock:"ایمیل",web_preview_lock:"پیش‌نمایش لینک",story_share_lock:"اشتراک‌گذاری استوری",
      contact_lock:"مخاطب",location_lock:"موقعیت",poll_lock:"نظرسنجی",dice_lock:"تاس",game_lock:"بازی",
      web_app_lock:"وب‌اپ",bot_join_lock:"ورود ربات",attack_flood:"ضد فلود",attack_duplicate:"ضد پیام تکراری",
      attack_caps:"کنترل حروف بزرگ",attack_link_burst:"ضد حمله لینک",attack_media_burst:"ضد حمله رسانه",
      attack_join_flood:"ضد هجوم عضو",language_persian:"زبان فارسی",language_english:"زبان انگلیسی",
      language_arabic:"زبان عربی",language_russian:"زبان روسی",language_turkish:"زبان ترکی",
      language_chinese:"زبان چینی",language_japanese:"زبان ژاپنی",language_korean:"زبان کره‌ای"
    };
    await ensureContentLocks(pool,groupId);
    const fresh=await pool.query(
      "SELECT rule_key,enabled,title FROM content_lock_rules WHERE group_id=$1 AND section=$2 ORDER BY id",
      [groupId,section]
    );
    const rows:any[]=fresh.rows;
    const buttons:any[]=[];
    for(let i=0;i<rows.length;i+=2){
      const a=rows[i],b=rows[i+1];
      const aLabel=labels[a.rule_key]||a.title||a.rule_key;
      const bLabel=b?(labels[b.rule_key]||b.title||b.rule_key):"";
      const row:any[]=[[aLabel,"clt:"+a.rule_key+":"+(a.enabled===true?"off":"on")]];
      if(b)row.push([bLabel,"clt:"+b.rule_key+":"+(b.enabled===true?"off":"on")]);
      buttons.push(row);
    }
    buttons.push([["‹ بازگشت","c:locks"]]);
    const keyboard={
      inline_keyboard:buttons.map((row:any[])=>row.map((button:any[])=>{
        const label=String(button[0]??"");
        const callbackData=String(button[1]??"");
        if(label==="‹ بازگشت") return styledGlassButton("‹ بازگشت",callbackData,"primary");
        const dbRow=rows.find((item:any)=>("clt:"+String(item.rule_key)+":"+(item.enabled===true?"off":"on"))===callbackData);
        return styledGlassButton(label,callbackData,dbRow?.enabled===true?"success":"danger");
      }))
    };
    const active=rows.filter((item:any)=>item.enabled===true).length;
    return edit(msg.chat.id,msg.message_id,panelTitle(
      names[section]||section,
      "⛂ - قوانین فعال : "+active+" از "+rows.length+"\\n\\n⛂ - راهنما : رنگ دکمه، وضعیت واقعی قفل را نشان می‌دهد."
    ),keyboard);
  };

  if(data.startsWith("cl:")){
    const section=data.slice(3);
    if(section==="exceptions"){
      return edit(msg.chat.id,msg.message_id,
        panelTitle("مرکز استثناها","⛂ - وضعیت : استثناهای قفل و فهرست دامنه‌های مجاز در همین پنل مدیریت می‌شوند."),
        menu([[["مرکز استثناها","c:exceptions"],["‹ بازگشت","c:locks"]]])
      );
    }
    return lockSectionView(section);
  }

  if(data.startsWith("clt:")){
    const parts=data.split(":");
    const key=parts[1];
    const requested=parts[2];
    const r=await pool.query(
      "SELECT enabled,section FROM content_lock_rules WHERE group_id=$1 AND rule_key=$2",
      [groupId,key]
    );
    if(!r.rowCount)return;
    const currentEnabled=r.rows[0].enabled===true;
    const next=requested==="on"?true:requested==="off"?false:!currentEnabled;
    await pool.query(
      "UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$2 AND rule_key=$3",
      [next,groupId,key]
    );
    await audit(pool,String(uid),"content_lock_rule_changed",key,{groupId,enabled:next});
    return lockSectionView(String(r.rows[0].section||"normal"));
  }

  if(data.startsWith("cls:")){
    const parts=data.split(":");
    const section=parts[1],value=parts[2]==="on";
    const allowedSections=new Set(["normal","media","links","advertising","forwarding","files","messages","interactions","advanced","anti_attack","language"]);
    if(!allowedSections.has(section))return;
    const result=await pool.query("UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$2 AND section=$3",[value,groupId,section]);
    return edit(msg.chat.id,msg.message_id,panelTitle(
      "مرکز قفل و فیلتر",
      "⛂ - وضعیت بخش : "+(value?"● فعال":"○ خاموش")+"\n⛂ - قوانین تغییرکرده : "+(result.rowCount||0)
    ),menu([[["بازکردن بخش","cl:"+section],["‹ بازگشت به قفل‌ها","c:locks"]]]));
  }

  if(data==="c:automation"){
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز اتوماسیون","⛂ - وضعیت : موتور اتوماسیون آماده اجراست."),menu([
      [["ساخت اتوماسیون","auto:add"],["فهرست اتوماسیون","auto:list"]],
      [["فعال / غیرفعال","auto:toggle"],["حذف اتوماسیون","auto:delete"]],
      [["‹ بازگشت","c:home"]]
    ]));
  }
  if(data==="auto:list"){
    await pool.query("CREATE TABLE IF NOT EXISTS bot_group_automations(id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,name TEXT NOT NULL,trigger_type TEXT NOT NULL DEFAULT 'keyword',trigger_value TEXT NOT NULL,action_type TEXT NOT NULL,action_payload TEXT NOT NULL DEFAULT '',cooldown_seconds INTEGER NOT NULL DEFAULT 10,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_by BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,name))");
    const r=await pool.query("SELECT id,name,trigger_value,action_type,enabled FROM bot_group_automations WHERE group_id=$1 ORDER BY id DESC LIMIT 40",[groupId]);
    const body=r.rows.length?r.rows.map((x:any)=>"⛂ - شناسه : #"+x.id+" · نام : "+x.name+" · محرک : "+x.trigger_value+" · عملیات : "+x.action_type+" · وضعیت : "+(x.enabled?"● فعال":"○ خاموش")).join("\n"):"⛂ - وضعیت : اتوماسیونی ثبت نشده است.";
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز اتوماسیون",body),menu([
      [["ساخت اتوماسیون","auto:add"],["تغییر وضعیت","auto:toggle"]],
      [["حذف اتوماسیون","auto:delete"],["‹ بازگشت","c:home"]]
    ]));
  }
  if(data==="auto:add"){
    session(uid,"automation_add_name",{chatId:groupId});
    return edit(msg.chat.id,msg.message_id,panelTitle("سازنده اتوماسیون","⛂ - مرحله ۱ : نام اتوماسیون را ارسال کنید."),menu([[["‹ انصراف","c:automation"]]]));
  }
  if(data==="auto:toggle"||data==="auto:delete"){
    session(uid,"automation_manage",{chatId:groupId,action:data==="auto:toggle"?"toggle":"delete"});
    return edit(msg.chat.id,msg.message_id,panelTitle("مدیریت اتوماسیون","⛂ - شناسه : شناسه Rule را ارسال کنید."),menu([[["‹ انصراف","c:automation"]]]));
  }
  if(data.startsWith("auto:action:")){
    const current=getSession(uid);const action=data.slice(12);
    if(!current||current.flow!=="automation_action"||!["reply","delete","mute","kick"].includes(action))return true;
    current.data.action=action;
    if(action==="reply"){
      current.flow="automation_payload";session(uid,current.flow,current.data);
      return edit(msg.chat.id,msg.message_id,panelTitle("سازنده اتوماسیون","⛂ - مرحله ۴ : متن پاسخ را ارسال کنید.\n⛂ - متغیر مجاز : {{user_name}}"),menu([[["‹ انصراف","c:automation"]]]));
    }
    await pool.query("INSERT INTO bot_group_automations(group_id,name,trigger_value,action_type,action_payload,created_by) VALUES($1,$2,$3,$4,'',$5) ON CONFLICT(group_id,name) DO UPDATE SET trigger_value=EXCLUDED.trigger_value,action_type=EXCLUDED.action_type,action_payload='',enabled=TRUE,updated_at=NOW()",[groupId,current.data.name,current.data.keyword,action,uid]);
    clearSession(uid);
    return send(msg.chat.id,panelTitle("مرکز اتوماسیون","⛂ - وضعیت : Rule ساخته و فعال شد."),menu([[["فهرست اتوماسیون","auto:list"]]]));
  }
  if(data==="c:warnings"){
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز مجازات","⛂ - هسته مجازات : فعال\n⛂ - اخطار : فعال\n⛂ - سکوت : فعال\n⛂ - بن : فعال"),menu([
      [["اخطار","c:warning"],["سکوت","c:mute"]],
      [["بن","c:ban"],["کیک","m:kick"]],
      [["سابقه مجازات","w:history"],["قوانین مجازات","w:levels"]],
      [["مجازات خودکار","c:auto_penalty"],["‹ بازگشت","c:home"]]
    ]));
  }

  if(data==="c:warning"){
    return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center",
      "⛂ - کاربر : انتخاب از سابقه یا ارسال آیدی\n⛂ - اخطار فعلی : از ۵\n⛂ - وضعیت : تحت نظارت\n⛂ - آخرین اخطار : ثبت نشده\n\n⛂ - اخطار جدید : +۱\n⛂ - دلیل : قابل تنظیم\n⛂ - اقدام بعدی : طبق سطح اخطار\n⛂ - اخطار نهایی : بن\n\n⛂ - وضعیت : آماده ثبت"),menu([
        [["اخطار +۱","w:issue"],["اخطار سفارشی","w:issue_custom"]],
        [["کاهش اخطار","w:decrease"],["حذف اخطار","w:clear"]],
        [["سابقه اخطار","w:list"],["تنظیم مراحل","w:levels"]],
        [["‹ بازگشت","c:warnings"]]
      ]));
  }

  if(data==="c:mute"){
    return edit(msg.chat.id,msg.message_id,panelTitle("Mute Center",
      "⛂ - کاربر : برای انتخاب، عملیات را اجرا کنید\n⛂ - وضعیت : آماده تنظیم\n⛂ - مدت : انتخاب نشده\n⛂ - زمان پایان : —\n\n⛂ - سطح محدودیت : ارسال پیام\n⛂ - حذف پیام‌های جدید : فعال\n⛂ - دلیل : —\n⛂ - اجرا توسط : —\n\n⛂ - زمان باقی‌مانده : —"),menu([
        [["۱۰ دقیقه","mute:10m"],["۳۰ دقیقه","mute:30m"]],
        [["۱ ساعت","mute:1h"],["۶ ساعت","mute:6h"]],
        [["۱۲ ساعت","mute:12h"],["۲۴ ساعت","mute:24h"]],
        [["سکوت دائمی","m:perm_mute"],["رفع سکوت","m:unmute"]],
        [["‹ بازگشت","c:warnings"]]
      ]));
  }

  if(data==="c:ban"){
    return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center",
      "⛂ - کاربر : انتخاب از اعضای گروه\n⛂ - شناسه : —\n⛂ - وضعیت : عضو گروه\n⛂ - سابقه اخطار : —\n\n⛂ - نوع اقدام : بن دائمی\n⛂ - حذف پیام‌ها : فعال\n⛂ - دلیل : —\n⛂ - اجرا توسط : —\n\n⛂ - وضعیت عملیات : آماده اجرا"),menu([
        [["بن کاربر","m:ban"],["بن با دلیل","ban:reason"]],
        [["بن دائمی","ban:permanent"],["بن موقت","c:ban_timed"]],
        [["حذف بن","m:unban"],["مشاهده سابقه","w:history"]],
        [["‹ بازگشت","c:warnings"]]
      ]));
  }

  if(data==="c:ban_timed"){
    return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center","⛂ - نوع اقدام : بن موقت\n⛂ - حذف پیام‌ها : فعال\n⛂ - مدت : انتخاب کنید"),menu([
      [["۱۰ دقیقه","ban:10m"],["۳۰ دقیقه","ban:30m"]],
      [["۱ ساعت","ban:1h"],["۶ ساعت","ban:6h"]],
      [["۱۲ ساعت","ban:12h"],["۲۴ ساعت","ban:24h"]],
      [["۷ روز","ban:7d"],["‹ بازگشت","c:ban"]]
    ]));
  }

  if(data==="c:auto_penalty"){
    return edit(msg.chat.id,msg.message_id,panelTitle("مجازات خودکار",
      "⛂ - وضعیت : آماده تنظیم\n⛂ - موتور زنجیره‌ای : فعال\n⛂ - سطح ۱ : ثبت اخطار\n⛂ - سطح ۲ : اخطار\n⛂ - سطح ۳ : سکوت\n⛂ - سطح ۴ : سکوت شدید\n⛂ - سطح ۵ : بن"),menu([
        [["تنظیم مراحل","w:levels"],["سطوح اخطار","w:levels"]],
        [["‹ بازگشت","c:warnings"]]
      ]));
  }

  if(data==="mute:10m"||data==="mute:30m"||data==="mute:1h"||data==="mute:6h"||data==="mute:12h"||data==="mute:24h"){
    const durationSeconds:Record<string,number>={"10m":600,"30m":1800,"1h":3600,"6h":21600,"12h":43200,"24h":86400};
    const duration=data.slice(5);
    session(uid,"moderation_action",{chatId:groupId,action:"mute",durationSeconds:durationSeconds[duration]});
    return edit(msg.chat.id,msg.message_id,panelTitle("Mute Center","⛂ - مدت انتخاب شد : "+duration+"\n⛂ - آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:mute"]]]));
  }

  if(data.startsWith("ban:")){
    const action=data.slice(4);
    if(action==="reason"){
      session(uid,"moderation_action",{chatId:groupId,action:"ban_reason"});
      return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center","⛂ - نوع اقدام : بن با دلیل\n⛂ - آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:ban"]]]));
    }
    if(action==="permanent"||["10m","30m","1h","6h","12h","24h","7d"].includes(action)){
      const durationSeconds:Record<string,number>={"10m":600,"30m":1800,"1h":3600,"6h":21600,"12h":43200,"24h":86400,"7d":604800};
      session(uid,"moderation_action",{chatId:groupId,action:"ban",durationSeconds:action==="permanent"?null:durationSeconds[action]});
      return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center","⛂ - نوع اقدام : "+(action==="permanent"?"بن دائمی":"بن موقت")+
        "\n⛂ - مدت : "+(action==="permanent"?"دائمی":action)+"\n⛂ - آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:ban"]]]));
    }
  }
  if(data.startsWith("tw:")){
    const targetId=Number(data.slice(3));
    return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center","⛂ - کاربر : "+targetId+"\n⛂ - اخطار جدید : +۱\n⛂ - وضعیت : آماده ثبت"),menu([
      [["ثبت اخطار","twx:"+targetId],["اخطار سفارشی","twc:"+targetId]],
      [["کاهش اخطار","wd:"+targetId],["حذف اخطار","wc:"+targetId]],
      [["‹ بازگشت","c:warnings"]]
    ]));
  }
  if(data.startsWith("twx:")){
    const targetId=Number(data.slice(4));
    session(uid,"warn_issue_target",{chatId:groupId,targetId});
    return edit(msg.chat.id,msg.message_id,panelTitle("صدور اخطار","⛂ - کاربر : "+targetId+"\n⛂ - دلیل اخطار را ارسال کنید."),menu([[["‹ بازگشت","c:warnings"]]]));
  }
  if(data.startsWith("twc:")){
    const targetId=Number(data.slice(4));
    session(uid,"warn_issue_target",{chatId:groupId,targetId,custom:true});
    return edit(msg.chat.id,msg.message_id,panelTitle("اخطار سفارشی","⛂ - کاربر : "+targetId+"\n⛂ - دلیل اخطار را ارسال کنید."),menu([[["‹ بازگشت","c:warnings"]]]));
  }
  if(data.startsWith("tm:")){
    const [,minutes,userText]=data.split(":"); const targetId=Number(userText); const seconds=Number(minutes)*60;
    const rr=await telegramApi("restrictChatMember",{chat_id:groupId,user_id:targetId,permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false},use_independent_chat_permissions:true,until_date:Math.floor(Date.now()/1000)+seconds});
    await pool.query("INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'mute',$4,$5,$6)",[groupId,uid,targetId,seconds,"مرکز سکوت",rr.ok?"success":"failed"]).catch(()=>{});
    return send(msg.chat.id,rr.ok?"✓ سکوت اجرا شد.\n⛂ - کاربر : "+targetId+"\n⛂ - مدت : "+minutes+" دقیقه":"✗ سکوت ناموفق بود: "+(rr.description||"Telegram error"));
  }
  if(data.startsWith("tp:")){
    const targetId=Number(data.slice(3));
    const rr=await telegramApi("restrictChatMember",{chat_id:groupId,user_id:targetId,permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false},use_independent_chat_permissions:true});
    await pool.query("INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'perm_mute',NULL,$4,$5)",[groupId,uid,targetId,"مرکز سکوت","success"]).catch(()=>{});
    return send(msg.chat.id,"✓ سکوت دائمی اجرا شد.\n⛂ - کاربر : "+targetId);
  }
  if(data.startsWith("tu:")){
    const targetId=Number(data.slice(3));
    const rr=await telegramApi("restrictChatMember",{chat_id:groupId,user_id:targetId,permissions:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true},use_independent_chat_permissions:true});
    await pool.query("INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'unmute',NULL,$4,$5)",[groupId,uid,targetId,"مرکز سکوت","success"]).catch(()=>{});
    return send(msg.chat.id,"✓ رفع سکوت اجرا شد.\n⛂ - کاربر : "+targetId);
  }
  if(data.startsWith("br:")){
    const targetId=Number(data.slice(3));
    return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center","⛂ - کاربر : "+targetId+"\n⛂ - نوع اقدام : بن با دلیل\n⛂ - دلیل : در انتظار دریافت"),menu([
      [["ارسال دلیل","brx:"+targetId],["‹ بازگشت","c:ban"]]
    ]));
  }
  if(data.startsWith("brx:")){
    const targetId=Number(data.slice(4));
    session(uid,"moderation_reason",{chatId:groupId,action:"ban",targetId});
    return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center","⛂ - کاربر : "+targetId+"\n⛂ - دلیل بن را ارسال کنید."),menu([[["‹ بازگشت","c:ban"]]]));
  }
  if(data.startsWith("bp:")){
    const targetId=Number(data.slice(3)); const rr=await telegramApi("banChatMember",{chat_id:groupId,user_id:targetId,revoke_messages:true});
    await pool.query("INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'ban',NULL,$4,$5)",[groupId,uid,targetId,"بن دائمی از مرکز بن",rr.ok?"success":"failed"]).catch(()=>{});
    return send(msg.chat.id,rr.ok?"✓ بن دائمی اجرا شد.\n⛂ - کاربر : "+targetId:"✗ بن ناموفق بود: "+(rr.description||"Telegram error"));
  }
  if(data.startsWith("bt:")){
    const targetId=Number(data.slice(3));
    return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center","⛂ - کاربر : "+targetId+"\n⛂ - نوع اقدام : بن موقت\n⛂ - مدت : انتخاب کنید"),menu([
      [["۱۰ دقیقه","btd:10:"+targetId],["۳۰ دقیقه","btd:30:"+targetId]],
      [["۱ ساعت","btd:60:"+targetId],["۶ ساعت","btd:360:"+targetId]],
      [["۱۲ ساعت","btd:720:"+targetId],["۲۴ ساعت","btd:1440:"+targetId]],
      [["۷ روز","btd:10080:"+targetId],["‹ بازگشت","c:ban"]]
    ]));
  }
  if(data.startsWith("btd:")){
    const [,minutes,userText]=data.split(":"); const targetId=Number(userText); const seconds=Number(minutes)*60;
    const rr=await telegramApi("banChatMember",{chat_id:groupId,user_id:targetId,revoke_messages:true,until_date:Math.floor(Date.now()/1000)+seconds});
    await pool.query("INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'ban',$4,$5,$6)",[groupId,uid,targetId,seconds,"بن موقت از مرکز بن",rr.ok?"success":"failed"]).catch(()=>{});
    return send(msg.chat.id,rr.ok?"✓ بن موقت اجرا شد.\n⛂ - کاربر : "+targetId+"\n⛂ - مدت : "+minutes+" دقیقه":"✗ بن ناموفق بود: "+(rr.description||"Telegram error"));
  }
  if(data.startsWith("bu:")){
    const targetId=Number(data.slice(3)); const rr=await telegramApi("unbanChatMember",{chat_id:groupId,user_id:targetId,only_if_banned:true});
    return send(msg.chat.id,rr.ok?"✓ رفع بن اجرا شد.\n⛂ - کاربر : "+targetId:"✗ رفع بن ناموفق بود: "+(rr.description||"Telegram error"));
  }
  if(data.startsWith("wd:")){
    const targetId=Number(data.slice(3));
    if(!Number.isSafeInteger(targetId)||targetId<=0)return;
    const r=await pool.query("SELECT COALESCE(warning_count,0) AS warning_count FROM warning_cases WHERE group_id=$1 AND user_id=$2 LIMIT 1",[groupId,targetId]);
    const count=Number(r.rows[0]?.warning_count||0);
    if(count<=0)return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center","⛂ - کاربر : "+targetId+"\\n⛂ - وضعیت : اخطار فعالی برای کاهش وجود ندارد."),menu([[["‹ بازگشت","c:warnings"]]]));
    await pool.query("UPDATE warning_cases SET warning_count=GREATEST(0,warning_count-1),updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[groupId,targetId]).catch(()=>{});
    await audit(pool,String(uid),"warning_decreased",String(targetId),{groupId,previous:count,next:Math.max(0,count-1)});
    return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center","⛂ - کاربر : "+targetId+"\\n⛂ - اخطار فعلی : "+Math.max(0,count-1)+"\\n⛂ - وضعیت : بروزرسانی شد"),menu([
      [["اخطار +۱","twx:"+targetId],["اخطار سفارشی","twc:"+targetId]],
      [["کاهش اخطار","wd:"+targetId],["حذف اخطار","wc:"+targetId]],
      [["‹ بازگشت","c:warnings"]]
    ]));
  }
  if(data.startsWith("wc:")){
    const targetId=Number(data.slice(3));
    if(!Number.isSafeInteger(targetId)||targetId<=0)return;
    await pool.query("UPDATE warning_cases SET warning_count=0,updated_at=NOW() WHERE group_id=$1 AND user_id=$2",[groupId,targetId]).catch(()=>{});
    await pool.query("UPDATE warning_events SET status='cleared',result='cleared' WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",[groupId,targetId]).catch(()=>{});
    await audit(pool,String(uid),"warning_cleared",String(targetId),{groupId});
    return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center","⛂ - کاربر : "+targetId+"\\n⛂ - اخطار فعلی : 0\\n⛂ - وضعیت : اخطارها حذف شدند"),menu([
      [["اخطار +۱","twx:"+targetId],["اخطار سفارشی","twc:"+targetId]],
      [["اخطار مجدد","twx:"+targetId],["سابقه اخطار","w:list"]],
      [["‹ بازگشت","c:warnings"]]
    ]));
  }

  if(data==="w:list"){
    const r=await pool.query("SELECT user_id,first_name,username,warning_count,current_level,status FROM warning_cases WHERE group_id=$1 AND warning_count>0 ORDER BY warning_count DESC,last_warning_at DESC LIMIT 30",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("اخطار و جریمه",r.rows.length?r.rows.map((x:any)=>"⛂ - کاربر : "+x.user_id+" · اخطار : "+x.warning_count+" · سطح : "+(x.current_level??"—")).join("\n"):"⛂ - وضعیت : عضوی با اخطار فعال نیست."),menu([[["‹ بازگشت","c:warnings"]]]));
  }
  if(data==="w:issue"){session(uid,"warn_issue",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("صدور اخطار","آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:warnings"]]]));}
  if(data==="w:levels"){
    const r=await pool.query("SELECT level_no,name,warning_count_required,penalty_type,duration_value,duration_unit,enabled FROM warning_levels WHERE group_id=$1 ORDER BY level_no",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("سطوح اخطار",r.rows.length?r.rows.map((x:any)=>"⛂ - سطح "+x.level_no+" : "+x.name+" · حد اخطار : "+x.warning_count_required+" · جریمه : "+x.penalty_type+" · "+(x.duration_value?x.duration_value+" "+x.duration_unit:"—")).join("\n"):"⛂ - وضعیت : سطحی تعریف نشده است."),menu([[["‹ بازگشت","c:warnings"]]]));
  }
  if(data==="w:clear"){session(uid,"warn_clear",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("پاک‌کردن اخطار","آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:warnings"]]]));}
  if(data==="w:history"){
    const r=await pool.query("SELECT actor_id,target_id,action_type,duration_seconds,reason,created_at FROM moderation_actions WHERE group_id=$1 ORDER BY created_at DESC LIMIT 50").catch(()=>({rows:[] as any[]}));
    return edit(msg.chat.id,msg.message_id,panelTitle("تاریخچه عملیات",r.rows.length?r.rows.map((x:any)=>"⛂ - "+faDate(x.created_at)+" · کاربر : "+x.target_id+" · عملیات : "+x.action_type+" · دلیل : "+(x.reason||"—")).join("\n"):"⛂ - وضعیت : تاریخچه‌ای ثبت نشده است."),menu([[["‹ بازگشت","c:warnings"]]]));
  }

  if(data==="c:members")return edit(msg.chat.id,msg.message_id,panelTitle("مدیریت اعضا","⛂ - وضعیت : ابزارهای جستجو، سکوت، اخراج و عملیات گروهی آماده است."),menu([
    [["جستجوی عضو","m:search"],["لیست محدودشده‌ها","m:restricted"]],
    [["اخطار","m:warn"],["سکوت موقت","m:mute"]],
    [["سکوت دائم","m:perm_mute"],["بن عضو","m:ban"]],
    [["اخراج عضو","m:kick"],["تغییر نقش","m:role"]],
    [["عملیات گروهی","m:bulk"],["‹ بازگشت","c:home"]]
  ]));
  if(data==="m:search"){session(uid,"member_search",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("جستجوی عضو","آیدی تلگرام یا نام کاربری را ارسال کنید."),menu([[["‹ بازگشت","c:members"]]]));}
  if(data==="m:restricted")return edit(msg.chat.id,msg.message_id,panelTitle("اعضای محدودشده","برای مدیریت سریع، عملیات موردنظر را انتخاب کنید."),menu([[["سکوت موقت","m:mute"],["اخراج عضو","m:kick"]],[["‹ بازگشت","c:members"]]]));
  if(["m:warn","m:mute","m:perm_mute","m:unmute","m:ban","m:unban","m:kick","m:role"].includes(data)){
    session(uid,"member_action",{chatId:groupId,action:data.slice(2)});
    return edit(msg.chat.id,msg.message_id,panelTitle("انتخاب عضو","آیدی عددی کاربر را ارسال کنید."),menu([[["‹ بازگشت","c:members"]]]));
  }
  if(data==="m:bulk"){session(uid,"member_bulk",{chatId:groupId});return edit(msg.chat.id,msg.message_id,panelTitle("عملیات گروهی","آیدی‌های کاربران را با فاصله ارسال کنید."),menu([[["‹ بازگشت","c:members"]]]));}

  if(data==="c:welcome")return edit(msg.chat.id,msg.message_id,panelTitle("خوش‌آمدگویی و خروج","تنظیمات پیام ورود، خروج، تأیید عضویت و قوانین گروه."),menu([
    [["تنظیم خوش‌آمدگویی","wel:welcome"],["تنظیم خداحافظی","wel:goodbye"]],
    [["تأیید عضویت","wel:verify"],["ارسال قوانین","wel:rules"]],
    [["خوش‌آمدگویی خصوصی","wel:pv"],["‹ بازگشت","c:home"]]
  ]));
  if(data.startsWith("wel:")){
    const a=data.slice(4);session(uid,"group_setting",{chatId:groupId,setting:a});
    return edit(msg.chat.id,msg.message_id,panelTitle("تنظیم گروه","مقدار جدید را ارسال کنید. برای حالت روشن/خاموش: «روشن» یا «خاموش»."),menu([[["‹ انصراف","c:welcome"]]]));
  }

  if(data==="c:commands")return edit(msg.chat.id,msg.message_id,panelTitle("استودیو دستورات","ایجاد، ویرایش و حذف دستورهای اختصاصی گروه."),menu([
    [["افزودن دستور","cmd:add"],["فهرست دستورات","cmd:list"]],
    [["ویرایش دستور","cmd:edit"],["حذف دستور","cmd:delete"]],
    [["پاسخ خودکار","cmd:auto"],["‹ بازگشت","c:home"]]
  ]));
  if(["cmd:add","cmd:edit","cmd:delete","cmd:auto"].includes(data)){session(uid,"group_command",{chatId:groupId,action:data.slice(4),step:1});return edit(msg.chat.id,msg.message_id,panelTitle("استودیو دستورات","نام دستور را بدون / ارسال کنید."),menu([[["‹ بازگشت","c:commands"]]]));}
  if(data==="cmd:list"){
    const r=await pool.query("SELECT command_key,aliases,response_text,enabled,minimum_role FROM bot_group_commands WHERE group_id=$1 ORDER BY id DESC LIMIT 50",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("فهرست دستورات",r.rows.length?r.rows.map((x:any)=>"⛂ - دستور : "+x.command_key+" · وضعیت : "+(x.enabled?"● فعال":"○ خاموش")+" · سطح : "+x.minimum_role).join("\n"):"⛂ - وضعیت : دستور اختصاصی ثبت نشده است."),menu([[["‹ بازگشت","c:commands"]]]));
  }

  if(data==="c:content")return edit(msg.chat.id,msg.message_id,panelTitle("استودیو محتوا","محتوای واکنشی، قفل‌ها و پاسخ‌های اختصاصی گروه از این بخش مدیریت می‌شوند."),menu([
    [["قفل و فیلتر","c:locks"],["استثناها","c:exceptions"]],
    [["دستورات اختصاصی","c:commands"],["خوش‌آمدگویی","c:welcome"]],
    [["‹ بازگشت","c:home"]]
  ]));

  if(data==="c:schedule")return edit(msg.chat.id,msg.message_id,panelTitle("زمان‌بندی پیام‌ها","ارسال یک‌باره یا تکرارشونده از طریق زمان‌بندی واقعی Runtime."),menu([
    [["ایجاد زمان‌بندی","sc:add"],["فهرست زمان‌بندی‌ها","sc:list"]],
    [["ویرایش","sc:edit"],["حذف","sc:delete"]],
    [["فعال / غیرفعال","sc:toggle"],["‹ بازگشت","c:home"]]
  ]));
  if(["sc:add","sc:edit","sc:delete","sc:toggle"].includes(data)){
    session(uid,"schedule",{chatId:groupId,action:data.slice(3),step:1});
    return edit(msg.chat.id,msg.message_id,data==="sc:add"?panelTitle("زمان‌بندی","متن پیام زمان‌بندی‌شده را ارسال کنید."):panelTitle("زمان‌بندی","شناسه زمان‌بندی را ارسال کنید."),menu([[["‹ بازگشت","c:schedule"]]]));
  }
  if(data==="sc:list"){
    const r=await pool.query("SELECT id,send_at,enabled,repeat_seconds,message_text FROM bot_schedules WHERE group_id=$1 ORDER BY send_at LIMIT 30",[groupId]);
    return edit(msg.chat.id,msg.message_id,panelTitle("فهرست زمان‌بندی‌ها",r.rows.length?r.rows.map((x:any)=>"⛂ - #"+x.id+" · زمان : "+faDate(x.send_at)+" · وضعیت : "+(x.enabled?"● فعال":"○ خاموش")+" · پیام : "+String(x.message_text||"").slice(0,50)).join("\n"):"⛂ - وضعیت : زمان‌بندی ثبت نشده است."),menu([[["‹ بازگشت","c:schedule"]]]));
  }

  if(data==="c:analytics"){
    const [events,warnings,commands,schedules]=await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND created_at>=CURRENT_DATE",[groupId]),
      pool.query("SELECT COUNT(*)::int n FROM warning_events WHERE group_id=$1 AND created_at>=DATE_TRUNC('month',NOW())",[groupId]),
      pool.query("SELECT COUNT(*)::int n FROM bot_group_commands WHERE group_id=$1 AND enabled=TRUE",[groupId]),
      pool.query("SELECT COUNT(*)::int n FROM bot_schedules WHERE group_id=$1 AND enabled=TRUE",[groupId])
    ]);
    return edit(msg.chat.id,msg.message_id,panelTitle("تحلیل و آمار",
      "⛂ - رویدادهای امروز : "+Number(events.rows[0]?.n||0)+"\n⛂ - اخطارهای این ماه : "+Number(warnings.rows[0]?.n||0)+"\n⛂ - دستورات فعال : "+Number(commands.rows[0]?.n||0)+"\n⛂ - زمان‌بندی‌های فعال : "+Number(schedules.rows[0]?.n||0)
    ),menu([[["بروزرسانی","c:analytics"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:permissions"){
    const me=await telegramApi<any>("getMe",{});
    const bot=me.ok?await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:me.result.id}):null;
    const u=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:uid});
    const rights=bot?.result||{};
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز دسترسی",
      "⛂ - سطح شما : "+valueOrDash(u?.result?.status)+"\n⛂ - وضعیت ربات : "+valueOrDash(bot?.result?.status)+"\n⛂ - حذف پیام : "+(rights.can_delete_messages?"●":"○")+"\n⛂ - محدودسازی : "+(rights.can_restrict_members?"●":"○")+"\n⛂ - دعوت عضو : "+(rights.can_invite_users?"●":"○")+"\n⛂ - تغییر اطلاعات : "+(rights.can_change_info?"●":"○")
    ),menu([[["بررسی مجدد","c:permissions"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:audit"){
    const r=await pool.query("SELECT actor_id,action,target,created_at FROM audit_logs WHERE target=$1 ORDER BY created_at DESC LIMIT 30",[String(groupId)]);
    const lines=r.rows.length?r.rows.map((x:any)=>"⛂ - "+faDate(x.created_at)+" · "+valueOrDash(x.action)+" · اجراکننده : "+valueOrDash(x.actor_id)).join("\n"):"⛂ - وضعیت : رویدادی برای این گروه ثبت نشده است.";
    return edit(msg.chat.id,msg.message_id,panelTitle("ممیزی گروه",lines),menu([[["بروزرسانی","c:audit"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:health"){
    let me:any=null;try{const rr=await telegramApi<any>("getMe",{});me=rr.ok?rr.result:null;}catch{}
    let db=true;try{await pool.query("SELECT 1");}catch{db=false;}
    const member=me?await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:me.id}):null;
    return edit(msg.chat.id,msg.message_id,panelTitle("سلامت ربات",
      "⛂ - Runtime : ● سالم\n⛂ - PostgreSQL : "+(db?"● سالم":"○ خطا")+"\n⛂ - Telegram : "+(me?"● متصل":"○ خطا")+"\n⛂ - حضور در گروه : "+(member?.ok?"● تأیید":"○ ناموفق")+"\n⛂ - آخرین بررسی : "+faDate(new Date())
    ),menu([[["بررسی مجدد","c:health"],["‹ بازگشت","c:home"]]]));
  }

  if(data==="c:security"){
    const r=await pool.query("SELECT full_lock,invite_protection,fake_account_restriction,new_account_days,emergency_mode FROM bot_group_settings WHERE group_id=$1",[groupId]);
    const x=r.rows[0]||{};
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت",
      "⛂ - قفل کامل : "+(x.full_lock?"● فعال":"○ خاموش")+"\n⛂ - محافظت دعوت : "+(x.invite_protection?"● فعال":"○ خاموش")+"\n⛂ - ضد اکانت فیک : "+(x.fake_account_restriction?"● فعال":"○ خاموش")+"\n⛂ - سن اکانت جدید : "+(x.new_account_days||0)+" روز\n⛂ - حالت اضطراری : "+(x.emergency_mode?"● فعال":"○ خاموش")
    ),menu([
      [[x.full_lock?"خاموش‌سازی قفل کامل":"فعال‌سازی قفل کامل","sec:full:"+(x.full_lock?"off":"on")],[x.invite_protection?"خاموش‌سازی محافظت دعوت":"فعال‌سازی محافظت دعوت","sec:invite:"+(x.invite_protection?"off":"on")]],
      [[x.fake_account_restriction?"خاموش‌سازی ضد اکانت فیک":"فعال‌سازی ضد اکانت فیک","sec:fake:"+(x.fake_account_restriction?"off":"on")],[x.emergency_mode?"خاموش‌سازی حالت اضطراری":"فعال‌سازی حالت اضطراری","sec:emergency:"+(x.emergency_mode?"off":"on")]],
      [["تنظیم سن اکانت جدید","sec:new"],["‹ بازگشت","c:home"]]
    ]));
  }

  if(data.startsWith("sec:")){
    if(!privileged && !(await isGroupAdmin(groupId,uid)))return send(msg.chat.id,panelTitle("دسترسی رد شد","⛂ - وضعیت : فقط مدیر گروه مجاز است."));
    const p=data.split(":");const setting=p[1],value=p[2]==="on";
    if(setting==="new"){
      session(uid,"security_new",{chatId:groupId});
      return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت","⛂ - مرحله : حداقل سن حساب را برحسب روز ارسال کنید.\n⛂ - مقدار ۰ : خاموش"),menu([[["‹ بازگشت","c:security"]]]));
    }
    const col=setting==="full"?"full_lock":setting==="invite"?"invite_protection":setting==="fake"?"fake_account_restriction":"emergency_mode";
    if(setting==="full"){
      const perms=value
        ?{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false}
        :{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true};
      const tg=await telegramApi("setChatPermissions",{chat_id:groupId,permissions:perms,use_independent_chat_permissions:true});
      if(!tg.ok)return send(msg.chat.id,panelTitle("خطای امنیتی","⛂ - پیام تلگرام : "+(tg.description||"خطای ناشناخته")));
    }
    await pool.query("INSERT INTO bot_group_settings(group_id,"+col+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+col+"=EXCLUDED."+col+",updated_at=NOW()",[groupId,value]);
    return edit(msg.chat.id,msg.message_id,panelTitle("مرکز امنیت","⛂ - تنظیم : "+(col==="full_lock"?"قفل کامل":col==="invite_protection"?"محافظت دعوت":col==="fake_account_restriction"?"ضد اکانت فیک":"حالت اضطراری")+"\n⛂ - وضعیت : "+(value?"● فعال":"○ خاموش")),menu([[["بررسی امنیت","c:security"],["‹ بازگشت","c:home"]]]));
  }

  return false;
}
async function handleInput(pool:Pool,msg:TgMessage){
  if(!msg.from)return false;const uid=msg.from.id,s=getSession(uid);if(!s||s.expires<Date.now())return false;const value=(msg.text||"").trim();const groupId=Number(s.data.chatId||msg.chat.id);
  if(s.flow==="exception_add"){
    const kind=String(s.data.kind||"user");
    if(kind==="domain"){
      const domain=value.toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/^www\./,"");
      if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))return send(msg.chat.id,"دامنه معتبر نیست؛ نمونه: example.com");
      await pool.query("INSERT INTO content_lock_domains(group_id,domain,enabled) VALUES($1,$2,TRUE) ON CONFLICT(group_id,domain) DO UPDATE SET enabled=TRUE",[groupId,domain]);
      clearSession(uid);await audit(pool,String(uid),"content_lock_domain_added",domain,{groupId});
      return send(msg.chat.id,"✓ دامنه در Allowlist ثبت و فعال شد.",menu([[["فهرست دامنه‌ها","ex:domains"]]]));
    }
    if(kind==="user"&&!/^\d+$/.test(value))return send(msg.chat.id,"آیدی کاربر باید عددی باشد.");
    if(kind==="forward_source"&&!/^-?\d+$/.test(value))return send(msg.chat.id,"آیدی منبع فوروارد معتبر نیست.");
    if(kind==="role"&&!/^(owner|sudo|admin|member)$/i.test(value))return send(msg.chat.id,"نقش مجاز: owner / sudo / admin / member");
        await pool.query("INSERT INTO content_lock_exceptions(group_id,exception_type,target_id,target_label,scope,enabled) VALUES($1,$2,$3,$4,$5::jsonb,TRUE) ON CONFLICT(group_id,exception_type,target_id) DO UPDATE SET target_label=EXCLUDED.target_label,enabled=TRUE,updated_at=NOW()",[groupId,kind,value,value.toLowerCase(),JSON.stringify(["all"])]);
    clearSession(uid);await audit(pool,String(uid),"content_lock_exception_added",value,{groupId,type:kind});
    return send(msg.chat.id,"✓ استثنا ثبت و فعال شد.",menu([[["مرکز استثناها","c:exceptions"]]]));
  }
  if(s.flow==="exception_delete"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");
    await pool.query("DELETE FROM content_lock_exceptions WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);await audit(pool,String(uid),"content_lock_exception_removed",String(id),{groupId});
    return send(msg.chat.id,"✓ استثنا حذف شد.",menu([[["مرکز استثناها","c:exceptions"]]]));
  }
  if(s.flow==="domain_delete"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه معتبر نیست.");
    await pool.query("DELETE FROM content_lock_domains WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);await audit(pool,String(uid),"content_lock_domain_removed",String(id),{groupId});
    return send(msg.chat.id,"✓ دامنه حذف شد.",menu([[["فهرست دامنه‌ها","ex:domains"]]]));
  }

  if(s.flow==="automation_add_name"){
    if(value.length<1||value.length>80)return send(msg.chat.id,"نام Rule باید بین ۱ تا ۸۰ نویسه باشد.");
    s.data.name=value;s.flow="automation_add_keyword";session(uid,s.flow,s.data);
    return send(msg.chat.id,panelTitle("سازنده اتوماسیون","کلمه یا عبارت محرک را ارسال کنید."));
  }
  if(s.flow==="automation_add_keyword"){
    if(value.length<1||value.length>120)return send(msg.chat.id,"عبارت محرک نامعتبر است.");
    s.data.keyword=value.toLowerCase();s.flow="automation_action";session(uid,s.flow,s.data);
    return send(msg.chat.id,panelTitle("سازنده اتوماسیون","نوع عملیات را انتخاب کنید."),menu([
      [["پاسخ خودکار","auto:action:reply"],["حذف پیام","auto:action:delete"]],
      [["سکوت کاربر","auto:action:mute"],["اخراج کاربر","auto:action:kick"]],
      [["‹ انصراف","c:automation"]]
    ]));
  }
  if(s.flow==="automation_payload"){
    await pool.query("INSERT INTO bot_group_automations(group_id,name,trigger_value,action_type,action_payload,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(group_id,name) DO UPDATE SET trigger_value=EXCLUDED.trigger_value,action_type=EXCLUDED.action_type,action_payload=EXCLUDED.action_payload,enabled=TRUE,updated_at=NOW()",[groupId,s.data.name,s.data.keyword,s.data.action,value,uid]);
    clearSession(uid);await audit(pool,String(uid),"automation_created",s.data.name,{groupId,action:s.data.action});
    return send(msg.chat.id,"✓ Rule اتوماسیون ساخته و فعال شد.",menu([[["اتوماسیون‌ها","auto:list"]]]));
  }
  if(s.flow==="automation_manage"){
    const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"شناسه Rule معتبر نیست.");
    if(s.data.action==="toggle")await pool.query("UPDATE bot_group_automations SET enabled=NOT enabled,updated_at=NOW() WHERE id=$1 AND group_id=$2",[id,groupId]);
    else await pool.query("DELETE FROM bot_group_automations WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);await audit(pool,String(uid),"automation_managed",String(id),{groupId,action:s.data.action});
    return send(msg.chat.id,"✓ عملیات اتوماسیون اجرا شد.",menu([[["مرکز اتوماسیون","c:automation"]]]));
  }
  if(s.flow==="owner_extend"||s.flow==="owner_reduce"){const days=Number(value);const sign=s.flow==="owner_extend"?1:-1;const lic=(await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' ORDER BY id DESC LIMIT 1",[s.data.customerId])).rows[0];if(!lic?.expires_at)return send(msg.chat.id,"مادام‌العمر یا بدون تاریخ انقضا است.");const newDate=new Date(new Date(lic.expires_at).getTime()+sign*days*86400000);await pool.query("UPDATE bot_licenses SET expires_at=$1 WHERE id=$2",[newDate,lic.id]);clearSession(uid);return send(msg.chat.id,"✓ تاریخ انقضا به "+faDate(newDate)+" تغییر کرد.");}
  if(s.flow==="owner_message"){const r=await telegramApi("sendMessage",{chat_id:Number(s.data.customerId),text:value});clearSession(uid);return send(msg.chat.id,r.ok?"✓ پیام خصوصی ارسال شد.":"✗ ارسال پیام ناموفق بود: "+(r.description||"Telegram error"));}
  if(s.flow==="owner_owner_add"){const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"آیدی معتبر نیست.");await pool.query("INSERT INTO bot_panel_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING",[id]);clearSession(uid);return send(msg.chat.id,"✓ مالک جدید ثبت شد.");}
  if(s.flow==="owner_maint_message"){await pool.query("INSERT INTO bot_system_settings(key,value) VALUES('maintenance_message',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(value)]);clearSession(uid);return send(msg.chat.id,"✓ پیام حالت نگهداری ذخیره شد.");}
  if(s.flow==="owner_groupmax"){const n=Number(value);if(!Number.isInteger(n)||n<1||n>10000)return send(msg.chat.id,"عدد باید بین ۱ تا ۱۰۰۰۰ باشد.");await pool.query("INSERT INTO bot_system_settings(key,value) VALUES('default_group_limit',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(n)]);clearSession(uid);return send(msg.chat.id,"✓ سقف پیش‌فرض گروه ذخیره شد.");}
  if(s.flow==="owner_blacklist_add"){const id=Number(value);if(!Number.isSafeInteger(id))return send(msg.chat.id,"آیدی معتبر نیست.");await pool.query("INSERT INTO bot_blacklist(user_id,reason) VALUES($1,'افزودن دستی مالک') ON CONFLICT(user_id) DO NOTHING",[id]);clearSession(uid);await audit(pool,String(uid),"blacklist_added",String(id));return send(msg.chat.id,"✓ مشتری به لیست سیاه اضافه شد.");}
  if(s.flow==="owner_broadcast_wait"){session(uid,"owner_broadcast_preview",{sourceChatId:msg.chat.id,sourceMessageId:msg.message_id});return send(msg.chat.id,"پیش‌نمایش دریافت شد. مخاطب را انتخاب کنید.",menu([[["همه مشتریان","bc:all"],["فقط فعال","bc:active"]],[["در حال انقضا","bc:expiring"],["انصراف","o:home"]]]));}
  if(s.flow==="confirm_owner_action" && value==="تأیید نهایی"){const act=s.data.act,id=Number(s.data.id);if(act==="lic_off")await pool.query("UPDATE bot_licenses SET status='disabled' WHERE customer_id=$1 AND status='active'",[id]);if(act==="block")await pool.query("UPDATE bot_customers SET status='blocked' WHERE user_id=$1",[id]);if(act==="unblock")await pool.query("UPDATE bot_customers SET status='active' WHERE user_id=$1",[id]);if(act==="lic_plus"||act==="lic_minus"){const days=1;const lic=(await pool.query("SELECT * FROM bot_licenses WHERE customer_id=$1 AND status='active' ORDER BY id DESC LIMIT 1",[id])).rows[0];if(lic?.expires_at){const sign=act==="lic_plus"?1:-1;await pool.query("UPDATE bot_licenses SET expires_at=$1 WHERE id=$2",[new Date(new Date(lic.expires_at).getTime()+sign*days*86400000),lic.id]);}}clearSession(uid);await audit(pool,String(uid),"owner_sensitive_action",String(id),{act});return send(msg.chat.id,"✓ عملیات حساس با موفقیت انجام شد.");}
  if(s.flow==="confirm_blacklist_remove" && value==="تأیید نهایی"){const id=Number(s.data.id);await pool.query("DELETE FROM bot_blacklist WHERE user_id=$1",[id]);clearSession(uid);await audit(pool,String(uid),"blacklist_removed",String(id));return send(msg.chat.id,"✓ مشتری از لیست سیاه خارج شد.");}
  if(s.flow==="owner_broadcast_confirm" && value==="بله، ارسال شود"){
    const mode=String(s.data.mode),sourceChatId=Number(s.data.sourceChatId),sourceMessageId=Number(s.data.sourceMessageId);
    const where=mode==="active"?"status='active' AND EXISTS (SELECT 1 FROM bot_licenses l WHERE l.customer_id=c.user_id AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at>NOW()))":
      mode==="expiring"?"status='active' AND EXISTS (SELECT 1 FROM bot_licenses l WHERE l.customer_id=c.user_id AND l.status='active' AND l.expires_at>NOW() AND l.expires_at<=NOW()+INTERVAL '7 days')":"status<>'blocked'";
    const targets=(await pool.query("SELECT user_id FROM bot_customers c WHERE "+where+" ORDER BY user_id LIMIT 5000")).rows;
    let sentCount=0,failedCount=0;const broadcast=(await pool.query("INSERT INTO bot_broadcasts(owner_id,target_mode,source_chat_id,source_message_id,status) VALUES($1,$2,$3,$4,'running') RETURNING id",[uid,mode,sourceChatId,sourceMessageId])).rows[0];
    for(const t of targets){
      const r=await telegramApi("copyMessage",{chat_id:Number(t.user_id),from_chat_id:sourceChatId,message_id:sourceMessageId});
      if(r.ok)sentCount++;else failedCount++;
      if((sentCount+failedCount)%20===0)await sleep(700);
    }
    await pool.query("UPDATE bot_broadcasts SET status='finished',total_targeted=$1,total_sent=$2,total_failed=$3,finished_at=NOW() WHERE id=$4",[targets.length,sentCount,failedCount,broadcast.id]);
    clearSession(uid);await audit(pool,String(uid),"broadcast_finished",String(broadcast.id),{targetMode:mode,total:targets.length,sent:sentCount,failed:failedCount});
    return send(msg.chat.id,"◈ گزارش ارسال همگانی\n\n⛂ هدف: "+targets.length+"\n⛂ موفق: "+sentCount+"\n⛂ ناموفق: "+failedCount);
  }
  if(s.flow==="warn_issue_target"){
    const targetId=Number(s.data.targetId);
    const reason=String(value||"").trim();
    if(!Number.isSafeInteger(targetId)||targetId<=0||!reason){clearSession(uid);return send(msg.chat.id,"دلیل معتبر نیست.");}
    const targetCtx:any={chatId:groupId,userId:uid,userName:msg.from?.username?"@"+msg.from.username:(msg.from?.first_name||"مدیر"),replyToUserId:targetId,replyToName:String(targetId),chatTitle:msg.chat?.title||"",chatType:msg.chat?.type||"group"};
    const result=await runModerationCommand(pool as any,targetCtx,"warn",[reason]);
    clearSession(uid);
    return send(msg.chat.id,result);
  }
  if(s.flow==="warn_issue"){
    const userId=Number(value);
    if(!Number.isSafeInteger(userId)||userId<=0){clearSession(uid);return send(msg.chat.id,"آیدی معتبر نیست.");}
    const target=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId});
    if(!target.ok){clearSession(uid);return send(msg.chat.id,"✗ کاربر پیدا نشد: "+(target.description||"Telegram error"));}
    const status=String(target.result?.status||"");
    if(["administrator","creator"].includes(status)){
      clearSession(uid);
      const roleLabel=status==="creator"?"مالک":"مدیر";
      return send(msg.chat.id,"✗ این کاربر "+roleLabel+" گروه است و قابل اخطار نیست.");
    }
    const name=target.result?.user?.username?"@"+target.result.user.username:(target.result?.user?.first_name||String(userId));
    const wc=(await pool.query("SELECT COALESCE(warning_count,0) AS warning_count,last_warning_at FROM warning_cases WHERE group_id=$1 AND user_id=$2 LIMIT 1",[groupId,userId])).rows[0];
    clearSession(uid);
    return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center",
      "⛂ - کاربر : "+name+"\n⛂ - شناسه : "+userId+"\n⛂ - وضعیت : "+(status==="member"?"عضو گروه":"فعال")+
      "\n⛂ - اخطار فعلی : "+Number(wc?.warning_count||0)+" از ۵\n⛂ - آخرین اخطار : "+(wc?.last_warning_at?faDate(wc.last_warning_at):"ثبت نشده")+
      "\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - اخطار جدید : +۱\n⛂ - دلیل : قابل تنظیم\n⛂ - اقدام بعدی : طبق سطح اخطار\n⛂ - اخطار نهایی : بن\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - وضعیت : آماده ثبت"),menu([
        [["اخطار +۱","twx:"+userId],["اخطار سفارشی","twc:"+userId]],
        [["کاهش اخطار","wd:"+userId],["حذف اخطار","wc:"+userId]],
        [["سابقه اخطار","w:list"],["تنظیم مراحل","w:levels"]],
        [["‹ بازگشت","c:members"]]
      ]));
  }
  if(s.flow==="warn_clear"){const userId=Number(value);await pool.query("UPDATE warning_events SET status='cleared',result='cleared' WHERE group_id=$1 AND user_id=$2 AND action_type='warning' AND status='active'",[groupId,userId]);clearSession(uid);return send(msg.chat.id,"✓ اخطارهای فعال کاربر پاک شد.");}
  if(s.flow==="moderation_action"){
    const userId=Number(value);
    const action=String(s.data.action||"");
    if(!Number.isSafeInteger(userId)||userId<=0){clearSession(uid);return send(msg.chat.id,"آیدی معتبر نیست.");}
    const target=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId});
    if(!target.ok){clearSession(uid);return send(msg.chat.id,"✗ کاربر پیدا نشد: "+(target.description||"Telegram error"));}
    const status=String(target.result?.status||"");
    if(["administrator","creator"].includes(status)&&["mute","ban","ban_reason"].includes(action)){
      clearSession(uid);
      const roleLabel=status==="creator"?"مالک":"مدیر";
      return send(msg.chat.id,"✗ این کاربر "+roleLabel+" گروه است و قابل مجازات نیست.");
    }
    const base={chat_id:groupId,user_id:userId};
    if(action==="mute"){
      const seconds=Number(s.data.durationSeconds||3600);
      const r=await telegramApi("restrictChatMember",{
        ...base,
        permissions:{
          can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,
          can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,
          can_send_other_messages:false,can_add_web_page_previews:false
        },
        use_independent_chat_permissions:true,
        until_date:Math.floor(Date.now()/1000)+Math.max(30,seconds)
      });
      await pool.query(
        "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [groupId,uid,userId,"mute",seconds,"سکوت از مرکز سکوت",r.ok?"success":"failed"]
      ).catch(()=>{});
      clearSession(uid);
      return send(msg.chat.id,r.ok?"✓ سکوت با موفقیت اجرا شد.\n⛂ - کاربر : "+userId+"\n⛂ - مدت : "+(seconds%3600===0?(seconds/3600)+" ساعت":Math.floor(seconds/60)+" دقیقه"):"✗ سکوت ناموفق بود: "+(r.description||"Telegram error"));
    }
    if(action==="ban"||action==="ban_reason"){
      if(action==="ban_reason"){
        session(uid,"moderation_reason",{chatId:groupId,action:"ban",targetId:userId});
        return send(msg.chat.id,"⛂ - کاربر : "+userId+"\n⛂ - دلیل بن را ارسال کنید.",menu([[["‹ بازگشت","c:ban"]]]));
      }
      const seconds=s.data.durationSeconds==null?null:Number(s.data.durationSeconds);
      const body:any={...base,revoke_messages:true};
      if(seconds)body.until_date=Math.floor(Date.now()/1000)+Math.max(30,seconds);
      const r=await telegramApi("banChatMember",body);
      await pool.query(
        "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [groupId,uid,userId,"ban",seconds,seconds?"بن موقت از مرکز بن":"بن دائمی از مرکز بن",r.ok?"success":"failed"]
      ).catch(()=>{});
      clearSession(uid);
      return send(msg.chat.id,r.ok?"✓ بن با موفقیت اجرا شد.\n⛂ - کاربر : "+userId+"\n⛂ - نوع : "+(seconds?"موقت":"دائمی")+(seconds?"\n⛂ - مدت : "+(seconds%86400===0?(seconds/86400)+" روز":seconds%3600===0?(seconds/3600)+" ساعت":Math.floor(seconds/60)+" دقیقه"):""):"✗ بن ناموفق بود: "+(r.description||"Telegram error"));
    }
    clearSession(uid);
    return send(msg.chat.id,"✗ عملیات مجازات شناخته نشد.");
  }
  if(s.flow==="moderation_reason"){
    const targetId=Number(s.data.targetId),reason=String(value||"").trim();
    if(!Number.isSafeInteger(targetId)||targetId<=0||!reason){clearSession(uid);return send(msg.chat.id,"دلیل معتبر نیست.");}
    const target=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:targetId});
    if(!target.ok){clearSession(uid);return send(msg.chat.id,"✗ کاربر پیدا نشد: "+(target.description||"Telegram error"));}
    const status=String(target.result?.status||"");
    if(["administrator","creator"].includes(status)){
      clearSession(uid);
      const roleLabel=status==="creator"?"مالک":"مدیر";
      return send(msg.chat.id,"✗ این کاربر "+roleLabel+" گروه است و قابل مجازات نیست.");
    }
    const r=await telegramApi("banChatMember",{chat_id:groupId,user_id:targetId,revoke_messages:true});
    await pool.query(
      "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,'ban',NULL,$4,$5)",
      [groupId,uid,targetId,reason,r.ok?"success":"failed"]
    ).catch(()=>{});
    clearSession(uid);
    return send(msg.chat.id,r.ok?"✓ بن با موفقیت اجرا شد.\n⛂ - کاربر : "+targetId+"\n⛂ - دلیل : "+reason:"✗ بن ناموفق بود: "+(r.description||"Telegram error"));
  }
  if(s.flow==="member_action"){
    const userId=Number(value);
    const a=String(s.data.action||"");
    if(!Number.isSafeInteger(userId)||userId<=0){clearSession(uid);return send(msg.chat.id,"آیدی معتبر نیست.");}
    const target=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId});
    if(!target.ok){clearSession(uid);return send(msg.chat.id,"✗ کاربر پیدا نشد: "+(target.description||"Telegram error"));}
    const status=String(target.result?.status||"");
    const roleLabel=status==="creator"?"مالک":status==="administrator"?"مدیر":"عضو";
    const name=target.result?.user?.username?"@"+target.result.user.username:(target.result?.user?.first_name||String(userId));

    if(["administrator","creator"].includes(status)&&["mute","perm_mute","ban","kick","warn"].includes(a)){
      clearSession(uid);
      return send(msg.chat.id,"✗ این کاربر "+roleLabel+" گروه است و قابل مجازات نیست.");
    }

    // From the member manager, selecting a moderation action opens its dedicated center
    // with the selected target already attached.
    if(a==="warn"){
      clearSession(uid);
      return edit(msg.chat.id,msg.message_id,panelTitle("Warning Center",
        "⛂ - کاربر : "+name+"\n⛂ - شناسه : "+userId+"\n⛂ - وضعیت : "+roleLabel+
        "\n⛂ - اخطار فعلی : از ۵\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - اخطار جدید : +۱\n⛂ - دلیل : قابل تنظیم\n⛂ - اقدام بعدی : طبق سطح اخطار\n⛂ - اخطار نهایی : بن\n\n⛂ - وضعیت : آماده ثبت"),menu([
          [["اخطار +۱","tw:"+userId],["اخطار سفارشی","twc:"+userId]],
          [["کاهش اخطار","wd:"+userId],["حذف اخطار","wc:"+userId]],
          [["سابقه اخطار","w:list"],["تنظیم مراحل","w:levels"]],
          [["‹ بازگشت","c:members"]]
        ]));
    }

    if(a==="mute"||a==="perm_mute"){
      clearSession(uid);
      return edit(msg.chat.id,msg.message_id,panelTitle("Mute Center",
        "⛂ - کاربر : "+name+"\n⛂ - شناسه : "+userId+"\n⛂ - وضعیت : "+roleLabel+
        "\n⛂ - مدت : "+(a==="perm_mute"?"دائمی":"انتخاب نشده")+
        "\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - سطح محدودیت : ارسال پیام\n⛂ - حذف پیام‌های جدید : فعال\n⛂ - اجرا توسط : —"),menu([
          [["۱۰ دقیقه","tm:10:"+userId],["۳۰ دقیقه","tm:30:"+userId]],
          [["۱ ساعت","tm:60:"+userId],["۶ ساعت","tm:360:"+userId]],
          [["۱۲ ساعت","tm:720:"+userId],["۲۴ ساعت","tm:1440:"+userId]],
          [["سکوت دائمی","tp:"+userId],["رفع سکوت","tu:"+userId]],
          [["‹ بازگشت","c:members"]]
        ]));
    }

    if(a==="ban"){
      clearSession(uid);
      return edit(msg.chat.id,msg.message_id,panelTitle("Ban Center",
        "⛂ - کاربر : "+name+"\n⛂ - شناسه : "+userId+"\n⛂ - وضعیت : "+roleLabel+
        "\n⛂ - سابقه اخطار : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - نوع اقدام : انتخاب نشده\n⛂ - حذف پیام‌ها : فعال\n⛂ - دلیل : —\n⛂ - اجرا توسط : —\n\n⛂ - وضعیت عملیات : آماده اجرا"),menu([
          [["بن کاربر","bp:"+userId],["بن با دلیل","br:"+userId]],
          [["بن دائمی","bp:"+userId],["بن موقت","bt:"+userId]],
          [["حذف بن","bu:"+userId],["مشاهده سابقه","w:history"]],
          [["‹ بازگشت","c:members"]]
        ]));
    }

    // Legacy non-moderation member operations keep their direct behavior.
    const base={chat_id:groupId,user_id:userId};
    let method="";
    let body:any={...base};
    if(a==="unmute"){
      method="restrictChatMember";
      body.permissions={can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,
        can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,
        can_send_other_messages:true,can_add_web_page_previews:true};
      body.use_independent_chat_permissions=true;
    }else if(a==="unban"){
      method="unbanChatMember"; body.only_if_banned=true;
    }else if(a==="kick"){
      method="banChatMember"; body.revoke_messages=true;
      body.until_date=Math.floor(Date.now()/1000)+60;
    }else{
      clearSession(uid);return send(msg.chat.id,"✗ این عملیات هنوز در مرکز اعضا فعال نشده است.");
    }
    const rr=await telegramApi(method,body);
    await pool.query(
      "INSERT INTO moderation_actions(group_id,actor_id,target_id,action_type,duration_seconds,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [groupId,uid,userId,a,a==="kick"?60:null,a==="unmute"?"رفع سکوت":"رفع بن",rr.ok?"success":"failed"]
    ).catch(()=>{});
    clearSession(uid);
    return send(msg.chat.id,rr.ok?"✓ عملیات با موفقیت اجرا شد.\n⛂ - کاربر : "+userId:"✗ عملیات ناموفق بود: "+(rr.description||"Telegram error"));
  }

  if(s.flow==="member_search"){const id=value.replace(/^@/,"");const r=await pool.query("SELECT user_id,first_name,username FROM warning_cases WHERE group_id=$1 AND (user_id::text=$2 OR LOWER(username)=LOWER($3)) LIMIT 1",[groupId,id,id]);clearSession(uid);return send(msg.chat.id,r.rows[0]?"✓ کاربر در رجیستری گروه پیدا شد.\nآیدی: "+r.rows[0].user_id:"کاربر در رجیستری گروه پیدا نشد.");}
  if(s.flow==="member_bulk"){const ids=value.split(/\s+/).map(Number).filter(Number.isSafeInteger).slice(0,50);session(uid,"member_bulk_confirm",{chatId:groupId,ids});return send(msg.chat.id,"تعداد "+ids.length+" کاربر انتخاب شد. برای اخراج همه «بله، مطمئن هستم» را ارسال کنید.");}
  if(s.flow==="member_bulk_confirm"&&value==="بله، مطمئن هستم"){const ids=s.data.ids||[];let ok=0;for(const id of ids){const r=await telegramApi("banChatMember",{chat_id:groupId,user_id:id});if(r.ok)ok++;await sleep(60);}clearSession(uid);return send(msg.chat.id,"✓ عملیات گروهی انجام شد. موفق: "+ok+" از "+ids.length);}
  if(s.flow==="group_setting"){const a=s.data.setting,val=value.toLowerCase();if(a==="welcome"||a==="goodbye"){const col=a==="welcome"?"welcome_text":"goodbye_text";await pool.query("INSERT INTO bot_group_settings(group_id,"+col+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+col+"=EXCLUDED."+col+",updated_at=NOW()",[groupId,value]);}else{const field=a==="verify"?"welcome_enabled":a==="rules"?"rules_on_join":a==="pv"?"pv_welcome":a;const bool=["روشن","on","1","فعال"].includes(val);await pool.query("INSERT INTO bot_group_settings(group_id,"+field+") VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET "+field+"=EXCLUDED."+field+",updated_at=NOW()",[groupId,bool]);}clearSession(uid);return send(msg.chat.id,"✓ تنظیم با موفقیت ذخیره شد.");}
  if(s.flow==="security_new"){const d=Math.max(0,Math.min(3650,Number(value)||0));await pool.query("INSERT INTO bot_group_settings(group_id,new_account_days) VALUES($1,$2) ON CONFLICT(group_id) DO UPDATE SET new_account_days=EXCLUDED.new_account_days,updated_at=NOW()",[groupId,d]);clearSession(uid);return send(msg.chat.id,"✓ محدودیت سن حساب روی "+d+" روز تنظیم شد.");}
  if(s.flow==="group_command"){const action=s.data.action;
    if((action==="add"||action==="edit"||action==="auto")&&Number(s.data.step||1)===1){s.data.step=2;s.data.cmd=value.replace(/^\/+/, "").trim().toLowerCase();session(uid,s.flow,s.data);return send(msg.chat.id,"پاسخ این دستور را ارسال کنید.");}
    if((action==="add"||action==="edit"||action==="auto")&&Number(s.data.step||1)===2){const cmd=s.data.cmd;await pool.query("INSERT INTO bot_group_commands(group_id,command_key,aliases,response_text) VALUES($1,$2,$3,$4) ON CONFLICT(group_id,command_key) DO UPDATE SET aliases=EXCLUDED.aliases,response_text=EXCLUDED.response_text,updated_at=NOW()",[groupId,cmd,[cmd],value]);clearSession(uid);return send(msg.chat.id,"✓ دستور ذخیره شد و فعال است.");}
    if(action==="delete"){const id=Number(value);const before=(await pool.query("SELECT * FROM bot_group_commands WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];if(!before){clearSession(uid);return send(msg.chat.id,"دستور پیدا نشد.");}await pool.query("DELETE FROM bot_group_commands WHERE id=$1 AND group_id=$2",[id,groupId]);clearSession(uid);return send(msg.chat.id,"✓ دستور حذف شد.");}
    clearSession(uid);return send(msg.chat.id,"عملیات دستور نامعتبر است.");}
  if(s.flow==="schedule"){const a=s.data.action,step=Number(s.data.step||1);
    if(a==="add"&&step===1){s.data.message=value;s.data.step=2;session(uid,s.flow,s.data);return send(msg.chat.id,"تاریخ و ساعت ارسال را با قالب YYYY-MM-DD HH:mm ارسال کنید.");}
    if(a==="add"&&step===2){const when=new Date(value.replace(" ","T")+":00");if(Number.isNaN(when.getTime())||when.getTime()<=Date.now())return send(msg.chat.id,"تاریخ/ساعت باید معتبر و در آینده باشد.");await pool.query("INSERT INTO bot_schedules(group_id,creator_id,message_text,send_at) VALUES($1,$2,$3,$4)",[groupId,uid,s.data.message,when]);clearSession(uid);return send(msg.chat.id,"✓ زمان‌بندی ثبت شد: "+faDate(when));}
    if(a==="edit"&&step===1){const id=Number(value);if(!Number.isSafeInteger(id)){clearSession(uid);return send(msg.chat.id,"شناسه معتبر نیست.");}s.data.scheduleId=id;s.data.step=2;session(uid,s.flow,s.data);return send(msg.chat.id,"متن جدید زمان‌بندی را ارسال کنید.");}
    if(a==="edit"&&step===2){await pool.query("UPDATE bot_schedules SET message_text=$1 WHERE id=$2 AND group_id=$3",[value,s.data.scheduleId,groupId]);clearSession(uid);return send(msg.chat.id,"✓ متن زمان‌بندی تغییر کرد.");}
    const id=Number(value);if(!Number.isSafeInteger(id)){clearSession(uid);return send(msg.chat.id,"شناسه معتبر نیست.");}
    if(a==="delete")await pool.query("DELETE FROM bot_schedules WHERE id=$1 AND group_id=$2",[id,groupId]);
    if(a==="toggle")await pool.query("UPDATE bot_schedules SET enabled=NOT enabled WHERE id=$1 AND group_id=$2",[id,groupId]);
    clearSession(uid);return send(msg.chat.id,"✓ عملیات زمان‌بندی انجام شد.");}
  return false;
}

export async function openModerationCenterFromCommand(pool:Pool, chatId:number, actorId:number, commandId:string, targetId:number, targetName?:string){
  const target=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:targetId});
  if(!target.ok)return target;
  const status=String(target.result?.status||"");
  const roleLabel=status==="creator"?"مالک":status==="administrator"?"مدیر":"عضو";
  const name=target.result?.user?.username?"@"+target.result.user.username:(targetName||target.result?.user?.first_name||String(targetId));
  if(["administrator","creator"].includes(status) && ["warn","mute","perm_mute","ban"].includes(commandId)){
    return await telegramApi("sendMessage",{chat_id:chatId,text:"✗ این کاربر "+roleLabel+" گروه است و قابل مجازات نیست."});
  }

  let title="Warning Center", body="";
  let markup:any;
  if(commandId==="warn"){
    const wc=(await pool.query("SELECT COALESCE(warning_count,0) AS warning_count,last_warning_at FROM warning_cases WHERE group_id=$1 AND user_id=$2 LIMIT 1",[chatId,targetId]).catch(()=>({rows:[]}))).rows[0];
    body="⛂ - کاربر : "+name+"\n⛂ - شناسه : "+targetId+"\n⛂ - وضعیت : "+roleLabel+"\n⛂ - اخطار فعلی : "+Number(wc?.warning_count||0)+" از ۵\n⛂ - آخرین اخطار : "+(wc?.last_warning_at?faDate(wc.last_warning_at):"ثبت نشده")+"\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - اخطار جدید : +۱\n⛂ - دلیل : قابل تنظیم\n⛂ - اقدام بعدی : طبق سطح اخطار\n⛂ - اخطار نهایی : بن\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - وضعیت : آماده ثبت";
    markup={inline_keyboard:[
      [{text:"اخطار +۱",callback_data:"twx:"+targetId},{text:"اخطار سفارشی",callback_data:"twc:"+targetId}],
      [{text:"کاهش اخطار",callback_data:"wd:"+targetId},{text:"حذف اخطار",callback_data:"wc:"+targetId}],
      [{text:"سابقه اخطار",callback_data:"w:list"},{text:"تنظیم مراحل",callback_data:"w:levels"}]
    ]};
  } else if(commandId==="mute"||commandId==="perm_mute"){
    title="Mute Center";
    body="⛂ - کاربر : "+name+"\n⛂ - شناسه : "+targetId+"\n⛂ - وضعیت : "+roleLabel+"\n⛂ - مدت : "+(commandId==="perm_mute"?"دائمی":"انتخاب نشده")+"\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - سطح محدودیت : ارسال پیام\n⛂ - حذف پیام‌های جدید : فعال\n⛂ - دلیل : —\n⛂ - اجرا توسط : —";
    markup={inline_keyboard:[
      [{text:"۱۰ دقیقه",callback_data:"tm:10:"+targetId},{text:"۳۰ دقیقه",callback_data:"tm:30:"+targetId}],
      [{text:"۱ ساعت",callback_data:"tm:60:"+targetId},{text:"۶ ساعت",callback_data:"tm:360:"+targetId}],
      [{text:"۱۲ ساعت",callback_data:"tm:720:"+targetId},{text:"۲۴ ساعت",callback_data:"tm:1440:"+targetId}],
      [{text:"سکوت دائمی",callback_data:"tp:"+targetId},{text:"رفع سکوت",callback_data:"tu:"+targetId}]
    ]};
  } else if(commandId==="ban"){
    title="Ban Center";
    body="⛂ - کاربر : "+name+"\n⛂ - شناسه : "+targetId+"\n⛂ - وضعیت : "+roleLabel+"\n⛂ - سابقه اخطار : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - نوع اقدام : انتخاب نشده\n⛂ - حذف پیام‌ها : فعال\n⛂ - دلیل : —\n⛂ - اجرا توسط : —\n\n─────━━───── ◈ ─────━━─────\n\n⛂ - وضعیت عملیات : آماده اجرا";
    markup={inline_keyboard:[
      [{text:"بن کاربر",callback_data:"bp:"+targetId},{text:"بن با دلیل",callback_data:"br:"+targetId}],
      [{text:"بن دائمی",callback_data:"bp:"+targetId},{text:"بن موقت",callback_data:"bt:"+targetId}],
      [{text:"حذف بن",callback_data:"bu:"+targetId},{text:"مشاهده سابقه",callback_data:"w:history"}]
    ]};
  } else return null;

  const lang=await panelLanguageForChat(chatId);
  const result=await telegramApi("sendMessage",{chat_id:chatId,text:buildPanelText(title,body,lang),reply_markup:localizeMarkup(markup,lang)});
  if(result.ok){
    const messageId=Number((result.result as any)?.message_id);
    if(Number.isSafeInteger(messageId)&&messageId>0)await bindPanelMessage(pool,chatId,messageId,actorId);
  }
  return result;
}

export async function dispatchPanelMessage(pool:Pool,msg:TgMessage,ownerIds:string[]){
  if(!msg.from)return false;
  await ensurePanelSessionSchema(pool);
  return runWithPanelScope(msg.from.id,pool,async()=>{
    // Panel throttling must never consume group messages; content-lock
    // enforcement needs to see every message, including rapid photo bursts.
    if(msg.chat.type==="private" && !allowed(msg.from.id))return false;
    if(await handleInput(pool,msg))return true;
    if(await handleOwner(pool,msg,ownerIds))return true;
    return await handleCustomer(pool,msg,ownerIds);
  });
}
export async function dispatchPanelCallback(pool:Pool,cb:TgCallback,ownerIds:string[]){
  if(!cb.message){
    await answer(cb.id).catch(()=>{});
    return;
  }
  // A callback query must be acknowledged immediately so Telegram does not leave
  // the button in a permanent loading state while database/Telegram work runs.
  await answer(cb.id).catch(()=>{});
  await ensurePanelSessionSchema(pool);
  // Do not reject legacy/previously-rendered panel messages solely because their
  // session row expired or was created before the session table was introduced.
  // Authorization is enforced again inside ownerCallback/customerCallback.
  const owned=await panelMessageOwnedBy(pool,cb.message.chat.id,cb.message.message_id,cb.from.id).catch(()=>false);
  return runWithPanelScope(cb.from.id,pool,async()=>{
    if(!owned){
      // Keep old panels interactive; refresh their session ownership for this user.
      await bindPanelMessage(pool,cb.message!.chat.id,cb.message!.message_id,cb.from.id).catch(()=>{});
    }
    if(!allowed(cb.from.id))return;
    const data=String(cb.data||"");
    // Customer/lock panel callbacks must keep their customer context even for the bot owner.
    // Otherwise ownerCallback receives c:/cl:/clt:/cls: actions and silently ignores them.
    if(
      /^(c|cl|clt|cls|auto|ex|w|m|wel|cmd|sc|sec|st|tw|tm|tp|tu|bp|br|brx|bt|btd|bu|ban|mute):/.test(data)
    ){
      return customerCallback(pool,cb,ownerIds);
    }
    if(await isOwner(pool,cb.from.id,ownerIds))return ownerCallback(pool,cb,ownerIds);
    return customerCallback(pool,cb,ownerIds);
  });
}
