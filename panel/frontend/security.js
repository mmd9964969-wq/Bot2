(() => {
  const securityTitles = {
    fa: {title:"مرکز امنیت", kicker:"SECURITY CENTER · CONTROL", desc:"مرکز متمرکز برای کنترل دسترسی، نشست‌ها، هشدارهای امنیتی و واکنش اضطراری."},
    en: {title:"Security Center", kicker:"SECURITY CENTER · CONTROL", desc:"Central control for access, sessions, security alerts and emergency response."}
  };

  const escS = v => String(v ?? "").replace(/[&<>"]/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[m]));

  async function renderSecurity() {
    const root = document.getElementById("content");
    if (!root) return;
    const lang = localStorage.getItem("pbs_lang") === "en" ? "en" : "fa";
    const t = securityTitles[lang];
    const fa = lang === "fa";
    root.innerHTML = `
      <div class="page"><div class="workspace-page">
        <div class="workspace-head">
          <div><span class="eyebrow">${t.kicker}</span><h1>${t.title}</h1><p>${t.desc}</p></div>
          <button class="ghost" id="securityRefresh">↻ ${fa ? "بروزرسانی" : "Refresh"}</button>
        </div>
        <div class="stats">
          <div class="stat-card featured"><div class="stat-top"><span class="stat-icon green">◇</span><span class="stat-kicker">${fa ? "وضعیت امنیت" : "SECURITY STATUS"}</span></div><strong id="secStatus">${fa ? "در حال بررسی" : "Checking"}</strong><span id="secStatusText">${fa ? "در حال دریافت رویدادهای امنیتی" : "Loading security events"}</span></div>
          <div class="stat-card"><div class="stat-top"><span class="stat-icon gold">⚠</span><span class="stat-kicker">${fa ? "هشدارها" : "ALERTS"}</span></div><strong id="secAlerts">—</strong><span>Warning / Critical</span></div>
          <div class="stat-card"><div class="stat-top"><span class="stat-icon purple">♜</span><span class="stat-kicker">${fa ? "دسترسی ردشده" : "DENIED"}</span></div><strong id="secDenied">—</strong><span>Permission denied events</span></div>
          <div class="stat-card"><div class="stat-top"><span class="stat-icon blue">◉</span><span class="stat-kicker">${fa ? "رویدادهای امنیتی" : "SECURITY EVENTS"}</span></div><strong id="secEvents">—</strong><span>${fa ? "آخرین ۲۴ ساعت" : "Last 24 hours"}</span></div>
        </div>
        <div class="dashboard-grid">
          <div class="panel-card">
            <div class="card-head"><div><span class="eyebrow">${fa ? "ACCESS CONTROL" : "ACCESS CONTROL"}</span><h3>${fa ? "کنترل دسترسی" : "Access Control"}</h3></div><span class="badge">OWNER · 100</span></div>
            <div class="security-list">
              <div><span class="check">✓</span><div><b>${fa ? "Permission Engine" : "Permission Engine"}</b><small>${fa ? "کنترل نقش و مجوزهای عملیاتی" : "Role and operation permissions"}</small></div><em>ACTIVE</em></div>
              <div><span class="check">✓</span><div><b>${fa ? "Owner Lock" : "Owner Lock"}</b><small>${fa ? "دسترسی مالک محافظت شده" : "Owner access is protected"}</small></div><em>ACTIVE</em></div>
              <div><span class="check">✓</span><div><b>${fa ? "Audit Trail" : "Audit Trail"}</b><small>${fa ? "تغییرات حساس قابل پیگیری هستند" : "Sensitive changes are traceable"}</small></div><em>READY</em></div>
            </div>
          </div>
          <div class="panel-card">
            <div class="card-head"><div><span class="eyebrow">EMERGENCY</span><h3>${fa ? "کنترل اضطراری" : "Emergency Controls"}</h3></div><span class="shield">◇</span></div>
            <div class="security-list">
              <div><span class="check">!</span><div><b>${fa ? "قفل عملیات حساس" : "Lock sensitive operations"}</b><small>${fa ? "زیرساخت دکمه آماده است؛ اجرای واقعی بعد از اتصال Runtime انجام می‌شود." : "Control is staged; runtime enforcement comes with Bot Runtime."}</small></div><em>READY</em></div>
              <div><span class="check">!</span><div><b>${fa ? "پایان Sessionها" : "Terminate sessions"}</b><small>${fa ? "مدیریت Session در هسته احراز هویت تکمیل می‌شود." : "Session management will be wired to the auth core."}</small></div><em>STAGED</em></div>
            </div>
          </div>
        </div>
        <div class="panel-card command-table-card">
          <div class="table-head"><div><b>${fa ? "رویدادهای امنیتی اخیر" : "Recent Security Events"}</b><small>${fa ? "برگرفته از مرکز نظارت" : "Sourced from Supervision Center"}</small></div><span class="badge" id="secCount">0</span></div>
          <div id="securityEvents" class="command-table"><div class="loading-state">${fa ? "در حال دریافت..." : "Loading..."}</div></div>
        </div>
      </div></div>`;

    async function load() {
      try {
        const r = await fetch("/api/supervision/events?limit=100", {cache:"no-store"});
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "API error");
        const events = (d.events || []).filter(e => ["warning","error","critical"].includes(e.severity) || String(e.event_type).includes("security") || String(e.event_type).includes("permission"));
        const recent = (d.events || []).filter(e => new Date(e.created_at) >= Date.now() - 86400000);
        const alerts = recent.filter(e => ["warning","critical"].includes(e.severity)).length;
        const denied = recent.filter(e => e.event_type === "permission_denied").length;
        document.getElementById("secAlerts").textContent = alerts;
        document.getElementById("secDenied").textContent = denied;
        document.getElementById("secEvents").textContent = recent.length;
        document.getElementById("secStatus").textContent = alerts || denied ? (fa ? "نیازمند بررسی" : "Review") : (fa ? "پایدار" : "Stable");
        document.getElementById("secStatusText").textContent = alerts || denied ? (fa ? "رویداد امنیتی ثبت شده است" : "Security events detected") : (fa ? "هشدار بحرانی ثبت نشده" : "No critical alerts detected");
        document.getElementById("secCount").textContent = events.length;
        const box = document.getElementById("securityEvents");
        box.innerHTML = events.length ? '<div class="command-row command-header"><span>EVENT</span><span>SEVERITY</span><span>ACTOR</span><span>TIME</span><span>STATUS</span></div>' +
          events.slice(0,50).map(e => '<div class="command-row"><div><b>'+escS(e.event_type)+'</b><small>'+escS(e.target_type||"system")+' · '+escS(e.target_id||"—")+'</small></div><span class="permission-pill">'+escS(String(e.severity||"info").toUpperCase())+'</span><span class="alias">'+escS(e.actor_id||"system")+'</span><span class="alias">'+new Date(e.created_at).toLocaleString(fa?"fa-IR":"en-US",{hour:"2-digit",minute:"2-digit",month:"2-digit",day:"2-digit"})+'</span><span class="status '+(e.severity==="critical"||e.severity==="error"?"off":"on")+'">'+(e.severity==="critical"||e.severity==="error"?"REVIEW":"LOGGED")+'</span></div>').join("") :
          '<div class="empty-table"><span>◇</span><b>'+ (fa ? "رویداد امنیتی ثبت نشده" : "No security events") +'</b><small>'+ (fa ? "سیستم در حال پایش مرکز نظارت است." : "Security monitoring is connected to Supervision Center.") +'</small></div>';
      } catch (e) {
        document.getElementById("securityEvents").innerHTML='<div class="loading-state error">'+(fa ? "دریافت رویدادهای امنیتی انجام نشد." : "Security events could not be loaded.")+'</div>';
      }
    }
    document.getElementById("securityRefresh")?.addEventListener("click", load);
    await load();
  }

  function activate() { renderSecurity(); }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-page='security']");
    if (b) { e.preventDefault(); history.pushState({}, "", "#security"); activate(); }
  });
  window.addEventListener("hashchange", () => { if (location.hash.slice(1) === "security") activate(); });
  if (location.hash.slice(1) === "security") activate();
})();