
const CONTENT_LOCK_SECTION_META={
  normal:{title:"قفل‌های حالت عادی",icon:"◈",desc:"قفل‌های اصلی و ساده؛ رسانه، لینک، تبلیغات، فایل، فوروارد و تعاملات پایه."},
  media:{title:"رسانه",icon:"◫",desc:"کنترل دقیق عکس، ویدیو، موزیک، GIF، استیکر، ویس و ویدیو نوت."},
  links:{title:"لینک‌ها",icon:"↗",desc:"کنترل همه لینک‌ها، دعوت‌نامه‌ها، یوزرنیم‌ها و دامنه‌های مجاز."},
  advertising:{title:"تبلیغات",icon:"◇",desc:"تشخیص و کنترل متن، لینک، دعوت، شماره و یوزرنیم تبلیغاتی."},
  forwarding:{title:"فوروارد و اشتراک‌گذاری",icon:"↪",desc:"کنترل Forward بر اساس نوع منبع، حذف خودکار و Story share."},
  files:{title:"فایل و سند",icon:"▤",desc:"کنترل سند، فایل فشرده، فایل اجرایی و محدودیت حجم."},
  messages:{title:"پیام و نرخ ارسال",icon:"≡",desc:"حداقل/حداکثر طول پیام و محدودیت نرخ ارسال."},
  interactions:{title:"تعامل و هویت",icon:"✎",desc:"ریپلای، ویرایش، هشتگ، منشن، یوزرنیم، شماره، ایمیل و پیش‌نمایش."},
  advanced:{title:"محتوای پیشرفته",icon:"◇",desc:"Contact، Location، Poll، Dice، Game، Web App و ورود ربات."},
  anti_attack:{title:"امنیت و ضد اتک",icon:"⚡",desc:"ضد Flood، پیام تکراری، CAPS، Link Burst، Media Burst و هجوم عضو."},
  language:{title:"قفل زبان",icon:"文",desc:"کنترل و مسدودسازی پیام‌ها بر اساس زبان تشخیص‌داده‌شده."}
};
const CONTENT_LABELS={
  normal_media:"قفل رسانه",normal_links:"قفل لینک",normal_ads:"قفل تبلیغات",normal_files:"قفل فایل",normal_forward:"قفل فوروارد",normal_contact:"قفل تماس",normal_location:"قفل موقعیت",normal_poll:"قفل نظرسنجی",normal_dice:"قفل تاس",normal_game:"قفل بازی",normal_web_app:"قفل وب‌اپ",normal_reply:"قفل ریپلای",normal_edit:"قفل ویرایش",normal_mention:"قفل منشن",normal_bot:"قفل ورود ربات",
  links_all:"تمام لینک‌ها",links_telegram:"لینک‌های تلگرام",links_external:"لینک‌های خارجی",links_invites:"لینک‌های دعوت",links_username:"یوزرنیم لینک",links_phone:"شماره در لینک",links_auto_delete:"حذف خودکار لینک غیرمجاز",links_notify:"اعلان لینک",
  advertising_text:"متن تبلیغاتی",advertising_links:"لینک تبلیغاتی",advertising_invites:"دعوت تبلیغاتی",advertising_phone:"شماره تبلیغاتی",advertising_username:"یوزرنیم تبلیغاتی",
  media_photo:"عکس",media_video:"ویدیو",media_audio:"موزیک / Audio",media_animation:"GIF / Animation",media_sticker:"استیکر",media_voice:"ویس",media_video_note:"ویدیو نوت",
  forward_all:"همه فورواردها",forward_groups:"فوروارد از گروه‌ها",forward_channels:"فوروارد از کانال‌ها",forward_private:"فوروارد از پیوی",forward_auto_delete:"حذف خودکار فوروارد",forward_notify:"اعلان فوروارد",
  file_documents:"اسناد",file_archives:"فایل‌های فشرده",file_executables:"فایل‌های اجرایی",file_auto_delete:"حذف فایل غیرمجاز",file_max_size:"حداکثر حجم فایل",
  message_min_length:"حداقل طول پیام",message_max_length:"حداکثر طول پیام",message_rate_limit:"محدودیت پیام در دقیقه",
  reply_lock:"قفل ریپلای",edit_lock:"قفل ویرایش متن",hashtag_limit:"محدودیت هشتگ",mention_limit:"محدودیت منشن",username_lock:"قفل یوزرنیم",phone_lock:"قفل شماره تلفن",email_lock:"قفل ایمیل",web_preview_lock:"قفل پیش‌نمایش لینک",story_share_lock:"قفل اشتراک‌گذاری Story",
  contact_lock:"قفل Contact",location_lock:"قفل Location",poll_lock:"قفل Poll",dice_lock:"قفل Dice",game_lock:"قفل Game",web_app_lock:"قفل Web App Data",bot_join_lock:"قفل ورود ربات",
  attack_flood:"ضد فلود سریع",attack_duplicate:"ضد پیام تکراری",attack_caps:"کنترل CAPS",attack_link_burst:"ضد Link Burst",attack_media_burst:"ضد Media Burst",attack_join_flood:"ضد هجوم عضو",language_persian:"زبان فارسی",language_english:"زبان انگلیسی",language_arabic:"زبان عربی",language_russian:"زبان روسی",language_turkish:"زبان ترکی",language_chinese:"زبان چینی",language_japanese:"زبان ژاپنی",language_korean:"زبان کره‌ای"
};
const contentLockState={groupId:null,rules:[],exceptions:[],domains:[],settings:null,tab:"normal",filter:""};
const clEsc=esc;
function clApi(url,opts={}){return fetch(url,{cache:"no-store",...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"خطای API");return d;});}
function clActor(){return window.localStorage.getItem("pbs_actor_id")||"PANEL_OWNER";}
function clToast(msg,error=false){let el=document.getElementById("contentLockToast");if(!el){el=document.createElement("div");el.id="contentLockToast";el.className="content-lock-toast";document.body.appendChild(el);}el.textContent=msg;el.classList.toggle("error",error);el.classList.add("show");clearTimeout(clToast.t);clToast.t=setTimeout(()=>el.classList.remove("show"),2600);}
function clValueLabel(key,cfg){
  const c=cfg||{};
  if(key==="message_min_length")return '<label>حداقل کاراکتر<input data-cfg="min_chars" type="number" min="1" max="10000" value="'+clEsc(c.min_chars??2)+'"></label>';
  if(key==="message_max_length")return '<label>حداکثر کاراکتر<input data-cfg="max_chars" type="number" min="1" max="20000" value="'+clEsc(c.max_chars??4000)+'"></label>';
  if(key==="message_rate_limit")return '<div class="content-config-pair"><label>تعداد<input data-cfg="count" type="number" min="1" max="1000" value="'+clEsc(c.count??10)+'"></label><label>بازه (ثانیه)<input data-cfg="window_seconds" type="number" min="1" max="3600" value="'+clEsc(c.window_seconds??60)+'"></label></div>';
  if(key.includes("media_")&&key!=="media_auto")return '<div class="content-config-pair"><label>حداکثر حجم MB<input data-cfg="max_mb" type="number" min="1" max="4096" value="'+clEsc(c.max_mb??50)+'"></label><label>حداکثر در دقیقه<input data-cfg="max_per_minute" type="number" min="0" max="1000" value="'+clEsc(c.max_per_minute??0)+'"></label></div>';
  if(key==="file_documents"||key==="file_archives"||key==="file_executables")return '<label>حداکثر حجم MB<input data-cfg="max_mb" type="number" min="1" max="4096" value="'+clEsc(c.max_mb??20)+'"></label><label>پسوندهای ممنوع<input data-cfg="blocked_extensions" value="'+clEsc((c.blocked_extensions||[]).join(", "))+'" placeholder="exe, apk, zip"></label><label>پسوندهای مجاز<input data-cfg="allowed_extensions" value="'+clEsc((c.allowed_extensions||[]).join(", "))+'" placeholder="pdf, docx"></label>';
  if(key==="file_max_size")return '<label>حداکثر حجم MB<input data-cfg="max_mb" type="number" min="1" max="4096" value="'+clEsc(c.max_mb??50)+'"></label>';
  if(key==="hashtag_limit")return '<label>حداکثر هشتگ<input data-cfg="max_hashtags" type="number" min="1" max="100" value="'+clEsc(c.max_hashtags??5)+'"></label>';
  if(key==="mention_limit")return '<label>حداکثر منشن<input data-cfg="max_mentions" type="number" min="1" max="100" value="'+clEsc(c.max_mentions??5)+'"></label>';
  if(key==="attack_flood"||key==="attack_duplicate"||key==="attack_link_burst"||key==="attack_media_burst")return '<div class="content-config-pair"><label>تعداد<input data-cfg="count" type="number" min="1" max="1000" value="'+clEsc(c.count??8)+'"></label><label>بازه ثانیه<input data-cfg="window_seconds" type="number" min="1" max="3600" value="'+clEsc(c.window_seconds??5)+'"></label></div>';
  if(key==="attack_caps")return '<div class="content-config-pair"><label>درصد CAPS<input data-cfg="percent" type="number" min="50" max="100" value="'+clEsc(c.percent??90)+'"></label><label>حداقل حرف<input data-cfg="min_letters" type="number" min="1" max="1000" value="'+clEsc(c.min_letters??20)+'"></label></div>';
  return '';
}
function clRuleCard(r){
  const c=r.config||{};
  const config=clValueLabel(r.rule_key,c);
  const action='<label>اقدام<select data-cfg="action"><option value="delete" '+(c.action==="delete"?"selected":"")+' >حذف</option><option value="delete_notify" '+(c.action==="delete_notify"?"selected":"")+'>حذف + اعلان</option><option value="delete_mute" '+(c.action==="delete_mute"?"selected":"")+'>حذف + سکوت</option><option value="delete_ban" '+(c.action==="delete_ban"?"selected":"")+'>حذف + اخراج موقت</option></select></label>';
  return '<article class="content-rule-card" data-rule-card="'+clEsc(r.rule_key)+'"><div class="content-rule-main"><span class="content-rule-icon">'+clEsc(CONTENT_LOCK_SECTION_META[r.section]?.icon||"◇")+'</span><div><b>'+clEsc(CONTENT_LABELS[r.rule_key]||r.title||r.rule_key)+'</b><small>'+clEsc(r.description||"قانون قابل تنظیم سیستم")+'</small></div><label class="content-switch"><input type="checkbox" data-enabled '+(r.enabled?"checked":"")+'><span></span></label></div><div class="content-rule-controls '+(r.enabled?"":"is-disabled")+'">'+config+action+'<button class="ghost content-save-rule" data-save-rule="'+clEsc(r.rule_key)+'">ذخیره این قانون</button></div></article>';
}
function clRenderRules(){
  const host=document.getElementById("contentLockRules");
  const meta=CONTENT_LOCK_SECTION_META[contentLockState.tab];
  const rows=contentLockState.rules.filter(r=>r.section===contentLockState.tab && (!contentLockState.filter||((CONTENT_LABELS[r.rule_key]||r.rule_key)+" "+(r.description||"")).toLowerCase().includes(contentLockState.filter.toLowerCase())));
  document.getElementById("contentLockSectionTitle").innerHTML='<span class="eyebrow">CONTENT POLICY</span><h2>'+clEsc(meta.title)+'</h2><p>'+clEsc(meta.desc)+'</p>';
  host.innerHTML=rows.length?rows.map(clRuleCard).join(""):'<div class="content-lock-empty"><span>◇</span><b>قانونی در این نما پیدا نشد</b><small>با جستجو یا انتخاب بخش دیگری، قوانین مرتبط را مشاهده کنید.</small></div>';
  host.querySelectorAll("[data-enabled]").forEach(input=>input.addEventListener("change",e=>e.target.closest(".content-rule-card").querySelector(".content-rule-controls").classList.toggle("is-disabled",!e.target.checked)));
  host.querySelectorAll("[data-save-rule]").forEach(btn=>btn.onclick=async()=>{const key=btn.dataset.saveRule,card=btn.closest(".content-rule-card"),enabled=card.querySelector("[data-enabled]").checked,config={};card.querySelectorAll("[data-cfg]").forEach(el=>{let v=el.value;if(["min_chars","max_chars","max_mb","max_per_minute","max_hashtags","max_mentions","count","window_seconds","percent","min_letters"].includes(el.dataset.cfg))v=Number(v);if(["blocked_extensions","allowed_extensions"].includes(el.dataset.cfg))v=v.split(",").map(x=>x.trim().replace(/^\./,"")).filter(Boolean);config[el.dataset.cfg]=v;});try{await clApi("/api/content-locks/rules/"+encodeURIComponent(key),{method:"PUT",body:JSON.stringify({group_id:contentLockState.groupId,enabled,config,actor_id:clActor()})});clToast("قانون «"+(CONTENT_LABELS[key]||key)+"» ذخیره شد.");await clLoad();}catch(e){clToast(e.message,true);}});
}
function clRenderSectionTabs(){
  const host=document.getElementById("contentLockTabs");
  host.innerHTML=Object.entries(CONTENT_LOCK_SECTION_META).map(([key,m],i)=>'<button class="content-tab '+(contentLockState.tab===key?"active":"")+'" data-tab="'+key+'"><span>'+m.icon+'</span><div><b>'+m.title+'</b><small>'+contentLockState.rules.filter(r=>r.section===key&&r.enabled).length+' فعال</small></div><i>'+String(i+1).padStart(2,"0")+'</i></button>').join("");
  host.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{contentLockState.tab=b.dataset.tab;clRenderSectionTabs();clRenderRules();});
}
function clRenderExceptions(){
  const host=document.getElementById("contentLockExceptions");
  const rows=contentLockState.exceptions;
  host.innerHTML=rows.length?'<div class="content-lock-table-wrap"><table class="content-lock-table"><thead><tr><th>نوع</th><th>هدف</th><th>دامنه اعمال</th><th>وضعیت</th><th></th></tr></thead><tbody>'+rows.map(x=>'<tr><td><span class="content-chip">'+clEsc(x.exception_type==="user"?"کاربر":x.exception_type==="role"?"نقش":"منبع فوروارد")+'</span></td><td><b>'+clEsc(x.target_label||x.target_id)+'</b><small>'+clEsc(x.target_id)+'</small></td><td>'+clEsc((x.scope||[]).join(" · "))+'</td><td><span class="content-status '+(x.enabled?"on":"off")+'">'+(x.enabled?"فعال":"غیرفعال")+'</span></td><td><button class="row-menu" data-del-exception="'+x.id+'">حذف</button></td></tr>').join("")+'</tbody></table></div>':'<div class="content-lock-empty large"><span>◇</span><b>هنوز استثنایی تعریف نشده است</b><small>برای جلوگیری از اعمال قفل روی یک کاربر، نقش یا منبع فوروارد، استثنا اضافه کنید.</small></div>';
  host.querySelectorAll("[data-del-exception]").forEach(b=>b.onclick=async()=>{if(!confirm("این استثنا حذف شود؟"))return;try{await clApi("/api/content-locks/exceptions/"+b.dataset.delException,{method:"DELETE"});clToast("استثنا حذف شد.");await clLoad();}catch(e){clToast(e.message,true);}});
}
function clRenderDomains(){
  const host=document.getElementById("contentLockDomains");
  host.innerHTML=contentLockState.domains.length?contentLockState.domains.map(d=>'<span class="domain-chip">'+clEsc(d.domain)+'<button data-del-domain="'+d.id+'" title="حذف">×</button></span>').join(""):'<div class="content-lock-mini-empty">دامنه مجازی ثبت نشده است.</div>';
  host.querySelectorAll("[data-del-domain]").forEach(b=>b.onclick=async()=>{try{await clApi("/api/content-locks/domains/"+b.dataset.delDomain,{method:"DELETE"});clToast("دامنه حذف شد.");await clLoad();}catch(e){clToast(e.message,true);}});
}
function clRenderLogs(logs=[]){
  const host=document.getElementById("contentLockLogs");
  host.innerHTML=logs.length?'<div class="content-lock-table-wrap"><table class="content-lock-table"><thead><tr><th>تاریخ و ساعت</th><th>نوع محتوا</th><th>قانون</th><th>کاربر</th><th>اقدام</th></tr></thead><tbody>'+logs.map(x=>'<tr><td>'+clEsc(new Date(x.created_at).toLocaleString("fa-IR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}))+'</td><td>'+clEsc(x.content_type)+'</td><td>'+clEsc(CONTENT_LABELS[x.rule_key]||x.rule_key)+'</td><td><b>'+clEsc(x.first_name||x.username||"—")+'</b><small>'+clEsc(x.username?"@"+x.username:x.user_id||"—")+'</small></td><td><span class="content-chip">'+clEsc(x.action)+'</span></td></tr>').join("")+'</tbody></table></div>':'<div class="content-lock-empty"><span>◌</span><b>لاگی ثبت نشده است</b><small>با اولین اجرای واقعی یک قانون، رویداد در این بخش ثبت می‌شود.</small></div>';
}
async function clLoad(){
  if(!contentLockState.groupId)return;
  const [o,r,e,d,l]=await Promise.all([
    clApi("/api/content-locks/overview?group_id="+encodeURIComponent(contentLockState.groupId)),
    clApi("/api/content-locks/rules?group_id="+encodeURIComponent(contentLockState.groupId)),
    clApi("/api/content-locks/exceptions?group_id="+encodeURIComponent(contentLockState.groupId)),
    clApi("/api/content-locks/domains?group_id="+encodeURIComponent(contentLockState.groupId)),
    clApi("/api/content-locks/logs?group_id="+encodeURIComponent(contentLockState.groupId)+"&limit=20")
  ]);
  contentLockState.settings=o.settings;contentLockState.rules=r.rules||[];contentLockState.exceptions=e.exceptions||[];contentLockState.domains=d.domains||[];
  document.getElementById("clActiveRules").textContent=o.stats.activeRules;
  document.getElementById("clBlockedToday").textContent=o.stats.blockedToday;
  document.getElementById("clExceptions").textContent=o.stats.exceptions;
  document.getElementById("clSystemState").textContent=o.settings?.enabled?"فعال":"غیرفعال";
  document.getElementById("clSystemState").className="content-stat-state "+(o.settings?.enabled?"on":"off");
  document.getElementById("contentLockMaster").checked=!!o.settings?.enabled;
  document.getElementById("clAdminExempt").checked=o.settings?.exempt_admins!==false;
  document.getElementById("clNotifyUser").checked=!!o.settings?.notify_user;
  clRenderSectionTabs();clRenderRules();clRenderExceptions();clRenderDomains();clRenderLogs(l.logs||[]);
}
async function userSearchContent(q){
  const d=await clApi("/api/users?q="+encodeURIComponent(q||"")+"\&limit=20");return d.users||[];
}
function clExceptionModal(){
  const w=document.createElement("div");w.className="modal-backdrop";w.innerHTML='<div class="modal content-lock-modal"><div class="modal-head"><div><span class="eyebrow">EXCEPTIONS</span><h2>افزودن استثنا</h2></div><button class="modal-close">×</button></div><form class="form-grid" id="clExceptionForm"><label>نوع استثنا<select name="exception_type"><option value="user">کاربر خاص</option><option value="role">نقش خاص</option><option value="forward_source">منبع فوروارد خاص</option></select></label><label>شناسه هدف<input name="target_id" required placeholder="Telegram ID یا Role"></label><label class="full">عنوان نمایشی<input name="target_label" placeholder="نام کاربر، نام نقش یا نام کانال"></label><div class="full"><b>دامنه اعمال استثنا</b><div class="content-scope-grid">'+Object.entries(CONTENT_LOCK_SECTION_META).map(([k,m])=>'<label><input type="checkbox" name="scope" value="'+k+'"> '+m.title+'</label>').join("")+'<label><input type="checkbox" name="scope" value="all" checked> همه بخش‌ها</label></div></div><div class="form-actions"><button type="button" class="ghost" data-cancel>انصراف</button><button class="primary">ثبت استثنا</button></div></form></div>';document.body.appendChild(w);const close=()=>w.remove();w.querySelector(".modal-close").onclick=close;w.querySelector("[data-cancel]").onclick=close;w.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const scope=f.getAll("scope");try{await clApi("/api/content-locks/exceptions",{method:"POST",body:JSON.stringify({group_id:contentLockState.groupId,exception_type:f.get("exception_type"),target_id:f.get("target_id"),target_label:f.get("target_label"),scope,actor_id:clActor()})});close();clToast("استثنا با موفقیت ثبت شد.");clLoad();}catch(err){clToast(err.message,true);}};}
function clDomainModal(){
  const w=document.createElement("div");w.className="modal-backdrop";w.innerHTML='<div class="modal content-lock-modal compact"><div class="modal-head"><div><span class="eyebrow">WHITELIST</span><h2>افزودن دامنه مجاز</h2></div><button class="modal-close">×</button></div><form class="form-grid" id="clDomainForm"><label class="full">دامنه<input name="domain" required placeholder="example.com"></label><div class="form-actions"><button type="button" class="ghost" data-cancel>انصراف</button><button class="primary">افزودن دامنه</button></div></form></div>';document.body.appendChild(w);const close=()=>w.remove();w.querySelector(".modal-close").onclick=close;w.querySelector("[data-cancel]").onclick=close;w.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await clApi("/api/content-locks/domains",{method:"POST",body:JSON.stringify({group_id:contentLockState.groupId,domain:f.get("domain"),actor_id:clActor()})});close();clToast("دامنه به لیست سفید اضافه شد.");clLoad();}catch(err){clToast(err.message,true);}};}
