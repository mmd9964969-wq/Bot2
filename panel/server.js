const http = require("http");
const fs = require("fs");
const path = require("path");
const { checkConnection, query } = require("./backend/database");

const PORT = process.env.PORT || 3000;

async function ensurePermissionSchema() {
  await query(`CREATE TABLE IF NOT EXISTS role_permissions (
    role TEXT NOT NULL,
    permission_key TEXT NOT NULL,
    allowed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role, permission_key)
  )`);
  const defaults = {
    OWNER: {view:true,create:true,edit:true,delete:true,manage:true,configure:true,execute:true,sync:true},
    SUPER_ADMIN: {view:true,create:true,edit:true,delete:true,manage:true,configure:true,execute:true,sync:true},
    ADMIN: {view:true,create:true,edit:true,delete:false,manage:true,configure:true,execute:true,sync:false},
    MODERATOR: {view:true,create:false,edit:true,delete:false,manage:true,configure:false,execute:true,sync:false},
    SPECIAL_USER: {view:true,create:false,edit:false,delete:false,manage:false,configure:false,execute:true,sync:false},
    MEMBER: {view:true,create:false,edit:false,delete:false,manage:false,configure:false,execute:false,sync:false}
  };
  for (const [role, perms] of Object.entries(defaults)) {
    for (const [key, allowed] of Object.entries(perms)) {
      await query(`INSERT INTO role_permissions (role, permission_key, allowed)
        VALUES ($1,$2,$3)
        ON CONFLICT (role, permission_key) DO NOTHING`, [role,key,allowed]);
    }
  }
}

async function ensureRuntimeSchema() {
  await query(`CREATE TABLE IF NOT EXISTS runtime_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    auto_restart BOOLEAN NOT NULL DEFAULT TRUE,
    graceful_shutdown BOOLEAN NOT NULL DEFAULT TRUE,
    worker_count INTEGER NOT NULL DEFAULT 1,
    queue_size INTEGER NOT NULL DEFAULT 100,
    concurrency INTEGER NOT NULL DEFAULT 10,
    request_timeout_ms INTEGER NOT NULL DEFAULT 15000,
    max_retries INTEGER NOT NULL DEFAULT 3,
    backoff_ms INTEGER NOT NULL DEFAULT 1000,
    log_level TEXT NOT NULL DEFAULT 'info',
    deduplication BOOLEAN NOT NULL DEFAULT TRUE,
    deduplication_ttl_seconds INTEGER NOT NULL DEFAULT 600,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`INSERT INTO runtime_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
}

async function runtimeApi(req,res,url){
  if(req.method==="GET" && url.pathname==="/api/runtime/overview"){
    const settings=(await query("SELECT * FROM runtime_settings WHERE id=1")).rows[0];
    const db=await checkConnection();
    const [events,errors]=await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM supervision_events WHERE created_at >= NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*)::int AS count FROM supervision_events WHERE severity IN ('error','critical') AND created_at >= NOW() - INTERVAL '24 hours'")
    ]);
    return send(res,200,JSON.stringify({runtime:{status:"ready",mode:"panel_control",telegram:"not_connected_to_runtime",note:"Bot Core runtime control will be connected in the next integration stage"},database:db,metrics:{events24h:events.rows[0].count,errors24h:errors.rows[0].count},settings}));
  }
  if(req.method==="PUT" && url.pathname==="/api/runtime/settings"){
    const body=await readBody(req), before=(await query("SELECT * FROM runtime_settings WHERE id=1")).rows[0];
    const num=(v,d,min,max)=>Math.min(Math.max(Number.isFinite(Number(v))?Number(v):d,min),max);
    const next={auto_restart:body.auto_restart!==false,graceful_shutdown:body.graceful_shutdown!==false,worker_count:num(body.worker_count,before.worker_count,1,32),queue_size:num(body.queue_size,before.queue_size,10,10000),concurrency:num(body.concurrency,before.concurrency,1,500),request_timeout_ms:num(body.request_timeout_ms,before.request_timeout_ms,1000,120000),max_retries:num(body.max_retries,before.max_retries,0,10),backoff_ms:num(body.backoff_ms,before.backoff_ms,100,60000),log_level:["error","warn","info","debug"].includes(body.log_level)?body.log_level:before.log_level,deduplication:body.deduplication!==false,deduplication_ttl_seconds:num(body.deduplication_ttl_seconds,before.deduplication_ttl_seconds,30,86400)};
    const r=await query(`UPDATE runtime_settings SET auto_restart=$1,graceful_shutdown=$2,worker_count=$3,queue_size=$4,concurrency=$5,request_timeout_ms=$6,max_retries=$7,backoff_ms=$8,log_level=$9,deduplication=$10,deduplication_ttl_seconds=$11,updated_at=NOW() WHERE id=1 RETURNING *`,[next.auto_restart,next.graceful_shutdown,next.worker_count,next.queue_size,next.concurrency,next.request_timeout_ms,next.max_retries,next.backoff_ms,next.log_level,next.deduplication,next.deduplication_ttl_seconds]);
    await audit("runtime_settings_changed","panel-owner","runtime_settings",before,r.rows[0],"panel");
    return send(res,200,JSON.stringify({settings:r.rows[0]}));
  }
  if(req.method==="POST" && url.pathname==="/api/runtime/action"){
    const body=await readBody(req), action=["health_check","reload_config","restart_requested","maintenance_on","maintenance_off"].includes(body.action)?body.action:null;
    if(!action)return send(res,400,JSON.stringify({error:"Invalid runtime action"}));
    await query("INSERT INTO supervision_events (event_type,severity,actor_id,target_type,target_id,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",[action==="health_check"?"system_health":"runtime_action",action==="health_check"?"info":"warning","panel-owner","runtime","runtime",JSON.stringify({action})]);
    return send(res,200,JSON.stringify({success:true,action,status:"recorded",note:"Action is recorded; live Bot Core execution control is not connected yet."}));
  }
  return null;
}

