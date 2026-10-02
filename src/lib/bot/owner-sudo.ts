import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";
import { prepareRichDocument, validateRichDocument, richDocumentToPlainText, type RichDocument } from "./rich-message.ts";

export type SudoLevel = "low" | "medium" | "pro" | "security";

type SudoRow = {
  user_id:number;
  level:SudoLevel;
  security_mode:boolean;
  active:boolean;
  granted_by:number;
  created_at:string;
  updated_at:string;
};

const pendingAssignments=new Map<number,SudoLevel>();
const sudoCache=new Map<number,SudoRow>();
const LOW_COMMANDS=new Set(["robot","id","admin","info","rank","me","ping","bot","status","stats","date","lock","unlock","link","special","special_list"]);
const MEDIUM_COMMANDS=new Set([...LOW_COMMANDS,"warn","mute","unmute","perm_mute","ban","unban","lockall","unlockall"]);

const LEVELS:Record<SudoLevel,{title:string;summary:string;capabilities:string[]}> = {
  low:{
    title:"سودو پایین",
    summary:"دسترسی پایه برای مشاهده و بررسی بدون دسترسی به عملیات حساس.",
    capabilities:["آمار و وضعیت","جستجوی مشتری","مشاهده لایسنس","مشاهده گروه‌ها","مشاهده گزارش‌های عمومی"],
  },
  medium:{
    title:"سودو متوسط",
    summary:"دسترسی عملیاتی کنترل‌شده برای مدیریت روزمره.",
    capabilities:["تمام قابلیت‌های سودو پایین","مدیریت مشتریان","مدیریت اشتراک‌ها","مدیریت لایسنس‌ها","مدیریت گروه‌های مجاز"],
  },
  pro:{
    title:"سودو حرفه‌ای",
    summary:"دسترسی گسترده عملیاتی؛ بدون اختیار مالکیت و کنترل هسته مالک.",
    capabilities:["تمام قابلیت‌های سودو متوسط","مدیریت تنظیمات گروه","مرکز قفل و امنیت","اخطار و جریمه","ممیزی عملیات","کنترل قابلیت‌های مجاز"],
  },
  security:{
    title:"سودو امنیتی",
    summary:"لایه محافظتی برای جلوگیری از سوءاستفاده، ارتقای دسترسی و دستکاری مالک.",
    capabilities:["ثبت کامل عملیات","اتصال دسترسی به شناسه کاربر","ممانعت از ارتقای سطح توسط سودو","ممانعت از دسترسی به مالک اصلی","لغو فوری دسترسی","محدودسازی عملیات حساس","ممیزی تغییرات امنیتی"],
  },
};

function button(text:string,callback_data:string,style:"primary"|"success"|"danger"|"link"="primary"){
  return {text,callback_data,style};
}

function buttons(items:Array<{text:string;callback_data:string;style?:"primary"|"success"|"danger"|"link"}>,align:"left"|"center"|"right"="center"){
  return {type:"buttons",align,buttons:items};
}

function table(caption:string,rows:Array<[string,string]>){
  return {
    type:"table",
    caption,
    is_bordered:true,
    is_striped:true,
    is_compact:false,
    cells:[
      [{text:"شاخص",is_header:true,align:"right",valign:"middle"},{text:"مقدار",is_header:true,align:"right",valign:"middle"}],
      ...rows.map(([label,value])=>[
        {text:label,align:"right",valign:"middle"},
        {text:value,align:"right",valign:"middle"},
      ]),
    ],
  };
}

function list(items:string[]){
  return {
    type:"list",
    items:items.map(text=>({blocks:[{type:"paragraph",text}]})),
  };
}

function doc(blocks:any[]):RichDocument{
  return prepareRichDocument({version:1,is_rtl:true,blocks});
}

function validate(docValue:RichDocument){
  const result=validateRichDocument(docValue);
  if(!result.ok)console.error("[owner-sudo] rich validation failed:",result.errors);
  return docValue;
}

