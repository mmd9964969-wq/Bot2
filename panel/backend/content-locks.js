
const { query } = require("./database");

const VALID_EXCEPTIONS = new Set(["user","role","forward_source"]);

function send(res,status,body,type="application/json; charset=utf-8"){
  res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store"});
  res.end(body);
}
function validId(value){
  const s=String(value??"").trim();
  return /^-?[0-9]+$/.test(s)&&s!=="0"?s:null;
}
function clean(value,max=5000){
  return String(value??"").trim().slice(0,max);
}
function json(value){
  try{return JSON.stringify(value??{});}catch{return "{}";}
}
function int(value,fallback,min,max){
  const n=Number(value);
  return Number.isFinite(n)?Math.min(Math.max(Math.trunc(n),min),max):fallback;
}

function defaultRules(){
  const a=[];
  const add=(section,rule_key,title,description,enabled=false,config={})=>a.push({section,rule_key,title,description,enabled,config});
  add("normal","normal_media","قفل رسانه","قفل ساده و یکپارچه برای تمام رسانه‌های معمولی.",false,{action:"delete"});
  add("normal","normal_links","قفل لینک","قفل همه لینک‌ها در حالت عادی.",false,{action:"delete_notify"});
  add("normal","normal_ads","قفل تبلیغات","قفل تشخیص تبلیغات، لینک و شماره‌های تبلیغاتی.",false,{action:"delete_notify"});
  add("normal","normal_files","قفل فایل","قفل فایل‌ها و اسناد ارسالی.",false,{action:"delete"});
  add("normal","normal_forward","قفل فوروارد","قفل همه پیام‌های فورواردشده.",false,{action:"delete_notify"});
  add("normal","normal_contact","قفل تماس","قفل ارسال مخاطب.",false,{action:"delete_notify"});
  add("normal","normal_location","قفل موقعیت","قفل موقعیت و Venue.",false,{action:"delete_notify"});
  add("normal","normal_poll","قفل نظرسنجی","قفل نظرسنجی.",false,{action:"delete"});
  add("normal","normal_dice","قفل تاس","قفل Dice.",false,{action:"delete"});
  add("normal","normal_game","قفل بازی","قفل بازی‌های Telegram.",false,{action:"delete"});
  add("normal","normal_web_app","قفل وب‌اپ","قفل داده Web App.",false,{action:"delete"});
  add("normal","normal_reply","قفل ریپلای","قفل پاسخ به پیام‌های دیگر.",false,{action:"delete"});
  add("normal","normal_edit","قفل ویرایش","قفل ویرایش پیام.",false,{action:"delete_notify"});
  add("normal","normal_mention","قفل منشن","قفل منشن و تگ.",false,{action:"delete"});
  add("normal","normal_bot","قفل ربات","جلوگیری از ورود ربات به گروه.",false,{action:"delete_ban"});
  add("links","links_all","تمام لینک‌ها","تمام لینک‌های قابل تشخیص مسدود شوند.",false,{action:"delete_notify"});
  add("links","links_telegram","لینک‌های تلگرام","لینک‌های t.me و Telegram کنترل شوند.",true,{action:"delete_notify"});
  add("links","links_external","لینک‌های خارجی","لینک‌های خارجی مسدود شوند.",false,{action:"delete_notify"});
  add("links","links_invites","لینک‌های دعوت","لینک‌های دعوت Telegram مسدود شوند.",false,{action:"delete_notify"});
  add("links","links_username","یوزرنیم لینک","لینک/یوزرنیم‌های قابل تشخیص مسدود شوند.",false,{action:"delete"});
  add("links","links_phone","شماره در لینک","لینک‌های دارای شماره کنترل شوند.",false,{action:"delete_notify"});
  add("links","links_auto_delete","حذف خودکار لینک غیرمجاز","بعد از تشخیص لینک حذف انجام شود.",true,{});
  add("links","links_notify","اعلان لینک","برای لینک مسدودشده اعلان ارسال شود.",false,{});
  add("advertising","advertising_text","متن تبلیغاتی","عبارت‌های رایج تبلیغاتی تشخیص داده شوند.",false,{action:"delete_notify"});
  add("advertising","advertising_links","لینک تبلیغاتی","هر لینک به‌عنوان تبلیغ کنترل شود.",false,{action:"delete_notify"});
  add("advertising","advertising_invites","دعوت تبلیغاتی","دعوت‌نامه‌های تبلیغاتی کنترل شوند.",false,{action:"delete_notify"});
  add("advertising","advertising_phone","شماره تبلیغاتی","شماره‌های تلفن در پیام‌های تبلیغاتی کنترل شوند.",false,{action:"delete_notify"});
  add("advertising","advertising_username","یوزرنیم تبلیغاتی","یوزرنیم‌های تبلیغاتی کنترل شوند.",false,{action:"delete_notify"});
  add("media","media_photo","عکس","ارسال عکس کنترل شود.",false,{max_mb:20,max_per_minute:0,action:"delete"});
  add("media","media_video","ویدیو","ارسال ویدیو کنترل شود.",false,{max_mb:50,max_per_minute:0,action:"delete"});
  add("media","media_audio","موزیک / Audio","ارسال Audio کنترل شود.",false,{max_mb:50,max_per_minute:0,action:"delete"});
  add("media","media_animation","GIF / Animation","GIF و Animation کنترل شود.",false,{max_mb:50,max_per_minute:0,action:"delete"});
  add("media","media_sticker","استیکر","ارسال استیکر کنترل شود.",false,{max_mb:5,max_per_minute:0,action:"delete"});
  add("media","media_voice","ویس","ارسال Voice کنترل شود.",false,{max_mb:50,max_per_minute:0,action:"delete"});
  add("media","media_video_note","ویدیو نوت","ارسال Video Note کنترل شود.",false,{max_mb:50,max_per_minute:0,action:"delete"});
  add("forwarding","forward_all","همه فورواردها","تمام Forwardها مسدود شوند.",false,{action:"delete_notify"});
  add("forwarding","forward_groups","فوروارد از گروه‌ها","Forward از گروه‌ها کنترل شود.",false,{action:"delete_notify"});
  add("forwarding","forward_channels","فوروارد از کانال‌ها","Forward از کانال‌ها کنترل شود.",false,{action:"delete_notify"});
  add("forwarding","forward_private","فوروارد از پیوی","Forward از کاربران خصوصی کنترل شود.",false,{action:"delete_notify"});
  add("forwarding","forward_auto_delete","حذف خودکار فوروارد","Forward مسدودشده حذف شود.",true,{});
  add("forwarding","forward_notify","اعلان فوروارد","بعد از تشخیص Forward اعلان ارسال شود.",false,{});
  add("files","file_documents","اسناد","Documentها کنترل شوند.",false,{max_mb:20,action:"delete",blocked_extensions:[],allowed_extensions:[]});
  add("files","file_archives","فایل‌های فشرده","ZIP/RAR و فایل‌های مشابه کنترل شوند.",false,{max_mb:20,action:"delete"});
  add("files","file_executables","فایل‌های اجرایی","پسوندهای اجرایی مسدود شوند.",true,{max_mb:20,action:"delete_notify"});
  add("files","file_auto_delete","حذف فایل غیرمجاز","فایل غیرمجاز حذف شود.",true,{});
  add("files","file_max_size","حداکثر حجم فایل","حداکثر حجم فایل کنترل شود.",true,{max_mb:50,action:"delete"});
  add("messages","message_min_length","حداقل طول پیام","پیام‌های بسیار کوتاه حذف شوند.",false,{min_chars:2,action:"delete"});
  add("messages","message_max_length","حداکثر طول پیام","پیام‌های بیش از حد طولانی حذف شوند.",false,{max_chars:4000,action:"delete"});
  add("messages","message_rate_limit","محدودیت پیام در دقیقه","نرخ ارسال پیام هر کاربر کنترل شود.",false,{count:10,window_seconds:60,action:"delete"});
  add("interactions","reply_lock","قفل ریپلای","Reply کنترل شود.",false,{action:"delete"});
  add("interactions","edit_lock","قفل ویرایش متن","ویرایش پیام کنترل شود.",false,{action:"delete_notify"});
  add("interactions","hashtag_limit","محدودیت هشتگ","تعداد هشتگ در پیام محدود شود.",false,{max_hashtags:5,action:"delete"});
  add("interactions","mention_limit","محدودیت منشن","تعداد منشن در پیام محدود شود.",false,{max_mentions:5,action:"delete"});
  add("interactions","username_lock","قفل یوزرنیم","منشن‌های یوزرنیمی کنترل شوند.",false,{action:"delete_notify"});
  add("interactions","phone_lock","قفل شماره تلفن","شماره‌های تلفن کنترل شوند.",false,{action:"delete_notify"});
  add("interactions","email_lock","قفل ایمیل","ایمیل‌ها کنترل شوند.",false,{action:"delete_notify"});
  add("interactions","web_preview_lock","قفل پیش‌نمایش لینک","Web preview کنترل شود.",false,{action:"delete"});
  add("interactions","story_share_lock","قفل اشتراک‌گذاری Story","Story share کنترل شود.",false,{action:"delete_notify"});
  add("advanced","contact_lock","قفل Contact","Contact کنترل شود.",false,{action:"delete_notify"});
  add("advanced","location_lock","قفل Location","Location و Venue کنترل شود.",false,{action:"delete_notify"});
  add("advanced","poll_lock","قفل Poll","Poll کنترل شود.",false,{action:"delete"});
  add("advanced","dice_lock","قفل Dice","Dice کنترل شود.",false,{action:"delete"});
  add("advanced","game_lock","قفل Game","Game کنترل شود.",false,{action:"delete"});
  add("advanced","web_app_lock","قفل Web App","Web App Data کنترل شود.",false,{action:"delete"});
  add("advanced","bot_join_lock","قفل ورود ربات","ورود ربات‌ها مسدود شود.",false,{action:"delete_ban"});
  add("language","language_persian","زبان فارسی","پیام‌های فارسی/پارسی کنترل شوند.",false,{action:"delete"});
  add("language","language_english","زبان انگلیسی","پیام‌های انگلیسی کنترل شوند.",false,{action:"delete"});
  add("language","language_arabic","زبان عربی","پیام‌های عربی کنترل شوند.",false,{action:"delete"});
  add("language","language_russian","زبان روسی","پیام‌های روسی/سیریلیک کنترل شوند.",false,{action:"delete"});
  add("language","language_turkish","زبان ترکی","پیام‌های ترکی کنترل شوند.",false,{action:"delete"});
  add("language","language_chinese","زبان چینی","پیام‌های چینی کنترل شوند.",false,{action:"delete"});
  add("language","language_japanese","زبان ژاپنی","پیام‌های ژاپنی کنترل شوند.",false,{action:"delete"});
  add("language","language_korean","زبان کره‌ای","پیام‌های کره‌ای کنترل شوند.",false,{action:"delete"});
  add("anti_attack","attack_flood","ضد فلود سریع","Burst پیام کنترل شود.",true,{count:8,window_seconds:5,action:"delete"});
  add("anti_attack","attack_duplicate","ضد پیام تکراری","پیام مشابه در بازه کوتاه مسدود شود.",true,{count:3,window_seconds:30,action:"delete"});
  add("anti_attack","attack_caps","کنترل CAPS","پیام‌های بیش از حد با CAPS کنترل شوند.",false,{percent:90,min_letters:20,action:"delete"});
  add("anti_attack","attack_link_burst","ضد Link Burst","هجوم لینک محدود شود.",false,{count:3,window_seconds:15,action:"delete"});
  add("anti_attack","attack_media_burst","ضد Media Burst","ارسال پشت‌سرهم رسانه محدود شود.",false,{count:5,window_seconds:15,action:"delete"});
  add("anti_attack","attack_join_flood","ضد هجوم عضو","ورود گروهی اعضا در بازه کوتاه کنترل شود.",false,{count:5,window_seconds:30,action:"delete"});
  return a;
}

