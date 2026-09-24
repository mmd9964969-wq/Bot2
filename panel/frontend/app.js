const titles={dashboard:"داشبورد",commands:"دستورات",responses:"پاسخ‌ها",runtime:"هسته اجرایی ربات",users:"کاربران",permissions:"دسترسی‌ها",supervision:"مرکز نظارت",settings:"تنظیمات",database:"پایگاه داده",sync:"همگام‌سازی",audit:"گزارش فعالیت‌ها",security:"مرکز امنیت",warnings:"سیستم اخطار و جریمه"};
const contentEl=document.getElementById("content"), pageTitle=document.getElementById("pageTitle"), sidebar=document.getElementById("sidebar");

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

function shell(title,kicker,body){
  contentEl.innerHTML=`<div class="page"><div class="workspace-page">
    <div class="workspace-head"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>مدیریت متمرکز و قابل کنترل از داخل PERSIAN BOT STUDIO.</p></div>
    <button class="ghost" id="pageRefresh">↻ بروزرسانی</button></div>
    ${body}</div></div>`;
  document.getElementById("pageRefresh")?.addEventListener("click",()=>page(location.hash.slice(1)||"dashboard"));
}

async function commandsPage(){
  shell("Command Manager","BOT MANAGEMENT · COMMANDS",`
    <div class="command-toolbar"><div class="searchbox">⌕ <input id="commandSearch" placeholder="جستجوی دستور، Alias یا نام فارسی..."></div>
    <div class="toolbar-actions"><select id="commandFilter"><option value="all">همه وضعیت‌ها</option><option value="on">فعال</option><option value="off">غیرفعال</option></select><button class="primary" id="addCommand">+ دستور جدید</button></div></div>
    <div class="panel-card"><div class="table-head"><div><b>Command Registry</b><small>مدیریت کامل دستورها و مجوزها</small></div><span class="badge" id="commandCount">0 COMMANDS</span></div><div id="commandTable"><div class="loading-state">در حال دریافت...</div></div></div>`);
  const table=document.getElementById("commandTable"),search=document.getElementById("commandSearch"),filter=document.getElementById("commandFilter");let all=[];
  async function load(){const r=await fetch("/api/commands",{cache:"no-store"}),d=await r.json();if(!r.ok)throw Error(d.error||"API error");all=d.commands||[];render();}
  function render(){const q=(search.value||"").toLowerCase().trim(),f=filter.value,rows=all.filter(c=>(!q||[c.command_key,c.fa_name,c.en_name].join(" ").toLowerCase().includes(q))&&(f==="all"||(f==="on"&&c.enabled)||(f==="off"&&!c.enabled)));document.getElementById("commandCount").textContent=rows.length+" COMMANDS";table.innerHTML=rows.map(c=>`<div class="command-row"><div><b>/${esc(c.command_key)}</b><small>${esc(c.fa_name||"—")}</small></div><span>${esc(c.en_name||"—")}</span><span>${esc(c.minimum_role||"MEMBER")} · ${esc(c.required_permission||"execute")}</span><span class="status ${c.enabled?"on":"off"}">${c.enabled?"ACTIVE":"DISABLED"}</span><button class="row-menu" data-id="${c.id}">ویرایش کامل</button></div>`).join("")||'<div class="empty-table">دستوری ثبت نشده است.</div>';table.querySelectorAll("[data-id]").forEach(b=>b.onclick=()=>openCommandEditor(all.find(x=>String(x.id)===b.dataset.id)));}
  search.oninput=render;filter.onchange=render;document.getElementById("addCommand").onclick=()=>openCommandEditor(null);await load();
}
function openCommandEditor(command){
  const edit=!!command,roles=["OWNER","SUPER_ADMIN","ADMIN","MODERATOR","SPECIAL_USER","MEMBER"],labels={OWNER:"مالک",SUPER_ADMIN:"سوپر ادمین",ADMIN:"مدیر",MODERATOR:"ناظر",SPECIAL_USER:"کاربر ویژه",MEMBER:"عضو"},perms=["view","create","edit","delete","manage","configure","execute","sync"],allowed=new Set((command?.permissions||[]).filter(x=>x.allowed).map(x=>x.role));
  const w=document.createElement("div");w.className="modal-backdrop";w.innerHTML=`<div class="modal"><div class="modal-head"><div><span class="eyebrow">COMMAND STUDIO</span><h2>${edit?"ویرایش کامل دستور":"دستور جدید"}</h2></div><button class="modal-close">×</button></div><form id="cmdForm" class="form-grid">
  <label>Command Key<input name="command_key" required value="${esc(command?.command_key)}" placeholder="ban"></label>
  <label>نام فارسی<input name="fa_name" value="${esc(command?.fa_name)}"></label>
  <label>English Alias<input name="en_name" value="${esc(command?.en_name)}"></label>
  <label>حداقل نقش<select name="minimum_role">${roles.map(r=>`<option value="${r}" ${(command?.minimum_role||"MEMBER")===r?"selected":""}>${labels[r]} · ${r}</option>`).join("")}</select></label>
  <label>مجوز موردنیاز<select name="required_permission">${perms.map(p=>`<option value="${p}" ${(command?.required_permission||"execute")===p?"selected":""}>${p}</option>`).join("")}</select></label>
  <label>سطح دسترسی قدیمی<select name="permission_level">${[10,40,60,80,90,100].map(n=>`<option value="${n}" ${Number(command?.permission_level||10)===n?"selected":""}>${n}</option>`).join("")}</select></label>
  <div class="full"><b>نقش‌های مجاز</b><div class="permission-grid">${roles.map(r=>`<label class="switch-line"><input type="checkbox" name="allowed_roles" value="${r}" ${allowed.has(r)?"checked":""}> ${labels[r]} · ${r}</label>`).join("")}</div></div>
  <label class="full">پاسخ فارسی<textarea name="response_fa">${esc(command?.response_fa)}</textarea></label>
  <label class="full">English Response<textarea name="response_en">${esc(command?.response_en)}</textarea></label>
  <label class="switch-line"><input type="checkbox" name="enabled" ${command?.enabled!==false?"checked":""}> دستور فعال باشد</label>
  <div class="form-actions"><button type="button" class="ghost cancel">انصراف</button>${edit?'<button type="button" class="ghost danger" id="deleteCmd">حذف دستور</button>':""}<button class="primary">ذخیره</button></div>
  </form></div>`;document.body.appendChild(w);const close=()=>w.remove();w.querySelector(".modal-close").onclick=close;w.querySelector(".cancel").onclick=close;
  if(edit)w.querySelector("#deleteCmd").onclick=async()=>{if(!confirm("حذف این دستور؟"))return;const r=await fetch("/api/commands/"+command.id,{method:"DELETE"});if(!r.ok)return alert("حذف ناموفق بود");close();commandsPage();};
  w.querySelector("#cmdForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),data=Object.fromEntries(f.entries());data.enabled=f.get("enabled")==="on";data.permission_level=Number(data.permission_level);data.allowed_roles=f.getAll("allowed_roles");const r=await fetch(edit?"/api/commands/"+command.id:"/api/commands",{method:edit?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});if(!r.ok){const d=await r.json().catch(()=>({}));return alert(d.error||"ذخیره ناموفق بود");}close();commandsPage();};
}

async function usersPage(){
  shell("مدیریت کاربران","PEOPLE · USER MANAGEMENT",`
    <div class="command-toolbar"><div class="searchbox">⌕ <input id="userSearch" placeholder="جستجوی نام، Username یا Telegram ID..."></div>
      <div class="toolbar-actions"><span class="badge" id="userCount">0 USERS</span><button class="ghost" id="userRefresh">↻ بروزرسانی</button></div></div>
    <div class="panel-card command-table-card"><div class="table-head"><div><b>User Registry</b><small>کاربران شناخته‌شده توسط سیستم</small></div><span class="badge muted">READ ONLY</span></div>
      <div id="userTable" class="command-table"><div class="loading-state">در حال دریافت کاربران...</div></div></div>`);
  const table=document.getElementById("userTable"),search=document.getElementById("userSearch"); let all=[];
  async function load(){try{const r=await fetch("/api/users?limit=500",{cache:"no-store"}),d=await r.json();if(!r.ok)throw Error();all=d.users||[];render();}catch(e){table.innerHTML='<div class="loading-state error">Users API در دسترس نیست.</div>';}}
  function render(){const q=(search.value||"").toLowerCase().trim(),rows=all.filter(u=>!q||[u.first_name,u.username,u.telegram_id,u.id,u.role].join(" ").toLowerCase().includes(q));document.getElementById("userCount").textContent=rows.length+" USERS";
    table.innerHTML=rows.length?'<div class="command-row command-header"><span>USER</span><span>TELEGRAM ID</span><span>ROLE</span><span>STATUS</span><span>LAST UPDATE</span></div>'+rows.map(u=>'<div class="command-row"><div><b>'+esc(u.first_name||"بدون نام")+'</b><small>@'+esc(u.username||"—")+'</small></div><span class="alias">'+esc(u.telegram_id||u.id)+'</span><span class="permission-pill">'+esc(String(u.role||"member").toUpperCase())+'</span><span class="status '+(u.is_active?"on":"off")+'">'+(u.is_active?"ACTIVE":"INACTIVE")+'</span><span class="alias">'+new Date(u.updated_at||u.created_at).toLocaleString("fa-IR",{hour:"2-digit",minute:"2-digit",month:"2-digit",day:"2-digit"})+'</span></div>').join(""):'<div class="empty-table"><span>♙</span><b>کاربری ثبت نشده</b><small>با اتصال Bot Runtime کاربران از Telegram وارد این بخش می‌شوند.</small></div>';}
  search.oninput=render;document.getElementById("userRefresh").onclick=load;await load();
}

async function responsesPage(){
  shell("Response Studio","BOT MANAGEMENT · RESPONSES",`
    <div class="permission-hero"><div><span class="eyebrow">RESPONSE ENGINE</span><h2>استودیو پاسخ‌های ربات</h2><p>مدیریت پیام‌های فارسی و انگلیسی برای دستورات، رویدادها، خطاها و پیام‌های مدیریتی.</p></div><span class="security-badge">FA · EN</span></div>
    <div class="command-toolbar"><div class="searchbox">⌕ <input id="responseSearch" placeholder="جستجوی پاسخ، رویداد یا کلید..."></div>
      <div class="toolbar-actions"><select id="responseFilter"><option value="all">همه وضعیت‌ها</option><option value="on">فعال</option><option value="off">غیرفعال</option></select><button class="primary" id="addResponse">+ پاسخ جدید</button></div></div>
    <div class="panel-card command-table-card"><div class="table-head"><div><b>Response Registry</b><small>قالب‌های پاسخ قابل مدیریت</small></div><span class="badge" id="responseCount">0 RESPONSES</span></div>
      <div id="responseTable" class="command-table"><div class="loading-state">در حال دریافت پاسخ‌ها...</div></div></div>`);
  const table=document.getElementById("responseTable"),search=document.getElementById("responseSearch"),filter=document.getElementById("responseFilter");let all=[];
  async function load(){try{const r=await fetch("/api/responses",{cache:"no-store"}),d=await r.json();if(!r.ok)throw Error();all=d.responses||[];render();}catch(e){table.innerHTML='<div class="loading-state error">Response API در دسترس نیست.</div>';}}
  function render(){const q=(search.value||"").toLowerCase().trim(),f=filter.value,rows=all.filter(x=>(!q||[x.response_key,x.event_type,x.title,x.message_fa,x.message_en].join(" ").toLowerCase().includes(q))&&(f==="all"||(f==="on"&&x.enabled)||(f==="off"&&!x.enabled)));document.getElementById("responseCount").textContent=rows.length+" RESPONSES";
    table.innerHTML=rows.length?'<div class="command-row command-header"><span>RESPONSE</span><span>EVENT</span><span>CHANNEL</span><span>STATUS</span><span></span></div>'+rows.map(x=>'<div class="command-row"><div><b>'+esc(x.title||x.response_key)+'</b><small>'+esc(x.response_key)+'</small></div><span class="alias">'+esc(x.event_type)+'</span><span class="permission-pill">'+esc(String(x.channel||"group").toUpperCase())+'</span><span class="status '+(x.enabled?"on":"off")+'">'+(x.enabled?"ACTIVE":"DISABLED")+'</span><button class="row-menu" data-edit-response="'+x.id+'">•••</button></div>').join(""):'<div class="empty-table"><span>◈</span><b>هنوز پاسخی ثبت نشده</b><small>از «پاسخ جدید» اولین Response Template را بسازید.</small></div>';
    table.querySelectorAll("[data-edit-response]").forEach(b=>b.onclick=()=>openResponseEditor(all.find(x=>String(x.id)===b.dataset.editResponse)));
  }
  search.oninput=render;filter.onchange=render;document.getElementById("addResponse").onclick=()=>openResponseEditor(null);await load();
}

function openResponseEditor(response){
  const edit=!!response,wrap=document.createElement("div");wrap.className="modal-backdrop";
  wrap.innerHTML=`<div class="modal"><div class="modal-head"><div><span class="eyebrow">RESPONSE STUDIO</span><h2>${edit?"ویرایش پاسخ":"ساخت پاسخ جدید"}</h2></div><button class="modal-close">×</button></div>
  <form id="responseForm" class="form-grid">
    <label>Response Key<input name="response_key" required placeholder="welcome_message" value="${esc(response?.response_key)}"></label>
    <label>عنوان<input name="title" placeholder="پیام خوش‌آمدگویی" value="${esc(response?.title)}"></label>
    <label>Event Type<input name="event_type" placeholder="user_started" value="${esc(response?.event_type||"custom")}"></label>
    <label>Channel<select name="channel"><option value="private" ${response?.channel==="private"?"selected":""}>PRIVATE</option><option value="group" ${!response||response?.channel==="group"?"selected":""}>GROUP</option><option value="admin" ${response?.channel==="admin"?"selected":""}>ADMIN</option><option value="system" ${response?.channel==="system"?"selected":""}>SYSTEM</option></select></label>
    <label class="full">پیام فارسی<textarea name="message_fa" placeholder="متن پاسخ فارسی...">${esc(response?.message_fa)}</textarea></label>
    <label class="full">English Message<textarea name="message_en" placeholder="English response...">${esc(response?.message_en)}</textarea></label>
    <label class="switch-line"><input type="checkbox" name="enabled" ${response?.enabled!==false?"checked":""}> پاسخ فعال باشد</label>
    <div class="form-actions"><button type="button" class="ghost modal-cancel">انصراف</button><button class="primary" type="submit">${edit?"ذخیره تغییرات":"ایجاد پاسخ"}</button></div>
  </form></div>`;
  document.body.appendChild(wrap);const close=()=>wrap.remove();wrap.querySelector(".modal-close").onclick=close;wrap.querySelector(".modal-cancel").onclick=close;
  wrap.querySelector("#responseForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),data=Object.fromEntries(f.entries());data.enabled=f.get("enabled")==="on";
    const r=await fetch(edit?"/api/responses/"+response.id:"/api/responses",{method:edit?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    if(!r.ok){alert("ذخیره پاسخ انجام نشد.");return;}close();responsesPage();
  };
}

function permissionsPage(){
  shell("Permission Center","BOT MANAGEMENT · PERMISSIONS",`
    <div class="permission-hero"><div><span class="eyebrow">OWNER CONTROL</span><h2>مدیریت دسترسی در سطح قابلیت</h2><p>برای هر نقش، دسترسی هر عملیات را مستقل فعال یا غیرفعال کنید.</p></div><span class="security-badge">OWNER · 100</span></div>
    <div class="panel-card permission-card"><div class="permission-grid" id="permissionGrid"><div class="loading-state">در حال دریافت Permission Engine...</div></div></div>`);
  const grid=document.getElementById("permissionGrid");
  const roles=["OWNER","SUPER_ADMIN","ADMIN","MODERATOR","SPECIAL_USER","MEMBER"];
  const roleNames={"OWNER":"مالک","SUPER_ADMIN":"سوپر ادمین","ADMIN":"مدیر","MODERATOR":"ناظر","SPECIAL_USER":"کاربر ویژه","MEMBER":"عضو"};
  const keys=["view","create","edit","delete","manage","configure","execute","sync"];
  const keyNames={"view":"VIEW","create":"CREATE","edit":"EDIT","delete":"DELETE","manage":"MANAGE","configure":"CONFIGURE","execute":"EXECUTE","sync":"SYNC"};
  async function load(){
    try{
      const r=await fetch("/api/permissions",{cache:"no-store"}),d=await r.json(); if(!r.ok)throw Error(d.error);
      const map={}; (d.permissions||[]).forEach(x=>(map[x.role]??={})[x.permission_key]=x.allowed);
      grid.innerHTML=`<div class="permission-grid-head"><span>ROLE</span>${keys.map(k=>`<span>${keyNames[k]}</span>`).join("")}</div>`+
        roles.map(role=>`<div class="permission-grid-row"><div><b>${role}</b><small>${roleNames[role]}</small></div>${keys.map(k=>`<button class="perm-check ${map[role]?.[k]?"allowed":"disabled"}" data-role="${role}" data-key="${k}" ${role==="OWNER"?"disabled":""}>${map[role]?.[k]?"✓":"—"}</button>`).join("")}</div>`).join("");
      grid.querySelectorAll("[data-role]").forEach(btn=>btn.onclick=async()=>{
        const allowed=btn.classList.contains("disabled");
        const r=await fetch("/api/permissions",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:btn.dataset.role,permission_key:btn.dataset.key,allowed})});
        if(r.ok){btn.classList.toggle("disabled",!allowed);btn.classList.toggle("allowed",allowed);btn.textContent=allowed?"✓":"—";} else alert("تغییر دسترسی انجام نشد.");
      });
    }catch(e){grid.innerHTML='<div class="loading-state error">Permission API در دسترس نیست.</div>';}
  }
  load();
}