async function ensureSupervisionSchema() {
  await query(`CREATE TABLE IF NOT EXISTS supervision_events (
    id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info',
    actor_id TEXT, target_type TEXT, target_id TEXT, command_key TEXT, group_id BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_supervision_events_created_at ON supervision_events(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_supervision_events_type ON supervision_events(event_type)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_supervision_events_actor ON supervision_events(actor_id)`);
}
async function supervisionApi(req,res,url) {
  if(req.method==="GET" && url.pathname==="/api/supervision/summary"){
    const [events,users,commands,alerts,errors]=await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM supervision_events WHERE created_at >= NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*)::int AS count FROM users"),
      query("SELECT COUNT(*)::int AS count FROM commands WHERE enabled = TRUE"),
      query("SELECT COUNT(*)::int AS count FROM supervision_events WHERE severity IN ('warning','critical') AND created_at >= NOW() - INTERVAL '24 hours'"),
      query("SELECT COUNT(*)::int AS count FROM supervision_events WHERE severity IN ('error','critical') AND created_at >= NOW() - INTERVAL '24 hours'")
    ]);
    return send(res,200,JSON.stringify({events24h:events.rows[0].count,users:users.rows[0].count,activeCommands:commands.rows[0].count,securityAlerts24h:alerts.rows[0].count,errors24h:errors.rows[0].count}));
  }
  if(req.method==="GET" && url.pathname==="/api/supervision/events"){
    const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),200);
    const type=url.searchParams.get("type"), severity=url.searchParams.get("severity"), params=[], where=[];
    if(type){params.push(type);where.push("event_type = $"+params.length);}
    if(severity){params.push(severity);where.push("severity = $"+params.length);}
    params.push(limit);
    const result=await query("SELECT id,event_type,severity,actor_id,target_type,target_id,command_key,group_id,metadata,created_at FROM supervision_events "+(where.length?"WHERE "+where.join(" AND "):"")+" ORDER BY created_at DESC LIMIT $"+params.length,params);
    return send(res,200,JSON.stringify({events:result.rows}));
  }
  if(req.method==="POST" && url.pathname==="/api/supervision/events"){
    const body=await readBody(req), eventType=String(body.event_type||"").trim(), allowed=["info","success","warning","error","critical"];
    const severity=allowed.includes(body.severity)?body.severity:"info";
    if(!eventType)return send(res,400,JSON.stringify({error:"event_type is required"}));
    const result=await query("INSERT INTO supervision_events (event_type,severity,actor_id,target_type,target_id,command_key,group_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *",[eventType,severity,body.actor_id||null,body.target_type||null,body.target_id||null,body.command_key||null,body.group_id||null,JSON.stringify(body.metadata||{})]);
    return send(res,201,JSON.stringify({event:result.rows[0]}));
  }
  return null;
}