function clTester(){
  const w=document.createElement("div");w.className="modal-backdrop";w.innerHTML='<div class="modal content-lock-modal"><div class="modal-head"><div><span class="eyebrow">LIVE RULE TESTER</span><h2>آزمایشگر قوانین محتوا</h2><p>یک نمونه پیام را بررسی کنید تا قوانین فعالی که آن را مسدود می‌کنند مشخص شوند.</p></div><button class="modal-close">×</button></div><form id="clTestForm" class="form-grid"><label class="full">متن نمونه<textarea name="text" rows="6" placeholder="https://example.com یا #هشتگ @user"></textarea></label><label>نوع محتوا<select name="content_type"><option value="text">Text</option><option value="photo">Photo</option><option value="video">Video</option><option value="audio">Audio</option><option value="document">Document</option></select></label><div class="full" id="clTestResult"></div><div class="form-actions"><button type="button" class="ghost" data-cancel>بستن</button><button class="primary">اجرای تست</button></div></form></div>';document.body.appendChild(w);const close=()=>w.remove();w.querySelector(".modal-close").onclick=close;w.querySelector("[data-cancel]").onclick=close;w.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),out=w.querySelector("#clTestResult");out.innerHTML='<div class="loading-state">در حال تست...</div>';try{const d=await clApi("/api/content-locks/test",{method:"POST",body:JSON.stringify({group_id:contentLockState.groupId,text:f.get("text"),content_type:f.get("content_type")})});out.innerHTML=d.matches?.length?'<div class="test-match-list">'+d.matches.map(x=>'<div><span>✓</span><b>'+clEsc(CONTENT_LABELS[x.rule_key]||x.rule_key)+'</b><small>'+clEsc(x.section)+'</small></div>').join("")+'</div>':'<div class="content-lock-empty"><span>✓</span><b>قانون مسدودکننده‌ای پیدا نشد</b><small>نمونه پیام با قوانین فعال مطابقت نداشت.</small></div>';}catch(err){out.innerHTML='<div class="loading-state error">'+clEsc(err.message)+'</div>';}};}
