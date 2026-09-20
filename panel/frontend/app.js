const titles={dashboard:"Dashboard",commands:"Commands",responses:"Responses",users:"Users",permissions:"Permissions",settings:"Settings",database:"Database",sync:"Sync",audit:"Audit Log"};
const content=document.getElementById("content"), pageTitle=document.getElementById("pageTitle"), sidebar=document.getElementById("sidebar");
function page(name){
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===name));
  pageTitle.textContent=titles[name]||"Dashboard";
  if(name==="dashboard"){location.hash="dashboard"; location.reload(); return;}
  location.hash=name;
  content.innerHTML='<div class="page"><div class="empty-page"><div class="eyebrow">PERSIAN BOT STUDIO · '+String(name).toUpperCase()+'</div><h1>'+titles[name]+'</h1><div class="line"></div><p>رابط حرفه‌ای این بخش در ادامه مراحل پروژه به سیستم واقعی متصل می‌شود.</p><button class="primary" id="backDashboard">بازگشت به داشبورد</button></div></div>';
  document.getElementById("backDashboard").onclick=()=>{location.hash="dashboard";location.reload()};
  sidebar.classList.remove("open");
}
document.querySelectorAll("[data-page]").forEach(el=>el.addEventListener("click",()=>page(el.dataset.page)));
document.getElementById("mobileMenu")?.addEventListener("click",()=>sidebar.classList.toggle("open"));
document.getElementById("langBtn")?.addEventListener("click",()=>{
  const html=document.documentElement;
  const fa=html.getAttribute("dir")==="rtl";
  html.setAttribute("dir",fa?"ltr":"rtl");
  html.setAttribute("lang",fa?"en":"fa");
  document.getElementById("langBtn").textContent=fa?"EN":"FA";
});
async function health(){
  try{
    const r=await fetch("/api/health",{cache:"no-store"});
    const d=await r.json();
    const ok=d.status==="online";
    const db=!!d.database?.connected;
    const bot=document.getElementById("botStatus"), database=document.getElementById("dbStatus"), detail=document.getElementById("dbDetail");
    if(bot){bot.textContent=ok?"Online":"Offline";bot.nextElementSibling.textContent=ok?"Operational":"Unavailable"}
    if(database){database.textContent=db?"Connected":"Offline";database.nextElementSibling.textContent=db?"PostgreSQL":"DATABASE_URL"}
    const stamp=document.getElementById("lastRefresh"); if(stamp) stamp.textContent="● Live · "+new Date().toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"});
  }catch(e){
    const b=document.getElementById("botStatus");if(b){b.textContent="Offline";b.nextElementSibling.textContent="API unavailable"}
  }
}
if(location.hash&&location.hash!=="#dashboard")page(location.hash.slice(1)); else health();
setInterval(health,15000);