const FRONTEND = path.join(__dirname, "frontend");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {"Content-Type": type, "Cache-Control": "no-store"});
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function audit(action, actorId, target, beforeData, afterData, source="panel"){
  try{
    await query("INSERT INTO audit_logs (actor_id,action,target,before_data,after_data,source) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)",[actorId||null,action,target||null,JSON.stringify(beforeData||null),JSON.stringify(afterData||null),source]);
  }catch(error){ console.error("Audit write failed:", error.message); }
}

async function permissionsApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/permissions") {
    const result = await query("SELECT role, permission_key, allowed FROM role_permissions ORDER BY role, permission_key");
    return send(res, 200, JSON.stringify({permissions: result.rows}));
  }
  if (req.method === "PUT" && url.pathname === "/api/permissions") {
    const body = await readBody(req);
    const role = String(body.role || "").toUpperCase().replace(/\s+/g, "_");
    const allowedRoles = ["OWNER","SUPER_ADMIN","ADMIN","MODERATOR","SPECIAL_USER","MEMBER"];
    const keys = ["view","create","edit","delete","manage","configure","execute","sync"];
    if (!allowedRoles.includes(role) || !keys.includes(body.permission_key)) return send(res,400,JSON.stringify({error:"Invalid role or permission_key"}));
    if (role === "OWNER" && body.allowed === false) return send(res,403,JSON.stringify({error:"OWNER permissions cannot be disabled"}));
    await query("INSERT INTO role_permissions (role, permission_key, allowed, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (role, permission_key) DO UPDATE SET allowed=EXCLUDED.allowed, updated_at=NOW()",[role,body.permission_key,body.allowed===true]);
    await audit("permission_changed",body.actor_id,null,null,{role,permission_key:body.permission_key,allowed:body.allowed===true});
    return send(res,200,JSON.stringify({success:true}));
  }
  return null;
}

async function responseStudioApi(req,res,url) {
  if (req.method === "GET" && url.pathname === "/api/responses") {
    const result = await query("SELECT id,response_key,event_type,title,message_fa,message_en,channel,enabled,created_at,updated_at FROM response_templates ORDER BY id DESC");
    return send(res,200,JSON.stringify({responses:result.rows}));
  }
  if (req.method === "POST" && url.pathname === "/api/responses") {
    const body=await readBody(req);
    const key=String(body.response_key||"").trim().toLowerCase().replace(/[^a-z0-9_\-]/g,"_");
    if(!key) return send(res,400,JSON.stringify({error:"response_key is required"}));
    const result=await query("INSERT INTO response_templates (response_key,event_type,title,message_fa,message_en,channel,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",[key,body.event_type||"custom",body.title||"",body.message_fa||"",body.message_en||"",body.channel||"group",body.enabled!==false]);
    return send(res,201,JSON.stringify({response:result.rows[0]}));
  }
  const match=url.pathname.match(/^\/api\/responses\/(\d+)$/);
  if(match && (req.method==="PUT" || req.method==="DELETE")){
    const id=Number(match[1]);
    if(req.method==="DELETE"){await query("DELETE FROM response_templates WHERE id=$1",[id]);return send(res,200,JSON.stringify({success:true}));}
    const body=await readBody(req);
    const key=String(body.response_key||"").trim().toLowerCase().replace(/[^a-z0-9_\-]/g,"_");
    if(!key)return send(res,400,JSON.stringify({error:"response_key is required"}));
    const result=await query("UPDATE response_templates SET response_key=$1,event_type=$2,title=$3,message_fa=$4,message_en=$5,channel=$6,enabled=$7,updated_at=NOW() WHERE id=$8 RETURNING *",[key,body.event_type||"custom",body.title||"",body.message_fa||"",body.message_en||"",body.channel||"group",body.enabled!==false,id]);
    if(!result.rowCount)return send(res,404,JSON.stringify({error:"Response not found"}));
    return send(res,200,JSON.stringify({response:result.rows[0]}));
  }
  return null;
}