async function ensureContentLocksSchema(){
  await query("CREATE TABLE IF NOT EXISTS content_lock_settings (group_id BIGINT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT TRUE,exempt_admins BOOLEAN NOT NULL DEFAULT TRUE,notify_user BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS content_lock_rules (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,section TEXT NOT NULL,rule_key TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',enabled BOOLEAN NOT NULL DEFAULT FALSE,config JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,rule_key))");
  await query("CREATE TABLE IF NOT EXISTS content_lock_exceptions (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,exception_type TEXT NOT NULL,target_id TEXT NOT NULL,target_label TEXT NOT NULL DEFAULT '',scope JSONB NOT NULL DEFAULT '[\"all\"]'::jsonb,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,exception_type,target_id))");
  await query("CREATE TABLE IF NOT EXISTS content_lock_domains (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,domain TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(group_id,domain))");
  await query("CREATE TABLE IF NOT EXISTS content_lock_logs (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,message_id BIGINT,user_id BIGINT,username TEXT,first_name TEXT,content_type TEXT NOT NULL,rule_key TEXT NOT NULL,action TEXT NOT NULL,admin_id TEXT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE INDEX IF NOT EXISTS idx_content_lock_rules_group ON content_lock_rules(group_id,section,enabled)");
  await query("CREATE INDEX IF NOT EXISTS idx_content_lock_exceptions_group ON content_lock_exceptions(group_id,enabled)");
  await query("CREATE INDEX IF NOT EXISTS idx_content_lock_logs_group_time ON content_lock_logs(group_id,created_at DESC)");
  await query("CREATE INDEX IF NOT EXISTS idx_content_lock_logs_user ON content_lock_logs(group_id,user_id,created_at DESC)");
}

