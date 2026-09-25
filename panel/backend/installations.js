const { query } = require("./database");
function send(res,status,body){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(body);}
const MEMBER_POLICIES=["silent","commands_only","automation","custom"];
const COMMAND_POLICIES=["enabled","disabled"];
const SECURITY_MODES=["standard","strict","custom"];
async function ensureInstallationsSchema(){
  await query("CREATE TABLE IF NOT EXISTS bot_group_installations (group_id BIGINT PRIMARY KEY,installed BOOLEAN NOT NULL DEFAULT FALSE,installed_at TIMESTAMPTZ,installed_by BIGINT,uninstalled_at TIMESTAMPTZ,uninstalled_by BIGINT,installation_version TEXT NOT NULL DEFAULT 'v1.0.0',bot_permission_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,response_policy TEXT NOT NULL DEFAULT 'standard',member_message_policy TEXT NOT NULL DEFAULT 'silent',command_policy TEXT NOT NULL DEFAULT 'enabled',command_mode TEXT NOT NULL DEFAULT 'plain',automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,security_mode TEXT NOT NULL DEFAULT 'standard',audit_enabled BOOLEAN NOT NULL DEFAULT TRUE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE TABLE IF NOT EXISTS bot_installation_events (id BIGSERIAL PRIMARY KEY,group_id BIGINT NOT NULL,actor_id BIGINT,event_type TEXT NOT NULL,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await query("CREATE INDEX IF NOT EXISTS idx_bot_installation_events_group_time ON bot_installation_events(group_id,created_at DESC)");
}
function body(req){return new Promise(function(resolve,reject){let data="";req.on("data",function(c){data+=c});req.on("end",function(){try{resolve(data?JSON.parse(data):{})}catch(e){reject(new Error("Invalid JSON"))}});req.on("error",reject)});}
async function installationsApi(req,res,url){
  if(req.method==="GET"&&url.pathname==="/api/installations"){
    const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||200),1),500);
    const r=await query("SELECT g.id AS group_id,COALESCE(g.title,'') AS title,g.username,g.type,g.is_active,COALESCE(i.installed,FALSE) AS installed,i.installed_at,i.installed_by,i.uninstalled_at,i.uninstalled_by,COALESCE(i.installation_version,'v1.0.0') AS installation_version,COALESCE(i.member_message_policy,'silent') AS member_message_policy,COALESCE(i.command_policy,'enabled') AS command_policy,COALESCE(i.command_mode,'plain') AS command_mode,COALESCE(i.automation_enabled,FALSE) AS automation_enabled,COALESCE(i.security_mode,'standard') AS security_mode,COALESCE(i.audit_enabled,TRUE) AS audit_enabled,COALESCE(i.bot_permission_snapshot,'{}'::jsonb) AS bot_permission_snapshot,i.updated_at FROM bot_groups g LEFT JOIN bot_group_installations i ON i.group_id=g.id ORDER BY COALESCE(i.installed,FALSE) DESC,g.updated_at DESC LIMIT $1",[limit]);
    return send(res,200,JSON.stringify({installations:r.rows}));
  }
  const m=url.pathname.match(/^\/api\/installations\/(-?\d+)$/);
  if(m&&req.method==="GET"){
    const r=await query("SELECT g.id AS group_id,COALESCE(g.title,'') AS title,g.username,g.type,g.is_active,i.* FROM bot_groups g LEFT JOIN bot_group_installations i ON i.group_id=g.id WHERE g.id=$1 LIMIT 1",[m[1]]);
    if(!r.rowCount)return send(res,404,JSON.stringify({error:"Group not found"}));
    const h=await query("SELECT id,actor_id,event_type,metadata,created_at FROM bot_installation_events WHERE group_id=$1 ORDER BY created_at DESC LIMIT 100",[m[1]]);
    return send(res,200,JSON.stringify({installation:r.rows[0],private_chat:{enabled:false,locked:true},history:h.rows}));
  }
  if(m&&req.method==="PUT"){
    const b=await body(req);const member=String(b.member_message_policy||""),command=String(b.command_policy||""),security=String(b.security_mode||"");
    if(!MEMBER_POLICIES.includes(member)||!COMMAND_POLICIES.includes(command)||!SECURITY_MODES.includes(security))return send(res,400,JSON.stringify({error:"Invalid installation policy"}));
    const old=await query("SELECT * FROM bot_group_installations WHERE group_id=$1 LIMIT 1",[m[1]]);
    if(!old.rowCount)return send(res,404,JSON.stringify({error:"Installation state not found"}));
    const actor=Number.isSafeInteger(Number(b.actor_id))?Number(b.actor_id):null,automation=b.automation_enabled===true,audit=b.audit_enabled!==false;
    const saved=await query("UPDATE bot_group_installations SET member_message_policy=$1,response_policy=$2,command_policy=$3,command_mode='plain',automation_enabled=$4,security_mode=$5,audit_enabled=$6,updated_at=NOW() WHERE group_id=$7 RETURNING *",[member,member==="silent"?"standard":"custom",command,automation,security,audit,m[1]]);
    await query("INSERT INTO bot_installation_events(group_id,actor_id,event_type,metadata) VALUES($1,$2,'policy_changed',$3::jsonb)",[m[1],actor,JSON.stringify({before:{member_message_policy:old.rows[0].member_message_policy,command_policy:old.rows[0].command_policy,automation_enabled:old.rows[0].automation_enabled,security_mode:old.rows[0].security_mode,audit_enabled:old.rows[0].audit_enabled},after:{member_message_policy:member,command_policy:command,automation_enabled:automation,security_mode:security,audit_enabled:audit}})]);
    await query("INSERT INTO audit_logs(actor_id,action,target,before_data,after_data,source) VALUES($1,'installation_policy_changed',$2,$3::jsonb,$4::jsonb,'panel')",[actor,String(m[1]),JSON.stringify(old.rows[0]),JSON.stringify(saved.rows[0])]);
    return send(res,200,JSON.stringify({installation:saved.rows[0],private_chat:{enabled:false,locked:true}}));
  }
  const h=url.pathname.match(/^\/api\/installations\/(-?\d+)\/history$/);
  if(h&&req.method==="GET"){
    const r=await query("SELECT id,actor_id,event_type,metadata,created_at FROM bot_installation_events WHERE group_id=$1 ORDER BY created_at DESC LIMIT 200",[h[1]]);
    return send(res,200,JSON.stringify({events:r.rows}));
  }
  return null;
}
module.exports={ensureInstallationsSchema,installationsApi};