async function usersApi(req,res,url){
  if(req.method==="GET" && url.pathname==="/api/users"){
    const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||100),1),500);
    const q=String(url.searchParams.get("q")||"").trim().toLowerCase();
    const params=[]; let where="";
    if(q){params.push("%"+q+"%");where="WHERE LOWER(COALESCE(first_name,'')||' '||COALESCE(username,'')||' '||COALESCE(telegram_id::text,'')||' '||COALESCE(id,'')) LIKE $1";}
    params.push(limit);
    const result=await query("SELECT id,telegram_id,username,first_name,role,language,is_active,created_at,updated_at FROM users "+where+" ORDER BY updated_at DESC LIMIT $"+params.length,params);
    return send(res,200,JSON.stringify({users:result.rows}));
  }
  const permMatch=url.pathname.match(/^\/api\/users\/([^/]+)\/permissions$/);
  if(permMatch && req.method==="GET"){
    const userId=decodeURIComponent(permMatch[1]);
    const user=await query("SELECT id,telegram_id,username,first_name,role,language,is_active,created_at,updated_at FROM users WHERE id=$1 OR telegram_id::text=$1 LIMIT 1",[userId]);
    if(!user.rowCount)return send(res,404,JSON.stringify({error:"User not found"}));
    const permissions=await query("SELECT permission_key,allowed FROM user_permissions WHERE user_id=$1 ORDER BY permission_key",[user.rows[0].id]);
    return send(res,200,JSON.stringify({user:user.rows[0],permissions:permissions.rows}));
  }
  if(permMatch && req.method==="PUT"){
    const userId=decodeURIComponent(permMatch[1]), body=await readBody(req);
    const keys=["view","create","edit","delete","manage","configure","execute","sync"];
    if(!keys.includes(body.permission_key))return send(res,400,JSON.stringify({error:"Invalid permission_key"}));
    const user=await query("SELECT id FROM users WHERE id=$1 OR telegram_id::text=$1 LIMIT 1",[userId]);
    if(!user.rowCount)return send(res,404,JSON.stringify({error:"User not found"}));
    await query("INSERT INTO user_permissions (user_id,permission_key,allowed,updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (user_id,permission_key) DO UPDATE SET allowed=EXCLUDED.allowed,updated_at=NOW()",[user.rows[0].id,body.permission_key,body.allowed===true]);
    await audit("user_permission_changed",body.actor_id,user.rows[0].id,null,{permission_key:body.permission_key,allowed:body.allowed===true});
    return send(res,200,JSON.stringify({success:true}));
  }
  const idMatch=url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if(idMatch && req.method==="GET"){
    const userId=decodeURIComponent(idMatch[1]);
    const user=await query("SELECT id,telegram_id,username,first_name,role,language,is_active,created_at,updated_at FROM users WHERE id=$1 OR telegram_id::text=$1 LIMIT 1",[userId]);
    if(!user.rowCount)return send(res,404,JSON.stringify({error:"User not found"}));
    return send(res,200,JSON.stringify({user:user.rows[0]}));
  }
  if(idMatch && req.method==="PUT"){
    const userId=decodeURIComponent(idMatch[1]), body=await readBody(req);
    const before=await query("SELECT id,telegram_id,username,first_name,role,language,is_active FROM users WHERE id=$1 OR telegram_id::text=$1 LIMIT 1",[userId]);
    if(!before.rowCount)return send(res,404,JSON.stringify({error:"User not found"}));
    const allowedRoles=["owner","super_admin","admin","moderator","special_user","member"];
    const role=String(body.role||before.rows[0].role).toLowerCase();
    if(!allowedRoles.includes(role))return send(res,400,JSON.stringify({error:"Invalid role"}));
    const result=await query("UPDATE users SET role=$1,language=$2,is_active=$3,updated_at=NOW() WHERE id=$4 RETURNING id,telegram_id,username,first_name,role,language,is_active,created_at,updated_at",[role,body.language||before.rows[0].language,body.is_active!==false,before.rows[0].id]);
    await audit("user_updated",body.actor_id,before.rows[0].id,before.rows[0],result.rows[0]);
    return send(res,200,JSON.stringify({user:result.rows[0]}));
  }
  return null;
}