async function ensureGroup(groupId){
  await query("INSERT INTO bot_groups(id,title,username,type,is_active,updated_at) VALUES($1,'',NULL,'supergroup',TRUE,NOW()) ON CONFLICT(id) DO UPDATE SET is_active=TRUE,updated_at=NOW()",[groupId]);
  await query("INSERT INTO content_lock_settings(group_id) VALUES($1) ON CONFLICT(group_id) DO NOTHING",[groupId]);
  for(const rule of defaultRules()){
    await query("INSERT INTO content_lock_rules(group_id,section,rule_key,title,description,enabled,config) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(group_id,rule_key) DO UPDATE SET section=EXCLUDED.section,title=EXCLUDED.title,description=EXCLUDED.description",[groupId,rule.section,rule.rule_key,rule.title,rule.description,rule.enabled,json(rule.config)]);
  }
}

async function audit(action,actor,target,before,after){
  try{
    await query("INSERT INTO audit_logs(actor_id,action,target,before_data,after_data,source) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,'panel')",[actor||null,action,target||null,json(before),json(after)]);
  }catch(error){console.error("[content-locks] audit failed:",error.message);}
}

async function readBody(req){
  return new Promise((resolve,reject)=>{
    let data="";
    req.on("data",chunk=>{data+=chunk;if(data.length>1024*1024){reject(new Error("Request body too large"));req.destroy();}});
    req.on("end",()=>{try{resolve(data?JSON.parse(data):{});}catch{reject(new Error("Invalid JSON"));}});
    req.on("error",reject);
  });
}

