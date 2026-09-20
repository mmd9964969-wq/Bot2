const pageTitles={dashboard:"داشبورد مدیریت ربات",commands:"مدیریت دستورات",responses:"مدیریت پاسخ‌ها",users:"مدیریت کاربران",permissions:"مدیریت دسترسی‌ها",settings:"تنظیمات سیستم",database:"وضعیت دیتابیس",sync:"مرکز همگام‌سازی",audit:"گزارش فعالیت سیستم"};
const pageEnglish={dashboard:"Dashboard",commands:"Commands",responses:"Responses",users:"Users",permissions:"Permissions",settings:"Settings",database:"Database",sync:"Sync Center",audit:"Audit Log"};
const nav=document.querySelector("#nav"),content=document.querySelector("#pageContent"),title=document.querySelector("#pageTitle");

function showPage(page){
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  title.textContent=pageTitles[page]||pageTitles.dashboard;
  if(page==="dashboard"){location.hash="dashboard";renderDashboard();return}
  location.hash=page;
  content.innerHTML=`<section class="panel-card empty-page"><div><div class="empty-icon">${iconFor(page)}</div><span class="page-tag">${pageEnglish[page].toUpperCase()} / PERSIAN BOT STUDIO</span><h2>${pageTitles[page]}</h2><p>ساختار رابط این بخش آماده شده و اتصال عملیاتی آن در مرحله API تکمیل خواهد شد.</p></div></section>`;
}
function iconFor(page){return ({commands:"⌘",responses:"◈",users:"♙",permissions:"⚿",settings:"⚙",database:"◉",sync:"↔",audit:"⌁"})[page]||"PB"}
function renderDashboard(){location.hash="dashboard";/* static dashboard is initial HTML */}
nav.addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)showPage(b.dataset.page)});
document.addEventListener("click",e=>{const b=e.target.closest("[data-page-action]");if(b)showPage(b.dataset.pageAction)});
document.querySelector("#langBtn").addEventListener("click",()=>{document.documentElement.lang=document.documentElement.lang==="fa"?"en":"fa";document.documentElement.dir=document.documentElement.lang==="fa"?"rtl":"ltr"});
async function loadHealth(){
 try{const r=await fetch("/api/health",{cache:"no-store"});const d=await r.json();const db=d.database||{};document.querySelector("#systemStatus").textContent=(d.status||"offline").toUpperCase();document.querySelector("#botStat").textContent=(d.status||"offline").toUpperCase();document.querySelector("#dbStatus").textContent=db.connected?"ONLINE":"OFFLINE";document.querySelector("#dbText").textContent=db.connected?"Connected":db.configured?"Connection Error":"Not Configured";document.querySelector("#dbBadge").textContent=db.connected?"Connected":"Attention"}catch(e){document.querySelector("#systemStatus").textContent="OFFLINE";document.querySelector("#botStat").textContent="OFFLINE";document.querySelector("#dbStatus").textContent="ERROR";document.querySelector("#dbText").textContent="API Unavailable";document.querySelector("#dbBadge").textContent="Error"}}
loadHealth();setInterval(loadHealth,15000);
const initial=location.hash.replace("#","");if(initial&&pageTitles[initial])showPage(initial);