function richReplyMarkup(document:RichDocument){
  const rows=document.blocks
    .filter(block=>block?.type==="buttons" && Array.isArray(block.buttons))
    .map(block=>(block.buttons as any[])
      .filter(button=>button?.callback_data || button?.url)
      .map(button=>button?.url
        ? {text:String(button.text??"—"),url:String(button.url)}
        : {text:String(button.text??"—"),callback_data:String(button.callback_data)}
      )
    )
    .filter(row=>row.length>0);
  return rows.length ? {inline_keyboard:rows} : undefined;
}

async function render(chatId:number,messageId:number|undefined,document:RichDocument){
  const rich=validate(document);
  const plain=richDocumentToPlainText(rich);
  const reply_markup=richReplyMarkup(rich);

  try{
    const richResult=messageId
      ? await telegramApi("editMessageText",{chat_id:chatId,message_id:messageId,rich_message:rich})
      : await telegramApi("sendRichMessage",{chat_id:chatId,rich_message:rich});
    if((richResult as any)?.ok===true)return richResult;
    console.warn("[owner-sudo] rich render unavailable; using legacy Telegram message");
  }catch(error){
    console.warn("[owner-sudo] rich render failed; using legacy Telegram message",error);
  }

  return messageId
    ? telegramApi("editMessageText",{
        chat_id:chatId,
        message_id:messageId,
        text:plain,
        ...(reply_markup?{reply_markup}:{}),
      })
    : telegramApi("sendMessage",{
        chat_id:chatId,
        text:plain,
        ...(reply_markup?{reply_markup}:{}),
      });
}

export function isManagedOwnerSudo(userId:number){
  return sudoCache.has(userId);
}

export async function loadOwnerSudoCache(pool:Pool){
  await ensureOwnerSudoSchema(pool);
  const rows=await listOwnerSudos(pool);
  sudoCache.clear();
  for(const row of rows)sudoCache.set(Number(row.user_id),row);
}

export async function getOwnerSudo(pool:Pool,userId:number){
  const cached=sudoCache.get(userId);
  if(cached)return cached;
  await ensureOwnerSudoSchema(pool);
  const row=(await pool.query("SELECT user_id,level,security_mode,active,granted_by,created_at,updated_at FROM bot_sudo_users WHERE user_id=$1 AND active=TRUE LIMIT 1",[userId])).rows[0] as SudoRow|undefined;
  if(row)sudoCache.set(userId,row);
  return row??null;
}

export function ownerSudoAllowsCommand(level:SudoLevel,commandId:string){
  const id=String(commandId||"").trim();
  if(level==="security")return LOW_COMMANDS.has(id);
  if(level==="pro")return true;
  if(level==="medium")return MEDIUM_COMMANDS.has(id);
  return LOW_COMMANDS.has(id);
}

export function ownerSudoOwnerProtected(){
  return true;
}