async function contentLocksApi(req,res,url){
  try{
    if(req.method==="GET"&&url.pathname==="/api/content-locks/groups"){
      const rows=(await query("SELECT id,title,username,type,is_active,updated_at FROM bot_groups WHERE is_active=TRUE ORDER BY updated_at DESC LIMIT 100")).rows;
      return send(res,200,json({groups:rows}));
    }
    if(req.method==="GET"&&url.pathname==="/api/content-locks/overview"){
      const groupId=validId(url.searchParams.get("group_id")); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const settings=(await query("SELECT * FROM content_lock_settings WHERE group_id=$1",[groupId])).rows[0];
      const [rules,blocked,exceptions]=await Promise.all([
        query("SELECT COUNT(*)::int AS count FROM content_lock_rules WHERE group_id=$1 AND enabled=TRUE",[groupId]),
        query("SELECT COUNT(*)::int AS count FROM content_lock_logs WHERE group_id=$1 AND created_at>=CURRENT_DATE AND action LIKE 'delete%' AND action NOT LIKE '%failed%'",[groupId]),
        query("SELECT COUNT(*)::int AS count FROM content_lock_exceptions WHERE group_id=$1 AND enabled=TRUE",[groupId])
      ]);
      return send(res,200,json({settings,stats:{activeRules:rules.rows[0].count,blockedToday:blocked.rows[0].count,exceptions:exceptions.rows[0].count}}));
    }
    if(req.method==="GET"&&url.pathname==="/api/content-locks/rules"){
      const groupId=validId(url.searchParams.get("group_id")); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const rows=(await query("SELECT id,section,rule_key,title,description,enabled,config,updated_at FROM content_lock_rules WHERE group_id=$1 ORDER BY id",[groupId])).rows;
      return send(res,200,json({rules:rows}));
    }
    const sectionMatch=url.pathname.match(/^\/api\/content-locks\/sections\/([a-z0-9_]+)$/);
    if(sectionMatch&&req.method==="PUT"){
      const body=await readBody(req),groupId=validId(body.group_id),section=sectionMatch[1];
      if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const value=body.enabled===true;
      const whereSection=section==="all"?"TRUE":"section=$3";
      const before=(await query("SELECT COUNT(*)::int AS count FROM content_lock_rules WHERE group_id=$1 AND "+whereSection+(section==="all"?" AND enabled=TRUE":" AND enabled=TRUE"),section==="all"?[groupId]:[groupId,section])).rows[0]?.count||0;
      const result=section==="all"
        ? (await query("UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$2 RETURNING rule_key",[value,groupId])).rows
        : (await query("UPDATE content_lock_rules SET enabled=$1,updated_at=NOW() WHERE group_id=$2 AND section=$3 RETURNING rule_key",[value,groupId,section])).rows;
      await audit("content_lock_section_changed",body.actor_id,section,{active:before},{enabled:value,changed:result.length});
      return send(res,200,json({success:true,section,enabled:value,changed:result.length}));
    }
    if(req.method==="PUT"&&url.pathname==="/api/content-locks/settings"){
      const body=await readBody(req),groupId=validId(body.group_id); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const before=(await query("SELECT * FROM content_lock_settings WHERE group_id=$1",[groupId])).rows[0];
      const next={enabled:body.enabled===undefined?before.enabled:body.enabled===true,exempt_admins:body.exempt_admins===undefined?before.exempt_admins:body.exempt_admins===true,notify_user:body.notify_user===true};
      const row=(await query("UPDATE content_lock_settings SET enabled=$1,exempt_admins=$2,notify_user=$3,updated_at=NOW() WHERE group_id=$4 RETURNING *",[next.enabled,next.exempt_admins,next.notify_user,groupId])).rows[0];
      await audit("content_lock_settings_changed",body.actor_id,groupId,before,row);
      return send(res,200,json({settings:row}));
    }
    const ruleMatch=url.pathname.match(/^\/api\/content-locks\/rules\/([a-z0-9_]+)$/);
    if(ruleMatch&&req.method==="PUT"){
      const body=await readBody(req),groupId=validId(body.group_id),key=ruleMatch[1]; if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const before=(await query("SELECT * FROM content_lock_rules WHERE group_id=$1 AND rule_key=$2",[groupId,key])).rows[0];
      if(!before)return send(res,404,json({error:"Rule not found"}));
      const config=body.config&&typeof body.config==="object"?body.config:before.config||{};
      const row=(await query("UPDATE content_lock_rules SET enabled=$1,config=$2::jsonb,updated_at=NOW() WHERE group_id=$3 AND rule_key=$4 RETURNING *",[body.enabled===true,JSON.stringify(config),groupId,key])).rows[0];
      await audit("content_lock_rule_changed",body.actor_id,key,before,row);
      return send(res,200,json({rule:row}));
    }
    if(req.method==="POST"&&url.pathname==="/api/content-locks/reset"){
      const body=await readBody(req),groupId=validId(body.group_id); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      for(const rule of defaultRules())await query("UPDATE content_lock_rules SET enabled=$1,config=$2::jsonb,title=$3,description=$4,updated_at=NOW() WHERE group_id=$5 AND rule_key=$6",[rule.enabled,JSON.stringify(rule.config),rule.title,rule.description,groupId,rule.rule_key]);
      await audit("content_lock_rules_reset",body.actor_id,groupId,null,{reset:true});
      return send(res,200,json({success:true}));
    }
    if(req.method==="GET"&&url.pathname==="/api/content-locks/exceptions"){
      const groupId=validId(url.searchParams.get("group_id")); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const rows=(await query("SELECT * FROM content_lock_exceptions WHERE group_id=$1 ORDER BY id DESC",[groupId])).rows;
      return send(res,200,json({exceptions:rows}));
    }
    if(req.method==="POST"&&url.pathname==="/api/content-locks/exceptions"){
      const body=await readBody(req),groupId=validId(body.group_id),type=String(body.exception_type||"").trim(),targetId=clean(body.target_id,120);
      if(!groupId||!VALID_EXCEPTIONS.has(type)||!targetId)return send(res,400,json({error:"group_id, exception_type and target_id are required"}));
      await ensureGroup(groupId);
      const scope=Array.isArray(body.scope)&&body.scope.length?body.scope.map(x=>clean(x,40)).slice(0,20):["all"];
      const row=(await query("INSERT INTO content_lock_exceptions(group_id,exception_type,target_id,target_label,scope,enabled) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(group_id,exception_type,target_id) DO UPDATE SET target_label=EXCLUDED.target_label,scope=EXCLUDED.scope,enabled=EXCLUDED.enabled,updated_at=NOW() RETURNING *",[groupId,type,targetId,clean(body.target_label,160),JSON.stringify(scope),body.enabled!==false])).rows[0];
      await audit("content_lock_exception_upserted",body.actor_id,targetId,null,row);
      return send(res,201,json({exception:row}));
    }
    if(req.method==="PUT"&&url.pathname.match(/^\/api\/content-locks\/exceptions\/[0-9]+$/)){
      const id=Number(url.pathname.split("/").pop()),body=await readBody(req),groupId=validId(body.group_id),type=String(body.exception_type||"").trim(),targetId=clean(body.target_id,120);
      if(!groupId||!VALID_EXCEPTIONS.has(type)||!targetId)return send(res,400,json({error:"group_id, exception_type and target_id are required"}));
      const before=(await query("SELECT * FROM content_lock_exceptions WHERE id=$1 AND group_id=$2",[id,groupId])).rows[0];
      if(!before)return send(res,404,json({error:"Exception not found"}));
      const scope=Array.isArray(body.scope)&&body.scope.length?body.scope.map(x=>clean(x,40)).slice(0,20):["all"];
      const row=(await query("UPDATE content_lock_exceptions SET exception_type=$1,target_id=$2,target_label=$3,scope=$4::jsonb,enabled=$5,updated_at=NOW() WHERE id=$6 AND group_id=$7 RETURNING *",[type,targetId,clean(body.target_label,160),JSON.stringify(scope),body.enabled!==false,id,groupId])).rows[0];
      await audit("content_lock_exception_updated",body.actor_id,targetId,before,row);
      return send(res,200,json({exception:row}));
    }
    const excMatch=url.pathname.match(/^\/api\/content-locks\/exceptions\/([0-9]+)$/);
    if(excMatch&&req.method==="DELETE"){const id=Number(excMatch[1]),before=(await query("SELECT * FROM content_lock_exceptions WHERE id=$1",[id])).rows[0];if(!before)return send(res,404,json({error:"Exception not found"}));await query("DELETE FROM content_lock_exceptions WHERE id=$1",[id]);await audit("content_lock_exception_deleted",null,String(id),before,null);return send(res,200,json({success:true}));}
    if(req.method==="GET"&&url.pathname==="/api/content-locks/domains"){
      const groupId=validId(url.searchParams.get("group_id")); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      return send(res,200,json({domains:(await query("SELECT * FROM content_lock_domains WHERE group_id=$1 ORDER BY domain",[groupId])).rows}));
    }
    if(req.method==="POST"&&url.pathname==="/api/content-locks/domains"){
      const body=await readBody(req),groupId=validId(body.group_id),domain=clean(body.domain,255).toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"").trim();
      if(!groupId||!domain||!/^[a-z0-9.-]+$/i.test(domain))return send(res,400,json({error:"دامنه معتبر نیست"}));
      await ensureGroup(groupId);
      const row=(await query("INSERT INTO content_lock_domains(group_id,domain,enabled) VALUES($1,$2,$3) ON CONFLICT(group_id,domain) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *",[groupId,domain,body.enabled!==false])).rows[0];
      await audit("content_lock_domain_added",body.actor_id,domain,null,row);
      return send(res,201,json({domain:row}));
    }
    const domainMatch=url.pathname.match(/^\/api\/content-locks\/domains\/([0-9]+)$/);
    if(domainMatch&&req.method==="DELETE"){await query("DELETE FROM content_lock_domains WHERE id=$1",[Number(domainMatch[1])]);return send(res,200,json({success:true}));}
    if(req.method==="GET"&&url.pathname==="/api/content-locks/logs"){
      const groupId=validId(url.searchParams.get("group_id")); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      const q=clean(url.searchParams.get("q"),120).toLowerCase(),type=clean(url.searchParams.get("type"),60),rule=clean(url.searchParams.get("rule"),80),from=clean(url.searchParams.get("from"),30),to=clean(url.searchParams.get("to"),30),page=Math.max(Number(url.searchParams.get("page")||1),1),limit=Math.min(Math.max(Number(url.searchParams.get("limit")||20),10),100),offset=(page-1)*limit;
      const params=[groupId],where=["group_id=$1"];
      if(q){params.push("%"+q+"%");where.push("(LOWER(COALESCE(first_name,'')||' '||COALESCE(username,'')||' '||COALESCE(user_id::text,'')) LIKE $"+params.length+")");}
      if(type){params.push(type);where.push("content_type=$"+params.length);}
      if(rule){params.push(rule);where.push("rule_key=$"+params.length);}
      if(from){params.push(from+" 00:00:00+00");where.push("created_at >= $"+params.length);}
      if(to){params.push(to+" 23:59:59.999+00");where.push("created_at <= $"+params.length);}
      params.push(limit,offset);
      const rows=(await query("SELECT id,message_id,user_id,username,first_name,content_type,rule_key,action,admin_id,metadata,created_at,COUNT(*) OVER()::int AS total_count FROM content_lock_logs WHERE "+where.join(" AND ")+" ORDER BY created_at DESC LIMIT $"+(params.length-1)+" OFFSET $"+params.length,params)).rows;
      return send(res,200,json({page,limit,total:Number(rows[0]?.total_count||0),logs:rows.map(r=>{const x={...r};delete x.total_count;return x;})}));
    }
    if(req.method==="GET"&&url.pathname==="/api/content-locks/export"){
      const groupId=validId(url.searchParams.get("group_id")); if(!groupId)return send(res,400,"group_id is required","text/plain; charset=utf-8");
      const rows=(await query("SELECT created_at,content_type,rule_key,first_name,username,user_id,action,admin_id,message_id,metadata FROM content_lock_logs WHERE group_id=$1 ORDER BY created_at DESC LIMIT 5000",[groupId])).rows;
      const cells=v=>"\""+String(v??"").replaceAll("\"","\"\"").replace(/\r?\n/g," ")+"\"";
      const csv=["date,content_type,rule,first_name,username,user_id,action,admin_id,message_id,metadata",...rows.map(x=>[x.created_at,x.content_type,x.rule_key,x.first_name,x.username,x.user_id,x.action,x.admin_id,x.message_id,JSON.stringify(x.metadata||{})].map(cells).join(","))].join("\n");
      return send(res,200,"\uFEFF"+csv,"text/csv; charset=utf-8");
    }
    if(req.method==="POST"&&url.pathname==="/api/content-locks/test"){
      const body=await readBody(req),groupId=validId(body.group_id); if(!groupId)return send(res,400,json({error:"group_id is required"}));
      await ensureGroup(groupId);
      const text=clean(body.text,10000),type=clean(body.content_type,40)||"text",rules=(await query("SELECT rule_key,title,section,enabled,config FROM content_lock_rules WHERE group_id=$1 AND enabled=TRUE ORDER BY id",[groupId])).rows;
      const matches=[];
      const links=/(https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
      const hashtags=(text.match(/#[\p{L}\p{N}_-]+/gu)||[]).length;
      const mentions=(text.match(/@[A-Za-z0-9_]{3,64}/g)||[]).length;
      for(const r of rules){
        if(r.rule_key==="links_all"&&links)matches.push(r);
        else if(r.rule_key==="links_telegram"&&/(t\.me\/|telegram\.me\/)/i.test(text))matches.push(r);
        else if(r.rule_key==="links_external"&&/(https?:\/\/|www\.)/i.test(text)&&!/(t\.me\/|telegram\.me\/)/i.test(text))matches.push(r);
        else if(r.rule_key==="links_invites"&&/(t\.me\/(\+|joinchat\/)|telegram\.me\/(joinchat\/|\+))/i.test(text))matches.push(r);
        else if(r.rule_key==="message_min_length"&&text.length<int(r.config?.min_chars,2,1,10000))matches.push(r);
        else if(r.rule_key==="message_max_length"&&text.length>int(r.config?.max_chars,4000,1,20000))matches.push(r);
        else if(r.rule_key==="hashtag_limit"&&hashtags>int(r.config?.max_hashtags,5,1,100))matches.push(r);
        else if(r.rule_key==="mention_limit"&&mentions>int(r.config?.max_mentions,5,1,100))matches.push(r);
        else if(r.rule_key.startsWith("media_")&&r.rule_key.endsWith(type))matches.push(r);
      }
      return send(res,200,json({matches:matches.map(r=>({rule_key:r.rule_key,title:r.title,section:r.section,config:r.config}))}));
    }
  }catch(error){
    console.error("[content-locks] API error",error);
    return send(res,500,json({error:error.message||"Content lock API error"}));
  }
  return null;
}

module.exports={ensureContentLocksSchema,contentLocksApi,defaultRules};