async function commandsApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/commands") {
    const result = await query("SELECT id, command_key, fa_name, en_name, enabled, permission_level, response_fa, response_en, created_at, updated_at FROM commands ORDER BY id DESC");
    return send(res, 200, JSON.stringify({commands: result.rows}));
  }

  if (req.method === "POST" && url.pathname === "/api/commands") {
    const body = await readBody(req);
    if (!body.command_key) return send(res, 400, JSON.stringify({error:"command_key is required"}));
    const result = await query(
      "INSERT INTO commands (command_key, fa_name, en_name, enabled, permission_level, response_fa, response_en) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        String(body.command_key).trim().toLowerCase().replace(/^\//, ""),
        body.fa_name || "", body.en_name || "", body.enabled !== false,
        Number(body.permission_level ?? 10), body.response_fa || "", body.response_en || ""
      ]
    );
    return send(res, 201, JSON.stringify({command:result.rows[0]}));
  }

  const match = url.pathname.match(/^\/api\/commands\/(\d+)$/);
  if (match && (req.method === "PUT" || req.method === "DELETE")) {
    const id = Number(match[1]);
    if (req.method === "DELETE") {
      await query("DELETE FROM commands WHERE id=$1",[id]);
      return send(res,200,JSON.stringify({success:true}));
    }
    const body = await readBody(req);
    const result = await query(
      "UPDATE commands SET command_key=$1, fa_name=$2, en_name=$3, enabled=$4, permission_level=$5, response_fa=$6, response_en=$7, updated_at=NOW() WHERE id=$8 RETURNING *",
      [
        String(body.command_key || "").trim().toLowerCase().replace(/^\//, ""),
        body.fa_name || "", body.en_name || "", body.enabled !== false,
        Number(body.permission_level ?? 10), body.response_fa || "", body.response_en || "", id
      ]
    );
    if (!result.rowCount) return send(res,404,JSON.stringify({error:"Command not found"}));
    return send(res,200,JSON.stringify({command:result.rows[0]}));
  }

  return null;
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,"http://localhost");

    if (url.pathname === "/api/health") {
      const database = await checkConnection();
      return send(res,200,JSON.stringify({
        name:"PERSIAN BOT STUDIO", status:"online", phase:"03",
        language:["fa","en"], database, timestamp:new Date().toISOString()
      }));
    }

    if (url.pathname.startsWith("/api/runtime")) { const handled = await runtimeApi(req,res,url); if (handled !== null) return handled; }\n    if (url.pathname.startsWith("/api/responses")) { const handled = await responseStudioApi(req,res,url); if (handled !== null) return handled; }
    if (url.pathname.startsWith("/api/users")) { const handled = await usersApi(req,res,url); if (handled !== null) return handled; }
    if (url.pathname.startsWith("/api/supervision")) {
      const handled = await supervisionApi(req,res,url);
      if (handled !== null) return handled;
    }
    if (url.pathname.startsWith("/api/permissions")) {
      const handled = await permissionsApi(req,res,url);
      if (handled !== null) return handled;
    }
    if (url.pathname.startsWith("/api/commands")) {
      const handled = await commandsApi(req,res,url);
      if (handled !== null) return handled;
    }

    if (url.pathname.startsWith("/api/")) {
      return send(res,404,JSON.stringify({error:"API route not found"}));
    }

    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(FRONTEND,requestPath.replace(/^\/+/, "")));
    if (!filePath.startsWith(FRONTEND + path.sep)) return send(res,403,JSON.stringify({error:"Forbidden"}));

    fs.readFile(filePath,(error,data) => {
      if (error) return send(res,404,JSON.stringify({error:"Not found"}));
      send(res,200,data,types[path.extname(filePath)] || "application/octet-stream");
    });
  } catch(error) {
    send(res,500,JSON.stringify({error:error.message}));
  }
});
Promise.all([ensurePermissionSchema(), ensureSupervisionSchema(), ensureRuntimeSchema()])
  .then(() => server.listen(PORT, () => console.log(`PERSIAN BOT STUDIO running on port ${PORT}`)))
  .catch(error => {
    console.error("Permission schema initialization failed:", error);
    process.exit(1);
  });