async function supervisionPage(){
  shell("مرکز نظارت","SUPERVISION CENTER · LIVE MONITOR",`
    <div class="permission-hero"><div><span class="eyebrow">SUPERVISION CENTER</span><h2>مرکز نظارت و کنترل زنده</h2><p>یک نمای متمرکز برای پایش کاربران، دستورات، گروه‌ها، مدیران، امنیت، خطاها و سلامت سیستم.</p></div><span class="security-badge">● LIVE</span></div>
    <div class="quick-grid supervision-modules" id="supervisionModules">
      <button class="quick active" data-supervision-tab="monitor"><span>◉</span><div><b>Live Monitor</b><small>نمای زنده سیستم و رویدادها</small></div><i>01</i></button>
      <button class="quick" data-supervision-tab="users"><span>♙</span><div><b>Users</b><small>فعالیت و وضعیت کاربران</small></div><i>02</i></button>
      <button class="quick" data-supervision-tab="commands"><span>⌘</span><div><b>Commands</b><small>اجرای دستورات و خطاها</small></div><i>03</i></button>
      <button class="quick" data-supervision-tab="groups"><span>▣</span><div><b>Groups</b><small>گروه‌ها و وضعیت ربات</small></div><i>04</i></button>
      <button class="quick" data-supervision-tab="admins"><span>♜</span><div><b>Administrators</b><small>فعالیت مدیران و اقدامات</small></div><i>05</i></button>
      <button class="quick" data-supervision-tab="security"><span>◇</span><div><b>Security</b><small>هشدارها و رویدادهای حساس</small></div><i>06</i></button>
      <button class="quick" data-supervision-tab="events"><span>◌</span><div><b>Events</b><small>تمام رویدادهای ثبت‌شده</small></div><i>07</i></button>
      <button class="quick" data-supervision-tab="errors"><span>!</span><div><b>Errors</b><small>خطاهای API و دیتابیس</small></div><i>08</i></button>
      <button class="quick" data-supervision-tab="health"><span>♥</span><div><b>System Health</b><small>سلامت سرویس و دیتابیس</small></div><i>09</i></button>
      <button class="quick" data-supervision-tab="statistics"><span>▥</span><div><b>Statistics</b><small>آمار و روند فعالیت</small></div><i>10</i></button>
    </div>
    <div id="supervisionWorkspace"></div>`);
  const workspace=document.getElementById("supervisionWorkspace");
  const modules=document.getElementById("supervisionModules");
  const labels={monitor:"LIVE MONITOR",users:"USERS",commands:"COMMANDS",groups:"GROUPS",admins:"ADMINISTRATORS",security:"SECURITY",events:"EVENTS",errors:"ERRORS",health:"SYSTEM HEALTH",statistics:"STATISTICS"};
  function eventLabel(e){const map={user_started:"کاربر ربات را Start کرد",user_blocked_bot:"کاربر ربات را Block کرد",user_unblocked_bot:"کاربر ربات را Unblock کرد",command_executed:"اجرای دستور",command_failed:"خطای دستور",group_joined:"ورود ربات به گروه",group_left:"خروج ربات از گروه",admin_action:"فعالیت مدیر",permission_denied:"رد دسترسی",permission_changed:"تغییر دسترسی",settings_changed:"تغییر تنظیمات",bot_added_to_group:"افزوده‌شدن ربات به گروه",bot_removed_from_group:"حذف ربات از گروه",security_alert:"هشدار امنیتی",api_error:"خطای API",database_error:"خطای دیتابیس",system_health:"بررسی سلامت سیستم"};return map[e]||e;}
  async function getData(severity=""){const q=severity?("?severity="+encodeURIComponent(severity)):"";const [sr,er]=await Promise.all([fetch("/api/supervision/summary",{cache:"no-store"}),fetch("/api/supervision/events"+q,{cache:"no-store"})]);const s=await sr.json(),e=await er.json();if(!sr.ok||!er.ok)throw Error("API");return {s,e};}
  function statCard(icon,kicker,value,label,cls="blue"){return `<div class="stat-card"><div class="stat-top"><span class="stat-icon ${cls}">${icon}</span><span class="stat-kicker">${kicker}</span></div><strong>${value}</strong><span>${label}</span></div>`;}
  function eventTable(rows,empty="هنوز رویدادی ثبت نشده"){return rows.length?'<div class="command-row command-header"><span>EVENT</span><span>SEVERITY</span><span>ACTOR</span><span>TARGET</span><span>TIME</span></div>'+rows.map(x=>'<div class="command-row"><div><b>'+esc(eventLabel(x.event_type))+'</b><small>'+esc(x.command_key||x.event_type)+'</small></div><span class="status '+((x.severity==="info"||x.severity==="success")?"on":"off")+'">'+esc(x.severity.toUpperCase())+'</span><span class="alias">'+esc(x.actor_id||"SYSTEM")+'</span><span class="alias">'+esc(x.target_id||x.group_id||"—")+'</span><span class="alias">'+new Date(x.created_at).toLocaleString("fa-IR",{hour:"2-digit",minute:"2-digit",month:"2-digit",day:"2-digit"})+'</span></div>').join(""):'<div class="empty-table"><span>◉</span><b>'+empty+'</b><small>با اتصال Bot Runtime داده‌های واقعی این بخش نمایش داده می‌شوند.</small></div>';}
  async function render(tab="monitor"){
    modules.querySelectorAll("[data-supervision-tab]").forEach(x=>x.classList.toggle("active",x.dataset.supervisionTab===tab));
    workspace.innerHTML='<div class="panel-card"><div class="loading-state">در حال دریافت اطلاعات مرکز نظارت...</div></div>';
    try{
      const {s,e}=await getData();
      const rows=e.events||[];
      if(tab==="monitor"){
        workspace.innerHTML=`<div class="stats supervision-stats">
          ${statCard("◉","EVENTS · 24H",s.events24h,"رویدادهای ثبت‌شده","blue")}
          ${statCard("♙","USERS",s.users,"کاربران ثبت‌شده","green")}
          ${statCard("⌘","COMMANDS",s.activeCommands,"دستورات فعال","purple")}
          ${statCard("◇","SECURITY",s.securityAlerts24h,"هشدارهای ۲۴ ساعت اخیر","gold")}
          ${statCard("!","ERRORS",s.errors24h,"خطاهای ۲۴ ساعت اخیر","blue")}
        </div><div class="panel-card command-table-card"><div class="table-head"><div><b>Live Event Stream</b><small>آخرین رویدادهای سیستم</small></div><div class="toolbar-actions"><button class="ghost" id="supervisionRefresh">↻ بروزرسانی</button></div></div><div id="supervisionEvents" class="command-table">${eventTable(rows)}</div></div>`;
        document.getElementById("supervisionRefresh").onclick=()=>render("monitor");
      } else if(tab==="users"){
        const userEvents=rows.filter(x=>String(x.event_type).startsWith("user_")||x.event_type==="permission_denied");
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("♙","REGISTERED",s.users,"کاربران ثبت‌شده","green")}${statCard("◌","START EVENTS",userEvents.filter(x=>x.event_type==="user_started").length,"رویدادهای Start","blue")}${statCard("◇","BLOCK EVENTS",userEvents.filter(x=>x.event_type==="user_blocked_bot").length,"رویدادهای Block","gold")}</div><div class="panel-card command-table-card"><div class="table-head"><div><b>User Activity</b><small>فعالیت‌های مرتبط با کاربران</small></div></div><div class="command-table">${eventTable(userEvents,"هنوز فعالیت کاربری ثبت نشده")}</div></div>`;
      } else if(tab==="commands"){
        const commandEvents=rows.filter(x=>x.event_type==="command_executed"||x.event_type==="command_failed");
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("⌘","ACTIVE",s.activeCommands,"دستورات فعال","purple")}${statCard("✓","EXECUTED",commandEvents.filter(x=>x.event_type==="command_executed").length,"اجرای ثبت‌شده","green")}${statCard("!","FAILED",commandEvents.filter(x=>x.event_type==="command_failed").length,"اجرای ناموفق","blue")}</div><div class="panel-card command-table-card"><div class="table-head"><div><b>Command Activity</b><small>اجرای دستورات و خطاها</small></div></div><div class="command-table">${eventTable(commandEvents,"هنوز اجرای دستوری ثبت نشده")}</div></div>`;
      } else if(tab==="groups"){
        const groupEvents=rows.filter(x=>["group_joined","group_left","bot_added_to_group","bot_removed_from_group"].includes(x.event_type));
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("▣","GROUP EVENTS",groupEvents.length,"رویدادهای گروهی ثبت‌شده","blue")}${statCard("＋","JOINED",groupEvents.filter(x=>x.event_type==="group_joined"||x.event_type==="bot_added_to_group").length,"ورود یا افزودن ربات","green")}${statCard("−","LEFT",groupEvents.filter(x=>x.event_type==="group_left"||x.event_type==="bot_removed_from_group").length,"خروج یا حذف ربات","gold")}</div><div class="panel-card command-table-card"><div class="table-head"><div><b>Group Activity</b><small>ورود، خروج و تغییر وضعیت گروه‌ها</small></div></div><div class="command-table">${eventTable(groupEvents,"هنوز رویداد گروهی ثبت نشده")}</div></div>`;
      } else if(tab==="admins"){
        const adminEvents=rows.filter(x=>x.event_type==="admin_action"||x.event_type==="permission_changed"||x.event_type==="settings_changed");
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("♜","ADMIN ACTIONS",adminEvents.filter(x=>x.event_type==="admin_action").length,"اقدامات مدیران","purple")}${statCard("♜","PERMISSIONS",adminEvents.filter(x=>x.event_type==="permission_changed").length,"تغییرات دسترسی","gold")}${statCard("⚙","SETTINGS",adminEvents.filter(x=>x.event_type==="settings_changed").length,"تغییرات تنظیمات","blue")}</div><div class="panel-card command-table-card"><div class="table-head"><div><b>Administrator Activity</b><small>اقدامات مدیریتی و تغییرات حساس</small></div></div><div class="command-table">${eventTable(adminEvents,"هنوز فعالیت مدیریتی ثبت نشده")}</div></div>`;
      } else if(tab==="security"){
        const sec=rows.filter(x=>["security_alert","permission_denied","user_blocked_bot","api_error","database_error"].includes(x.event_type)||["warning","error","critical"].includes(x.severity));
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("◇","ALERTS",s.securityAlerts24h,"هشدارهای امنیتی ۲۴ ساعت اخیر","gold")}${statCard("!","DENIED",sec.filter(x=>x.event_type==="permission_denied").length,"دسترسی‌های ردشده","blue")}${statCard("×","CRITICAL",sec.filter(x=>x.severity==="critical").length,"رویدادهای Critical","purple")}</div><div class="panel-card command-table-card"><div class="table-head"><div><b>Security Events</b><small>رویدادهای حساس و هشدارها</small></div></div><div class="command-table">${eventTable(sec,"هشدار امنیتی ثبت نشده")}</div></div>`;
      } else if(tab==="events"){
        workspace.innerHTML=`<div class="panel-card command-table-card"><div class="table-head"><div><b>All Events</b><small>تمام رویدادهای دریافت‌شده از هسته نظارت</small></div><div class="badge">${rows.length} EVENTS</div></div><div class="command-table">${eventTable(rows)}</div></div>`;
      } else if(tab==="errors"){
        const errors=rows.filter(x=>["error","critical"].includes(x.severity)||["command_failed","api_error","database_error"].includes(x.event_type));
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("!","ERRORS · 24H",s.errors24h,"خطاهای ثبت‌شده","blue")}${statCard("×","CRITICAL",errors.filter(x=>x.severity==="critical").length,"خطاهای بحرانی","purple")}</div><div class="panel-card command-table-card"><div class="table-head"><div><b>Error Center</b><small>خطاهای API، دیتابیس و اجرای دستورات</small></div></div><div class="command-table">${eventTable(errors,"هنوز خطایی ثبت نشده")}</div></div>`;
      } else if(tab==="health"){
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("♥","DATABASE","Connected","وضعیت لایه PostgreSQL","green")}${statCard("◉","API","Online","وضعیت API پنل","blue")}${statCard("✦","SUPERVISION","Active","هسته نظارت","purple")}</div><div class="panel-card"><div class="table-head"><div><b>System Health</b><small>وضعیت فعلی اجزای قابل پایش</small></div><span class="security-badge">● OPERATIONAL</span></div><div class="security-list"><div><span class="check">✓</span><div><b>Supervision API</b><small>Summary + Events endpoints</small></div><em>ACTIVE</em></div><div><span class="check">✓</span><div><b>PostgreSQL</b><small>Persistent supervision storage</small></div><em>CONNECTED</em></div><div><span class="check">✓</span><div><b>Event Stream</b><small>Ready for Bot Runtime events</small></div><em>READY</em></div></div></div>`;
      } else {
        workspace.innerHTML=`<div class="stats supervision-stats">${statCard("◉","TOTAL · 24H",s.events24h,"کل رویدادها","blue")}${statCard("♙","USERS",s.users,"کاربران","green")}${statCard("⌘","COMMANDS",s.activeCommands,"دستورات فعال","purple")}${statCard("◇","SECURITY",s.securityAlerts24h,"هشدارهای امنیتی","gold")}${statCard("!","ERRORS",s.errors24h,"خطاها","blue")}</div><div class="panel-card"><div class="table-head"><div><b>Statistics Overview</b><small>نمای فعلی آمار مرکز نظارت</small></div></div><div class="env-row"><span>Event volume</span><b>${s.events24h} / 24h</b></div><div class="env-row"><span>Registered users</span><b>${s.users}</b></div><div class="env-row"><span>Active commands</span><b>${s.activeCommands}</b></div><div class="env-row"><span>Security alerts</span><b>${s.securityAlerts24h}</b></div><div class="env-row"><span>Errors</span><b>${s.errors24h}</b></div></div>`;
      }
    }catch(err){workspace.innerHTML='<div class="panel-card"><div class="loading-state error">Supervision API در دسترس نیست.</div></div>';}
  }
  modules.querySelectorAll("[data-supervision-tab]").forEach(btn=>btn.onclick=()=>render(btn.dataset.supervisionTab));
  await render("monitor");
  setInterval(()=>{if(location.hash==="#supervision")render(document.querySelector("[data-supervision-tab].active")?.dataset.supervisionTab||"monitor");},10000);
}

async function runtimePage(){
  shell("هسته اجرایی ربات","فاز ۲ · BOT RUNTIME",`
    <div class="runtime-hero runtime-pro"><div class="runtime-hero-copy">
      <div class="runtime-title-line"><span class="runtime-mark">⌘</span><div><span class="eyebrow">BOT RUNTIME · CONTROL CENTER</span><h2>هسته اجرایی ربات</h2></div></div>
      <p>کنترل و پایش یکپارچه پردازش، صف، Workerها، اتصال Telegram و سلامت سرویس‌ها.</p>
      <div class="runtime-meta"><span>● مانیتورینگ فعال</span><span>۵ مؤلفه اصلی</span><span>کنترل حساس با تأیید</span></div>
    </div><div class="runtime-state-wrap"><span class="runtime-state" id="runtimeState">● در حال بررسی</span><small>وضعیت فعلی هسته</small></div></div>

    <div class="runtime-section-head"><div><span class="eyebrow">OVERVIEW</span><h3>نمای کلی Runtime</h3></div><button class="ghost runtime-refresh" id="runtimeRefresh">↻ بروزرسانی وضعیت</button></div>
    <div class="stats runtime-stats" id="runtimeStats"></div>

    <div class="runtime-layout">
      <section class="panel-card runtime-control-card">
        <div class="runtime-card-head"><div><span class="eyebrow">OPERATIONS</span><h3>کنترل‌های اجرایی</h3><p>عملیات را از اینجا بررسی یا برای ثبت در هسته درخواست کنید.</p></div><span class="module-badge">RUNTIME</span></div>
        <div class="runtime-action-grid">
          <button class="runtime-action safe" data-runtime-action="health_check"><span class="action-icon">✓</span><span><b>بررسی سلامت</b><small>Health Check</small></span><i>›</i></button>
          <button class="runtime-action safe" data-runtime-action="reload_config"><span class="action-icon">↻</span><span><b>بارگذاری تنظیمات</b><small>Reload Configuration</small></span><i>›</i></button>
          <button class="runtime-action" data-runtime-action="restart_requested"><span class="action-icon">↺</span><span><b>درخواست راه‌اندازی مجدد</b><small>Restart Request</small></span><i>›</i></button>
          <button class="runtime-action warning" data-runtime-action="maintenance_on"><span class="action-icon">Ⅱ</span><span><b>فعال‌سازی حالت تعمیر</b><small>Maintenance Mode</small></span><i>›</i></button>
          <button class="runtime-action safe" data-runtime-action="maintenance_off"><span class="action-icon">▶</span><span><b>خروج از حالت تعمیر</b><small>Resume Runtime</small></span><i>›</i></button>
        </div>
        <div class="runtime-note"><span>i</span><div><b>اتصال مستقیم Bot Core</b><small>کنترل واقعی Runtime هنوز به این پنل متصل نیست؛ عملیات حساس فعلاً فقط با تأیید ثبت و در Supervision ذخیره می‌شوند.</small></div></div>
      </section>

      <section class="panel-card runtime-health-card">
        <div class="runtime-card-head"><div><span class="eyebrow">HEALTH MONITOR</span><h3>سلامت مؤلفه‌ها</h3><p>وضعیت سرویس‌های وابسته به Runtime.</p></div><span class="live-pill">● LIVE</span></div>
        <div class="runtime-health" id="runtimeHealth"></div>
      </section>
    </div>

    <section class="panel-card runtime-settings-card">
      <div class="runtime-card-head settings-head"><div><span class="eyebrow">EXECUTION POLICY</span><h3>سیاست اجرای Runtime</h3><p>پارامترهای پردازش را در سه گروه مشخص و قابل کنترل تنظیم کنید.</p></div><span class="module-badge">CONFIG</span></div>
      <form id="runtimeForm" class="runtime-form">
        <div class="runtime-setting-group"><div class="setting-group-title"><span>01</span><div><b>پردازش و صف</b><small>ظرفیت و همزمانی اجرای وظایف</small></div></div>
          <div class="runtime-fields"><label>تعداد Worker<input type="number" name="worker_count" min="1" max="32"></label><label>ظرفیت صف<input type="number" name="queue_size" min="10" max="10000"></label><label>پردازش همزمان<input type="number" name="concurrency" min="1" max="500"></label></div>
        </div>
        <div class="runtime-setting-group"><div class="setting-group-title"><span>02</span><div><b>Timeout و Retry</b><small>رفتار Runtime هنگام خطا یا تأخیر</small></div></div>
          <div class="runtime-fields"><label>Timeout درخواست <em>ms</em><input type="number" name="request_timeout_ms" min="1000" max="120000"></label><label>تعداد Retry<input type="number" name="max_retries" min="0" max="10"></label><label>Backoff <em>ms</em><input type="number" name="backoff_ms" min="100" max="60000"></label></div>
        </div>
        <div class="runtime-setting-group"><div class="setting-group-title"><span>03</span><div><b>پایداری و لاگ</b><small>ثبت خطا و جلوگیری از پردازش تکراری</small></div></div>
          <div class="runtime-fields"><label>مدت Deduplication <em>ثانیه</em><input type="number" name="deduplication_ttl_seconds" min="30" max="86400"></label><label>سطح لاگ<select name="log_level"><option value="error">خطا</option><option value="warn">هشدار</option><option value="info">اطلاعات</option><option value="debug">اشکال‌زدایی</option></select></label></div>
          <div class="runtime-toggles"><label class="runtime-toggle"><input type="checkbox" name="auto_restart"><span><b>راه‌اندازی مجدد خودکار</b><small>پس از خطای بحرانی</small></span></label><label class="runtime-toggle"><input type="checkbox" name="graceful_shutdown"><span><b>توقف کنترل‌شده</b><small>تکمیل پردازش‌های فعال</small></span></label><label class="runtime-toggle"><input type="checkbox" name="deduplication"><span><b>جلوگیری از پردازش تکراری</b><small>Deduplication Engine</small></span></label></div>
        </div>
        <div class="runtime-form-footer"><span>تغییرات پس از ذخیره در تنظیمات Runtime ثبت می‌شوند.</span><button class="primary runtime-save" type="submit">ذخیره تنظیمات <b>→</b></button></div>
      </form>
    </section>`);
  const stats=document.getElementById("runtimeStats"),healthBox=document.getElementById("runtimeHealth"),state=document.getElementById("runtimeState"),form=document.getElementById("runtimeForm");
  async function load(){try{const r=await fetch("/api/runtime/overview",{cache:"no-store"}),d=await r.json();if(!r.ok)throw Error();state.textContent=d.runtime.status==="ready"?"● آماده":"● "+d.runtime.status;state.className="runtime-state "+(d.runtime.status==="ready"?"ok":"warn");stats.innerHTML=[["✦","RUNTIME","آماده","هسته پنل"],["◉","TELEGRAM","متصل نشده","اتصال Runtime"],["◌","EVENTS 24H",d.metrics.events24h,"رویدادهای ثبت‌شده"],["!","ERRORS 24H",d.metrics.errors24h,"خطاهای ثبت‌شده"]].map((x,i)=>`<div class="stat-card runtime-stat"><div class="stat-top"><span class="stat-icon ${["green","blue","purple","gold"][i]}">${x[0]}</span><span class="stat-kicker">${x[1]}</span></div><strong>${esc(x[2])}</strong><span>${esc(x[3])}</span></div>`).join("");const db=d.database?.connected;healthBox.innerHTML=[["هسته Runtime","آماده","on","CORE"],["پایگاه داده",db?"متصل":"قطع",db?"on":"off","DATABASE"],["Telegram Runtime","در انتظار اتصال","off","TELEGRAM"],["مرکز نظارت","فعال","on","SUPERVISION"],["ثبت رویداد","آماده","on","EVENT LOG"]].map(x=>`<div class="runtime-health-row"><span class="check ${x[2]}">${x[2]==="on"?"✓":"!"}</span><div><b>${x[0]}</b><small>${x[1]}</small></div><em class="${x[2]}">${x[3]} · ${x[2]==="on"?"فعال":"در انتظار"}</em></div>`).join("");const s=d.settings||{};for(const [k,v] of Object.entries(s)){const el=form.elements[k];if(!el)continue;if(el.type==="checkbox")el.checked=!!v;else el.value=v??"";}}catch(e){state.textContent="● خطا در دریافت وضعیت";state.className="runtime-state warn";}}
  document.getElementById("runtimeRefresh").onclick=load;
  document.querySelectorAll("[data-runtime-action]").forEach(btn=>btn.onclick=async()=>{if(!confirm("این عملیات در مرکز Runtime ثبت شود؟"))return;btn.disabled=true;try{const r=await fetch("/api/runtime/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:btn.dataset.runtimeAction})});const d=await r.json();alert(r.ok?"عملیات ثبت شد.":(d.error||"عملیات انجام نشد."));await load();}finally{btn.disabled=false;}});
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),data=Object.fromEntries(f.entries());for(const n of ["auto_restart","graceful_shutdown","deduplication"])data[n]=f.get(n)==="on";for(const n of ["worker_count","queue_size","concurrency","request_timeout_ms","max_retries","backoff_ms","deduplication_ttl_seconds"])data[n]=Number(data[n]);const r=await fetch("/api/runtime/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();alert(r.ok?"تنظیمات Runtime ذخیره شد.":(d.error||"ذخیره انجام نشد."));if(r.ok)load();};await load();
}

function placeholder(name){
  shell(titles[name]||"Panel","PERSIAN BOT STUDIO · "+String(name).toUpperCase(),'<div class="panel-card coming-card"><span class="eyebrow">CONTROL MODULE</span><h2>این بخش در حال اتصال به هسته مرکزی است</h2><p>ساختار پنل آماده است و در مراحل بعدی به API و PostgreSQL متصل می‌شود.</p></div>');
}

function page(name){
  if(!titles[name]) name="dashboard";
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===name));
  pageTitle.textContent=titles[name]||"Dashboard";
  location.hash=name; sidebar.classList.remove("open");
  if(name==="dashboard"){location.reload();return;}
  if(name==="commands")return commandsPage();
  if(name==="responses")return responsesPage();
  if(name==="users")return usersPage();
  if(name==="permissions")return permissionsPage();
  if(name==="supervision")return supervisionPage();
  if(name==="runtime")return runtimePage();
  if(name==="warnings")return warningsPage();
  if(name==="security")return;
  placeholder(name);
}

document.querySelectorAll("[data-page]").forEach(el=>el.addEventListener("click",()=>page(el.dataset.page)));
document.getElementById("mobileMenu")?.addEventListener("click",()=>sidebar.classList.toggle("open"));
document.getElementById("langBtn")?.addEventListener("click",()=>{
  const html=document.documentElement, fa=html.getAttribute("dir")==="rtl";
  html.setAttribute("dir",fa?"ltr":"rtl"); html.setAttribute("lang",fa?"en":"fa");
  document.getElementById("langBtn").textContent=fa?"EN":"FA";
});
async function health(){
  try{
    const r=await fetch("/api/health",{cache:"no-store"}),d=await r.json(),ok=d.status==="online",db=!!d.database?.connected;
    const bot=document.getElementById("botStatus"), database=document.getElementById("dbStatus"), detail=document.getElementById("dbDetail");
    if(bot){bot.textContent=ok?"Online":"Offline";bot.nextElementSibling.textContent=ok?"Operational":"Unavailable"}
    if(database){database.textContent=db?"Connected":"Offline";database.nextElementSibling.textContent=db?"PostgreSQL":"DATABASE_URL"}
    ["heroDb","flowDb"].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=db?"Connected":"Check"});
    const stamp=document.getElementById("lastRefresh");if(stamp)stamp.textContent="● Live · "+new Date().toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"});
  }catch(e){const b=document.getElementById("botStatus");if(b){b.textContent="Offline";b.nextElementSibling.textContent="API unavailable"}}
}
if(location.hash&&location.hash!=="#dashboard")page(location.hash.slice(1));else health();
setInterval(health,15000);
