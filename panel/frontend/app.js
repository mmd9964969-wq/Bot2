const titles={dashboard:"Dashboard",commands:"Commands",responses:"Responses",users:"Users",permissions:"Permissions",settings:"Settings",database:"Database",sync:"Sync",audit:"Audit Log"};
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

function permissionsPage(){
  shell("Permission Center","BOT MANAGEMENT · PERMISSIONS",`
    <div class="permission-hero"><div><span class="eyebrow">OWNER CONTROL</span><h2>مدیریت دسترسی در سطح قابلیت</h2><p>هر نقش می‌تواند برای هر عملیات دسترسی مستقل داشته باشد.</p></div><span class="security-badge">100% OWNER</span></div>
    <div class="panel-card permission-card"><div class="permission-grid">
      <div class="permission-grid-head"><span>ROLE</span><span>VIEW</span><span>CREATE</span><span>EDIT</span><span>DELETE</span><span>MANAGE</span></div>
      ${["OWNER","SUPER ADMIN","ADMIN","MODERATOR","SPECIAL USER","MEMBER"].map((r,i)=>`<div class="permission-grid-row"><b>${r}</b>${["VIEW","CREATE","EDIT","DELETE","MANAGE"].map((_,j)=>`<span class="perm-check ${i===5&&j>0?"disabled":""}">${i===5&&j>0?"—":"✓"}</span>`).join("")}</div>`).join("")}
    </div></div>`);
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
  if(name==="permissions")return permissionsPage();
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