export async function ensureOwnerSudoSchema(pool:Pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sudo_users(
      user_id BIGINT PRIMARY KEY,
      level TEXT NOT NULL CHECK(level IN ('low','medium','pro','security')),
      security_mode BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      granted_by BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sudo_pending(
      actor_id BIGINT PRIMARY KEY,
      level TEXT NOT NULL CHECK(level IN ('low','medium','pro','security')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_sudo_audit(
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT NOT NULL,
      target_id BIGINT,
      action TEXT NOT NULL,
      level TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
function levelTitle(level:string){
  return LEVELS[level as SudoLevel]?.title ?? "نامشخص";
}

async function audit(pool:Pool,actor:number,target:number|null,action:string,level?:string,meta:Record<string,unknown>={}){
  await pool.query(
    "INSERT INTO bot_sudo_audit(actor_id,target_id,action,level,meta) VALUES($1,$2,$3,$4,$5::jsonb)",
    [actor,target,action,level??null,JSON.stringify(meta)]
  ).catch(error=>console.error("[owner-sudo] audit failed:",error));
}

export async function listOwnerSudos(pool:Pool):Promise<SudoRow[]>{
  const r=await pool.query("SELECT user_id,level,security_mode,active,granted_by,created_at,updated_at FROM bot_sudo_users WHERE active=TRUE ORDER BY created_at DESC");
  return r.rows as SudoRow[];
}

export async function assignOwnerSudo(pool:Pool,actor:number,target:number,level:SudoLevel,ownerIds:string[]){
  await ensureOwnerSudoSchema(pool);
  if(!Number.isSafeInteger(target)||target<=0)return {ok:false,message:"شناسه کاربر معتبر نیست."};
  if(target===actor||ownerIds.includes(String(target))||target===8247710529)return {ok:false,message:"مالک اصلی نمی‌تواند سودو شود."};
  await pool.query(
    `INSERT INTO bot_sudo_users(user_id,level,security_mode,active,granted_by)
     VALUES($1,$2,$3,TRUE,$4)
     ON CONFLICT(user_id) DO UPDATE SET level=EXCLUDED.level,security_mode=EXCLUDED.security_mode,active=TRUE,granted_by=EXCLUDED.granted_by,updated_at=NOW()`,
    [target,level,level==="security",actor]
  );
  const row=(await pool.query("SELECT user_id,level,security_mode,active,granted_by,created_at,updated_at FROM bot_sudo_users WHERE user_id=$1 LIMIT 1",[target])).rows[0] as SudoRow;
  sudoCache.set(target,row);
  await audit(pool,actor,target,"grant",level,{security_mode:true});
  return {ok:true,message:"دسترسی سودو ثبت شد."};
}

export async function removeOwnerSudo(pool:Pool,actor:number,target:number){
  await ensureOwnerSudoSchema(pool);
  await pool.query("UPDATE bot_sudo_users SET active=FALSE,updated_at=NOW() WHERE user_id=$1",[target]);
  sudoCache.delete(target);
  await audit(pool,actor,target,"revoke");
  return {ok:true};
}

function baseBlocks(title:string,subtitle:string){
  return [
    {type:"heading",text:"◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · "+title,size:1},
    {type:"paragraph",text:subtitle},
    {type:"divider"},
  ];
}

export async function sendOwnerSudoCenter(chatId:number,messageId?:number){
  const document=doc([
    ...baseBlocks("مرکز سودو","مدیریت سطح دسترسی سودوها با تفکیک سطح، ثبت عملیات و لایه امنیتی."),
    table("ساختار دسترسی",[
      ["سودو پایین","دسترسی پایه و مشاهده‌ای"],
      ["سودو متوسط","دسترسی عملیاتی کنترل‌شده"],
      ["سودو حرفه‌ای","دسترسی گسترده عملیاتی"],
      ["سودو امنیتی","لایه محافظتی و ضدارتقای دسترسی"],
    ]),
    {type:"divider"},
    {type:"details",summary:"معماری امنیتی",is_open:false,blocks:[
      {type:"paragraph",text:"سودوها مالک نیستند و نمی‌توانند سطح خود، مالک اصلی یا دسترسی امنیتی بالاتر را تغییر دهند."},
      {type:"paragraph",text:"تمام اعطا، تغییر و لغو دسترسی در ممیزی امنیتی ثبت می‌شود."},
    ]},
    buttons([
      button("سودو پایین","os:level:low","primary"),
      button("سودو متوسط","os:level:medium","primary"),
      button("سودو حرفه‌ای","os:level:pro","primary"),
      button("سودو امنیتی","os:level:security","danger"),
    ]),
    buttons([
      button("تعریف سودو","os:assign","success"),
      button("فهرست سودوها","os:list","primary"),
    ]),
    buttons([
      button("قوانین امنیتی","os:security","danger"),
      button("‹ بازگشت","o:home","link"),
    ]),
    {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
  ]);
  return render(chatId,messageId,document);
}

export function sudoLevelDocument(level:SudoLevel){
  const info=LEVELS[level];
  return doc([
    ...baseBlocks(info.title,info.summary),
    table("حدود دسترسی",[
      ["سطح",""+info.title],
      ["وضعیت","قابل تخصیص توسط مالک"],
      ["مالکیت","غیرقابل انتقال"],
      ["ارتقای خودکار","غیرفعال"],
    ]),
    {type:"heading",text:"قابلیت‌ها",size:2},
    list(info.capabilities),
    {type:"divider"},
    {type:"paragraph",text:level==="security"?"این سطح برای سخت‌سازی دسترسی است و نباید به‌عنوان جایگزین مالکیت استفاده شود.":"این سطح فقط در محدوده تعریف‌شده توسط مالک فعالیت می‌کند."},
    buttons([
      button("انتخاب این سطح","os:choose:"+level,"success"),
      button("‹ بازگشت","os:center","link"),
    ]),
    {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
  ]);
}

export async function ownerSudoCallback(pool:Pool,chatId:number,messageId:number,actor:number,data:string,ownerIds:string[]){
  await ensureOwnerSudoSchema(pool);
  if(data==="os:center"){ pendingAssignments.delete(actor); await pool.query("DELETE FROM bot_sudo_pending WHERE actor_id=$1",[actor]); return sendOwnerSudoCenter(chatId,messageId); }
  if(data==="os:assign"){
    pendingAssignments.delete(actor);
    return render(chatId,messageId,doc([
      ...baseBlocks("تعریف سودو","ابتدا سطح دسترسی را انتخاب کنید؛ سپس شناسه عددی کاربر را دریافت می‌کنیم."),
      {type:"paragraph",text:"هیچ سودویی به‌صورت خودکار مالک نمی‌شود و سطح انتخاب‌شده قابل ارتقا توسط خود سودو نیست."},
      buttons([
        button("سودو پایین","os:choose:low","primary"),
        button("سودو متوسط","os:choose:medium","primary"),
        button("سودو حرفه‌ای","os:choose:pro","primary"),
        button("سودو امنیتی","os:choose:security","danger"),
      ]),
      buttons([button("‹ بازگشت","os:center","link")]),
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
    ]));
  }
  if(data.startsWith("os:level:")){
    const level=data.slice("os:level:") as SudoLevel;
    if(!LEVELS[level])return;
    return render(chatId,messageId,sudoLevelDocument(level));
  }
  if(data.startsWith("os:choose:")){
    const level=data.slice("os:choose:") as SudoLevel;
    if(!LEVELS[level])return;
    pendingAssignments.set(actor,level);
    await pool.query("INSERT INTO bot_sudo_pending(actor_id,level) VALUES($1,$2) ON CONFLICT(actor_id) DO UPDATE SET level=EXCLUDED.level,updated_at=NOW()",[actor,level]);
    return render(chatId,messageId,doc([
      ...baseBlocks("ثبت سودو","شناسه عددی کاربر موردنظر را ارسال کنید."),
      table("انتخاب فعلی",[
        ["سطح",LEVELS[level].title],
        ["حالت امنیتی",level==="security"?"فعال":"استاندارد"],
      ]),
      {type:"paragraph",text:"پس از دریافت شناسه، دسترسی ثبت و در ممیزی امنیتی ذخیره می‌شود."},
      buttons([button("لغو","os:center","link")]),
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
    ]));
  }
  if(data==="os:list"){
    const rows=await listOwnerSudos(pool);
    const blocks=baseBlocks("فهرست سودوها",rows.length?"سودوهای فعال ثبت‌شده در سیستم.":"هیچ سودوی فعالی ثبت نشده است.");
    if(rows.length){
      blocks.push(table("دسترسی‌های فعال",rows.map(x=>[String(x.user_id),levelTitle(x.level)+(x.security_mode?" · امنیتی":"")])) as any);
      for(const row of rows){
        blocks.push(buttons([
          button("لغو "+row.user_id,"os:revoke:"+row.user_id,"danger"),
          button("تغییر سطح","os:level_for:"+row.user_id,"primary"),
        ]));
      }
    }
    blocks.push(buttons([button("‹ بازگشت","os:center","link")]));
    blocks.push({type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"});
    return render(chatId,messageId,doc(blocks));
  }
  if(data.startsWith("os:revoke:")){
    const target=Number(data.slice("os:revoke:".length));
    await removeOwnerSudo(pool,actor,target);
    return ownerSudoCallback(pool,chatId,messageId,actor,"os:list",ownerIds);
  }
  if(data.startsWith("os:level_for:")){
    const target=Number(data.slice("os:level_for:".length));
    return render(chatId,messageId,doc([
      ...baseBlocks("تغییر سطح سودو","سطح جدید را انتخاب کنید."),
      {type:"paragraph",text:"شناسه کاربر: "+target},
      buttons([
        button("پایین","os:set:"+target+":low","primary"),
        button("متوسط","os:set:"+target+":medium","primary"),
        button("حرفه‌ای","os:set:"+target+":pro","primary"),
        button("امنیتی","os:set:"+target+":security","danger"),
      ]),
      buttons([button("‹ بازگشت","os:list","link")]),
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
    ]));
  }
  if(data.startsWith("os:set:")){
    const parts=data.split(":");
    const target=Number(parts[2]);const level=parts[3] as SudoLevel;
    if(!LEVELS[level])return;
    const result=await assignOwnerSudo(pool,actor,target,level,ownerIds);
    return render(chatId,messageId,doc([
      ...baseBlocks(result.ok?"دسترسی ثبت شد":"ثبت دسترسی انجام نشد",result.message),
      table("نتیجه",[["شناسه",String(target)],["سطح",LEVELS[level].title],["وضعیت",result.ok?"فعال":"رد شده"]]),
      buttons([button("فهرست سودوها","os:list","primary"),button("مرکز سودو","os:center","link")]),
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
    ]));
  }
  if(data==="os:security"){
    return render(chatId,messageId,doc([
      ...baseBlocks("سودو امنیتی","لایه‌ای برای محدودکردن مسیرهای سوءاستفاده و حفظ اختیار مالک."),
      {type:"heading",text:"قوانین محافظتی",size:2},
      list([
        "سودو نمی‌تواند خودش را به سطح بالاتر ارتقا دهد.",
        "سودو نمی‌تواند مالک اصلی را تغییر دهد یا حذف کند.",
        "دسترسی‌های سودو در جدول مستقل نگهداری می‌شوند.",
        "اعطا، تغییر و لغو دسترسی ثبت ممیزی دارد.",
        "لغو دسترسی از سمت مالک فوری است.",
        "عملیات حساس باید در محدوده سطح تعیین‌شده باقی بماند.",
      ]),
      buttons([button("تعریف سودو امنیتی","os:choose:security","danger"),button("‹ بازگشت","os:center","link")]),
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Sᴇᴄᴜʀɪᴛʏ Sᴜᴅᴏ"},
    ]));
  }
}

export async function handleOwnerSudoTextInput(pool:Pool,actor:number,chatId:number,text:string,ownerIds:string[]){
  let level=pendingAssignments.get(actor);
  if(!level){
    const pending=(await pool.query("SELECT level FROM bot_sudo_pending WHERE actor_id=$1 LIMIT 1",[actor])).rows[0] as {level:SudoLevel}|undefined;
    if(pending?.level) level=pending.level;
  }
  if(!level)return false;

  const clean=String(text||"").trim().replace(/^\s*\+?/,"");
  if(!/^\d{5,20}$/.test(clean)){
    await render(chatId,undefined,doc([
      ...baseBlocks("ثبت سودو","شناسه عددی معتبر ارسال کنید."),
      buttons([button("لغو","os:center","link")]),
      {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
    ]));
    return true;
  }

  const target=Number(clean);
  const result=await assignOwnerSudo(pool,actor,target,level,ownerIds);
  pendingAssignments.delete(actor);
  await pool.query("DELETE FROM bot_sudo_pending WHERE actor_id=$1",[actor]);
  await render(chatId,undefined,doc([
    ...baseBlocks(result.ok?"دسترسی ثبت شد":"ثبت دسترسی انجام نشد",result.message),
    table("نتیجه",[
      ["شناسه",String(target)],
      ["سطح",LEVELS[level].title],
      ["وضعیت",result.ok?"فعال":"رد شده"],
    ]),
    buttons([
      button("فهرست سودوها","os:list","primary"),
      button("مرکز سودو","os:center","link"),
    ]),
    {type:"footer",text:"Pᴇʀsɪᴀɴ ᴮᵒᵗ · Mᴀɴᴀɢᴇᴅ Sᴜᴅᴏ"},
  ]));
  return true;
}
