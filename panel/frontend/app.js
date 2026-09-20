const titles={dashboard:"Dashboard",commands:"Commands",responses:"Responses",users:"Users",permissions:"Permissions",supervision:"Supervision Center",settings:"Settings",database:"Database",sync:"Sync",audit:"Audit Log",security:"Security Center"};
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
    <div class="command-layout"><div class="panel-card command-table-card"><div class="table-head"><div><b>Command Registry</b><small>مدیریت دستورات و سطح دسترسی</small></div><span class="badge" id="commandCount">0 COMMANDS</span></div>
    <div id="commandTable" class="command-table"><div class="loading-state">در حال دریافت دستورات...</div></div></div>
    <div class="panel-card command-insight"><span class="eyebrow">ACCESS MODEL</span><h3>کنترل صفر تا صد</h3>
      <div class="access-level"><span>100</span><div><b>OWNER</b><small>دسترسی کامل</small></div></div>
      <div class="access-level"><span>80</span><div><b>ADMIN</b><small>مدیریت عملیاتی</small></div></div>
      <div class="access-level"><span>60</span><div><b>MODERATOR</b><small>مدیریت روزمره</small></div></div>
      <div class="access-level"><span>10</span><div><b>MEMBER</b><small>دسترسی کاربری</small></div></div>
      <div class="insight-note">هر دستور می‌تواند سطح دسترسی مستقل داشته باشد.</div>
    </div></div>`);
  const table=document.getElementById("commandTable"), search=document.getElementById("commandSearch"), filter=document.getElementById("commandFilter");
  let all=[];
  async function load(){
    try{const r=await fetch("/api/commands",{cache:"no-store"}); const d=await r.json(); if(!r.ok)throw Error(d.error); all=d.commands||[]; render();}
    catch(e){table.innerHTML='<div class="loading-state error">اتصال به Command API برقرار نشد.</div>';}
  }
  function render(){
    const q=(search.value||"").toLowerCase().trim(), f=filter.value;
    const rows=all.filter(c=>(!q||[c.command_key,c.fa_name,c.en_name].join(" ").toLowerCase().includes(q))&&(f==="all"||(f==="on"&&c.enabled)||(f==="off"&&!c.enabled)));
    document.getElementById("commandCount").textContent=`${rows.length} COMMANDS`;
    if(!rows.length){table.innerHTML='<div class="empty-table"><span>⌘</span><b>هنوز دستوری ثبت نشده</b><small>از «دستور جدید» اولین Command را بسازید.</small></div>';return;}
    table.innerHTML=`<div class="command-row command-header"><span>COMMAND</span><span>ALIAS</span><span>ACCESS</span><span>STATUS</span><span></span></div>`+rows.map(c=>`<div class="command-row"><div><b>\/${esc(c.command_key)}</b><small>${esc(c.fa_name||"بدون نام فارسی")}</small></div><span class="alias">${esc(c.en_name||"—")}</span><span class="permission-pill">${c.permission_level===100?"OWNER":c.permission_level===80?"ADMIN":c.permission_level===60?"MOD":"MEMBER"}</span><span class="status ${c.enabled?"on":"off"}">${c.enabled?"ACTIVE":"DISABLED"}</span><button class="row-menu" data-edit="${c.id}">•••</button></div>`).join("");
    table.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openEditor(all.find(c=>String(c.id)===b.dataset.edit)));
  }
  search.oninput=render; filter.onchange=render; document.getElementById("addCommand").onclick=()=>openEditor(null); await load();
}

function openEditor(command){
  const edit=!!command;
  const wrap=document.createElement("div"); wrap.className="modal-backdrop";
  wrap.innerHTML=`<div class="modal"><div class="modal-head"><div><span class="eyebrow">COMMAND STUDIO</span><h2>${edit?"ویرایش دستور":"ساخت دستور جدید"}</h2></div><button class="modal-close">×</button></div>
  <form id="commandForm" class="form-grid">
    <label>Command Key<input name="command_key" required placeholder="ban" value="${esc(command?.command_key)}"></label>
    <label>نام فارسی<input name="fa_name" placeholder="مسدود کردن" value="${esc(command?.fa_name)}"></label>
    <label>English Alias<input name="en_name" placeholder="ban" value="${esc(command?.en_name)}"></label>
    <label>Permission Level<select name="permission_level"><option value="10" ${command?.permission_level==10?"selected":""}>MEMBER · 10</option><option value="60" ${command?.permission_level==60?"selected":""}>MODERATOR · 60</option><option value="80" ${command?.permission_level==80?"selected":""}>ADMIN · 80</option><option value="100" ${command?.permission_level==100?"selected":""}>OWNER · 100</option></select></label>
    <label class="full">پاسخ فارسی<textarea name="response_fa" placeholder="متن پاسخ فارسی...">${esc(command?.response_fa)}</textarea></label>
    <label class="full">English Response<textarea name="response_en" placeholder="English response...">${esc(command?.response_en)}</textarea></label>
    <label class="switch-line"><input type="checkbox" name="enabled" ${command?.enabled!==false?"checked":""}> دستور فعال باشد</label>
    <div class="form-actions"><button type="button" class="ghost modal-cancel">انصراف</button><button class="primary" type="submit">${edit?"ذخیره تغییرات":"ایجاد دستور"}</button></div>
  </form></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove(); wrap.querySelector(".modal-close").onclick=close; wrap.querySelector(".modal-cancel").onclick=close;
  wrap.querySelector("#commandForm").onsubmit=async e=>{e.preventDefault(); const f=new FormData(e.target); const data=Object.fromEntries(f.entries()); data.enabled=f.get("enabled")==="on"; data.permission_level=Number(data.permission_level);
    const r=await fetch(edit?`/api/commands/${command.id}`:"/api/commands",{method:edit?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    if(!r.ok){alert("ذخیره دستور انجام نشد.");return;} close(); commandsPage();
  };
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