async function warningsCompatGroups(){try{return (await clApi("/api/content-locks/groups")).groups||[];}catch{return [];}}
async function contentLocksPage(){
  shell("سیستم قفل و کنترل محتوا","فاز ۴ · CAPABILITY 13",`
    <div class="content-lock-hero"><div><span class="eyebrow">CONTENT LOCK · CONTROL CENTER</span><h1>سیستم قفل و کنترل محتوا</h1><p>کنترل دقیق رسانه، لینک، فایل، فوروارد، تعامل و ضداتک با قوانین قابل تنظیم و لاگ کامل.</p></div><div class="content-lock-hero-actions"><label>گروه فعال<select id="contentLockGroup"></select></label><button class="ghost" id="contentLockRefresh">↻ بروزرسانی</button><button class="primary" id="contentLockTester">آزمایشگر قوانین</button></div></div>
    <div class="content-lock-master"><div><b>کنترل مرکزی سیستم</b><small>خاموش‌کردن این کلید، تمام قوانین محتوایی را برای گروه متوقف می‌کند.</small></div><label class="content-switch big"><input id="contentLockMaster" type="checkbox"><span></span></label></div>
    <div class="content-lock-quick-actions">
      <div><span class="eyebrow">QUICK PRESETS</span><b>کنترل سریع</b><small>بخش‌های عادی را با یک عمل روشن یا خاموش کنید.</small></div>
      <div class="toolbar-actions">
        <button class="primary" id="clNormalOn">فعال‌سازی قفل‌های حالت عادی</button>
        <button class="ghost" id="clNormalOff">خاموش‌سازی قفل‌های حالت عادی</button>
        <button class="ghost" id="clAllOn">قفل همه</button>
        <button class="ghost" id="clAllOff">بازکردن همه</button>
      </div>
    </div>
    <div class="stats content-lock-stats">
      <div class="stat-card"><div class="stat-top"><span class="stat-icon gold">◇</span><span class="stat-kicker">ACTIVE RULES</span></div><strong id="clActiveRules">0</strong><span>قوانین فعال</span></div>
      <div class="stat-card"><div class="stat-top"><span class="stat-icon blue">×</span><span class="stat-kicker">BLOCKED TODAY</span></div><strong id="clBlockedToday">0</strong><span>پیام مسدودشده امروز</span></div>
      <div class="stat-card"><div class="stat-top"><span class="stat-icon purple">◌</span><span class="stat-kicker">EXCEPTIONS</span></div><strong id="clExceptions">0</strong><span>استثناهای تعریف‌شده</span></div>
      <div class="stat-card"><div class="stat-top"><span class="stat-icon green">●</span><span class="stat-kicker">SYSTEM</span></div><strong id="clSystemState">—</strong><span>وضعیت کلی سیستم</span></div>
    </div>
    <div class="content-lock-layout">
      <aside class="content-lock-sidebar panel-card"><div class="content-lock-sidebar-head"><div><span class="eyebrow">POLICY MODULES</span><h2>بخش‌های قفل</h2></div><input id="contentLockSearch" placeholder="جستجوی قانون..."></div><div id="contentLockTabs" class="content-lock-tabs"></div></aside>
      <section class="content-lock-main"><div class="panel-card content-lock-rule-panel"><div class="content-lock-section-head" id="contentLockSectionTitle"></div><div id="contentLockRules"></div></div>
        <div class="panel-card content-lock-secondary"><div class="content-lock-secondary-head"><div><span class="eyebrow">GLOBAL POLICY</span><h2>استثناها و دامنه‌های مجاز</h2></div><div class="toolbar-actions"><button class="ghost" id="clAddException">+ افزودن استثنا</button><button class="ghost" id="clAddDomain">+ دامنه مجاز</button></div></div><div class="content-lock-subgrid"><div><h3>استثناها</h3><div id="contentLockExceptions"></div></div><div><h3>لیست سفید دامنه</h3><div id="contentLockDomains" class="domain-list"></div><div class="content-lock-inline-settings"><label><input type="checkbox" id="clAdminExempt"> ادمین‌ها از قفل‌ها مستثنا باشند</label><label><input type="checkbox" id="clNotifyUser"> بعد از حذف به کاربر اعلان شود</label><button class="primary" id="clSaveGlobal">ذخیره سیاست عمومی</button></div></div></div></div>
        <div class="panel-card content-lock-secondary"><div class="content-lock-secondary-head"><div><span class="eyebrow">AUDIT STREAM</span><h2>لاگ اجرای قوانین</h2><p>آخرین ۲۰ انسداد یا تشخیص ثبت‌شده از Bot Core.</p></div><div class="toolbar-actions"><button class="ghost" id="clExport">خروجی CSV</button></div></div><div id="contentLockLogs"></div></div>
      </section>
    </div>`);
  const groups=await warningsCompatGroups();const select=document.getElementById("contentLockGroup");
  select.innerHTML=groups.length?groups.map(g=>'<option value="'+clEsc(g.id)+'">'+clEsc(g.title||g.id)+'</option>').join(""):'<option value="">گروهی ثبت نشده است</option>';
  contentLockState.groupId=groups[0]?.id||"";
  select.value=contentLockState.groupId;
  select.onchange=async()=>{contentLockState.groupId=select.value;await clLoad();};
  document.getElementById("contentLockRefresh").onclick=()=>clLoad();
  document.getElementById("contentLockTester").onclick=clTester;
  async function clSetSection(section,enabled){
    if(!contentLockState.groupId)return;
    try{await clApi("/api/content-locks/sections/"+encodeURIComponent(section),{method:"PUT",body:JSON.stringify({group_id:contentLockState.groupId,enabled,actor_id:clActor()})});clToast(enabled?"بخش فعال شد.":"بخش خاموش شد.");await clLoad();}catch(err){clToast(err.message,true);}
  }
  document.getElementById("clNormalOn").onclick=()=>clSetSection("normal",true);
  document.getElementById("clNormalOff").onclick=()=>clSetSection("normal",false);
  document.getElementById("clAllOn").onclick=async()=>{if(confirm("همه قوانین فعال شوند؟")){try{await clApi("/api/content-locks/sections/all",{method:"PUT",body:JSON.stringify({group_id:contentLockState.groupId,enabled:true,actor_id:clActor()})});clToast("همه قفل‌ها فعال شدند.");await clLoad();}catch(err){clToast(err.message,true);}}};
  document.getElementById("clAllOff").onclick=async()=>{if(confirm("همه قوانین خاموش شوند؟")){try{await clApi("/api/content-locks/sections/all",{method:"PUT",body:JSON.stringify({group_id:contentLockState.groupId,enabled:false,actor_id:clActor()})});clToast("همه قفل‌ها خاموش شدند.");await clLoad();}catch(err){clToast(err.message,true);}}};
  document.getElementById("contentLockMaster").onchange=async e=>{try{await clApi("/api/content-locks/settings",{method:"PUT",body:JSON.stringify({group_id:contentLockState.groupId,enabled:e.target.checked,actor_id:clActor()})});clToast(e.target.checked?"سیستم قفل محتوا فعال شد.":"سیستم قفل محتوا غیرفعال شد.");await clLoad();}catch(err){e.target.checked=!e.target.checked;clToast(err.message,true);}};
  document.getElementById("contentLockSearch").oninput=e=>{contentLockState.filter=e.target.value;clRenderRules();};
  document.getElementById("clAddException").onclick=clExceptionModal;
  document.getElementById("clAddDomain").onclick=clDomainModal;
  document.getElementById("clSaveGlobal").onclick=async()=>{try{await clApi("/api/content-locks/settings",{method:"PUT",body:JSON.stringify({group_id:contentLockState.groupId,exempt_admins:document.getElementById("clAdminExempt").checked,notify_user:document.getElementById("clNotifyUser").checked,actor_id:clActor()})});clToast("سیاست عمومی ذخیره شد.");await clLoad();}catch(err){clToast(err.message,true);}};
  document.getElementById("clExport").onclick=()=>{window.location.href="/api/content-locks/export?group_id="+encodeURIComponent(contentLockState.groupId);};
  if(contentLockState.groupId)await clLoad();
}
