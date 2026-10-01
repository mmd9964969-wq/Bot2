import { telegramApi } from "../telegram/api.ts";

type Queryable = {
  query<T = any>(text:string, params?:unknown[]):Promise<any>;
};

async function rows<T=any>(db:Queryable,text:string,params:unknown[]=[]):Promise<T[]>{
  const result=await db.query<T>(text,params);
  return Array.isArray(result) ? result as T[] : (result?.rows ?? []);
}

export type OwnerGroupStatus = "ACTIVE"|"DISABLED"|"RESTRICTED"|"LEFT"|"ERROR"|"UNKNOWN"|"SYNCING"|"RESETTING";

export async function ensureOwnerGroupSchema(db:Queryable){
  await db.query(`
    CREATE TABLE IF NOT EXISTS owner_group_registry(
      group_id BIGINT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      username TEXT,
      chat_type TEXT NOT NULL DEFAULT 'supergroup',
      bot_status TEXT NOT NULL DEFAULT 'ACTIVE',
      telegram_status TEXT NOT NULL DEFAULT 'unknown',
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      member_count INTEGER NOT NULL DEFAULT 0,
      admin_count INTEGER NOT NULL DEFAULT 0,
      owner_name TEXT,
      bot_can_delete BOOLEAN NOT NULL DEFAULT FALSE,
      bot_can_restrict BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMPTZ,
      last_activity_at TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_owner_group_registry_status ON owner_group_registry(bot_status);
    CREATE INDEX IF NOT EXISTS idx_owner_group_registry_activity ON owner_group_registry(last_activity_at DESC);
    CREATE TABLE IF NOT EXISTS owner_group_audit(
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT,
      group_id BIGINT,
      action TEXT NOT NULL,
      old_state TEXT,
      new_state TEXT,
      result TEXT NOT NULL DEFAULT 'SUCCESS',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_owner_group_audit_group_time ON owner_group_audit(group_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_owner_group_audit_owner_time ON owner_group_audit(owner_id,created_at DESC);
  `);
}

function mapTelegramStatus(status:string):OwnerGroupStatus{
  if(status==="left"||status==="kicked") return "LEFT";
  if(status==="restricted") return "RESTRICTED";
  if(status==="administrator"||status==="member") return "ACTIVE";
  return "UNKNOWN";
}

export async function upsertOwnerGroupFromChat(
  db:Queryable,
  chat:{id:number;type:string;title?:string;username?:string},
  telegramStatus?:string,
){
  await ensureOwnerGroupSchema(db);
  const incoming=String(telegramStatus||"").trim();
  const mapped=incoming?mapTelegramStatus(incoming):"ACTIVE";
  await db.query(`
    INSERT INTO owner_group_registry(
      group_id,title,username,chat_type,bot_status,telegram_status,is_enabled,
      joined_at,last_sync_at,last_error_code,last_error_message,updated_at
    )
    VALUES($1,$2,$3,$4,$5,$6,TRUE,
      CASE WHEN $5='ACTIVE' THEN NOW() ELSE NULL END,
      NOW(),NULL,NULL,NOW())
    ON CONFLICT(group_id) DO UPDATE SET
      title=COALESCE(NULLIF(EXCLUDED.title,''),owner_group_registry.title),
      username=EXCLUDED.username,
      chat_type=EXCLUDED.chat_type,
      telegram_status=EXCLUDED.telegram_status,
      bot_status=CASE
        WHEN EXCLUDED.bot_status='LEFT' THEN 'LEFT'
        WHEN owner_group_registry.is_enabled=FALSE THEN 'DISABLED'
        ELSE EXCLUDED.bot_status
      END,
      joined_at=COALESCE(owner_group_registry.joined_at,EXCLUDED.joined_at),
      last_sync_at=NOW(),
      last_error_code=NULL,
      last_error_message=NULL,
      updated_at=NOW()
  `,[
    String(chat.id),String(chat.title||""),chat.username?String(chat.username):null,String(chat.type||"supergroup"),
    mapped,incoming||"unknown"
  ]);
}

export async function touchOwnerGroupActivity(db:Queryable,chat:{id:number;type:string;title?:string;username?:string}){
  await ensureOwnerGroupSchema(db);
  await db.query(`
    INSERT INTO owner_group_registry(group_id,title,username,chat_type,bot_status,is_enabled,last_activity_at,last_sync_at)
    VALUES($1,$2,$3,$4,'ACTIVE',TRUE,NOW(),NOW())
    ON CONFLICT(group_id) DO UPDATE SET
      title=COALESCE(NULLIF(EXCLUDED.title,''),owner_group_registry.title),
      username=EXCLUDED.username,
      chat_type=EXCLUDED.chat_type,
      last_activity_at=NOW(),
      updated_at=NOW()
  `,[String(chat.id),String(chat.title||""),chat.username?String(chat.username):null,String(chat.type||"supergroup")]);
}

async function audit(db:Queryable,ownerId:number|undefined,groupId:number,action:string,oldState:string|null,newState:string|null,result:string,details:Record<string,unknown>={}){
  await db.query(
    "INSERT INTO owner_group_audit(owner_id,group_id,action,old_state,new_state,result,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [ownerId??null,groupId,action,oldState,newState,result,JSON.stringify(details)],
  );
}

export async function auditOwnerGroup(db:Queryable,ownerId:number|undefined,groupId:number,action:string,details:Record<string,unknown>={}){
  await ensureOwnerGroupSchema(db);
  await audit(db,ownerId,groupId,action,null,null,"SUCCESS",details);
}

function licenseFor(row:any){
  return {
    id: row.license_id==null ? null : Number(row.license_id),
    type: row.license_type ? String(row.license_type) : null,
    status: row.license_status ? String(row.license_status) : null,
    expiresAt: row.license_expires_at ? new Date(row.license_expires_at).toISOString() : null,
  };
}

export async function getOwnerGroup(db:Queryable,groupId:number,refresh=true){
  await ensureOwnerGroupSchema(db);
  if(refresh) await syncOwnerGroup(db,groupId);
  const group=(await rows<any>(db,`
    SELECT g.*,
      l.id AS license_id,l.subscription_type AS license_type,l.status AS license_status,l.expires_at AS license_expires_at
    FROM owner_group_registry g
    LEFT JOIN LATERAL (
      SELECT id,subscription_type,status,expires_at
      FROM bot_group_subscriptions
      WHERE group_id=g.group_id
      ORDER BY CASE WHEN status IN ('ACTIVE','EXPIRING','LIFETIME') THEN 0 ELSE 1 END,id DESC
      LIMIT 1
    ) l ON TRUE
    WHERE g.group_id=$1
    LIMIT 1
  `,[groupId]))[0];
  if(!group)return null;
  return {...group,group_id:Number(group.group_id),member_count:Number(group.member_count||0),admin_count:Number(group.admin_count||0),license:licenseFor(group)};
}

export async function listOwnerGroups(db:Queryable,options:{status?:string;search?:string;limit?:number;offset?:number}={}){
  await ensureOwnerGroupSchema(db);
  const limit=Math.min(100,Math.max(1,Number(options.limit||30)));
  const offset=Math.max(0,Number(options.offset||0));
  const params:any[]=[];
  const where:string[]=[];
  if(options.status && ["ACTIVE","DISABLED","RESTRICTED","ERROR","LEFT"].includes(options.status)){
    params.push(options.status);where.push(`g.bot_status=$${params.length}`);
  }
  if(options.search?.trim()){
    params.push("%"+options.search.trim()+"%");
    where.push(`(g.title ILIKE $${params.length} OR CAST(g.group_id AS TEXT) ILIKE $${params.length} OR COALESCE(g.username,'') ILIKE $${params.length})`);
  }
  const count=(await rows<{n:number}>(db,`SELECT COUNT(*)::int AS n FROM owner_group_registry g ${where.length?"WHERE "+where.join(" AND "):""}`,params))[0]?.n??0;
  params.push(limit,offset);
  const data=await rows<any>(db,`
    SELECT g.*,
      l.subscription_type AS license_type,l.status AS license_status,l.expires_at AS license_expires_at
    FROM owner_group_registry g
    LEFT JOIN LATERAL (
      SELECT subscription_type,status,expires_at
      FROM bot_group_subscriptions
      WHERE group_id=g.group_id
      ORDER BY CASE WHEN status IN ('ACTIVE','EXPIRING','LIFETIME') THEN 0 ELSE 1 END,id DESC
      LIMIT 1
    ) l ON TRUE
    ${where.length?"WHERE "+where.join(" AND "):""}
    ORDER BY
      CASE g.bot_status WHEN 'ERROR' THEN 0 WHEN 'ACTIVE' THEN 1 WHEN 'RESTRICTED' THEN 2 WHEN 'DISABLED' THEN 3 WHEN 'LEFT' THEN 4 ELSE 5 END,
      COALESCE(g.last_activity_at,g.updated_at) DESC
    LIMIT $${params.length-1} OFFSET $${params.length}
  `,params);
  return {total:Number(count),rows:data.map((x:any)=>({...x,group_id:Number(x.group_id),member_count:Number(x.member_count||0),admin_count:Number(x.admin_count||0)}))};
}

export async function ownerGroupOverview(db:Queryable){
  await ensureOwnerGroupSchema(db);
  const r=(await rows<any>(db,`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE bot_status='ACTIVE')::int AS active,
      COUNT(*) FILTER(WHERE bot_status='DISABLED')::int AS disabled,
      COUNT(*) FILTER(WHERE bot_status='RESTRICTED')::int AS restricted,
      COUNT(*) FILTER(WHERE bot_status='ERROR')::int AS error,
      COUNT(*) FILTER(WHERE bot_status='LEFT')::int AS left_groups,
      COALESCE(AVG(member_count),0)::numeric(12,2) AS avg_members,
      COALESCE(SUM(member_count),0)::bigint AS total_members
    FROM owner_group_registry
  `))[0]??{};
  const heavy=await rows<any>(db,`
    SELECT g.group_id,g.title,g.member_count,g.last_activity_at,COALESCE(a.actions,0)::int AS actions
    FROM owner_group_registry g
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS actions
      FROM owner_group_audit x
      WHERE x.group_id=g.group_id AND x.action LIKE 'activity:%'
        AND x.created_at>=NOW()-INTERVAL '30 days'
    ) a ON TRUE
    WHERE g.bot_status<>'LEFT'
    ORDER BY a.actions DESC,g.member_count DESC
    LIMIT 5
  `);
  return {...r,avg_members:Number(r.avg_members||0),total_members:Number(r.total_members||0),heavy};
}

export async function syncOwnerGroup(db:Queryable,groupId:number){
  await ensureOwnerGroupSchema(db);
  const existing=(await rows<any>(db,"SELECT * FROM owner_group_registry WHERE group_id=$1 LIMIT 1",[groupId]))[0];
  const oldStatus=existing?.bot_status ?? null;
  await db.query("UPDATE owner_group_registry SET bot_status='SYNCING',updated_at=NOW() WHERE group_id=$1",[groupId]).catch(()=>{});
  try{
    const chat=await telegramApi<any>("getChat",{chat_id:groupId});
    if(!chat.ok||!chat.result)throw new Error(chat.description||"getChat failed");
    const me=await telegramApi<any>("getMe",{});
    if(!me.ok||!me.result?.id)throw new Error(me.description||"getMe failed");
    const member=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:me.result.id});
    if(!member.ok)throw new Error(member.description||"getChatMember failed");
    const status=String(member.result?.status||"");
    const mapped=mapTelegramStatus(status);
    let members=Number(existing?.member_count||0);
    let admins=Number(existing?.admin_count||0);
    let ownerName=existing?.owner_name??null;
    let ownerAdminCount=0;
    if(mapped!=="LEFT"){
      const mc=await telegramApi<any>("getChatMemberCount",{chat_id:groupId});
      if(mc.ok)members=Number(mc.result||0);
      const ad=await telegramApi<any>("getChatAdministrators",{chat_id:groupId});
      if(ad.ok&&Array.isArray(ad.result)){
        admins=ad.result.length;
        const owner=ad.result.find((x:any)=>x?.status==="creator")?.user;
        ownerName=owner?(owner.username?"@"+owner.username:[owner.first_name,owner.last_name].filter(Boolean).join(" ").trim()||String(owner.id)):ownerName;
        ownerAdminCount=admins;
      }
    }
    const canDelete=member.result?.can_delete_messages===true;
    const canRestrict=member.result?.can_restrict_members===true;
    const enabled=existing?.is_enabled!==false;
    const state:OwnerGroupStatus=mapped==="ACTIVE"?(enabled?"ACTIVE":"DISABLED"):mapped;
    await db.query(`
      INSERT INTO owner_group_registry(
        group_id,title,username,chat_type,bot_status,telegram_status,is_enabled,
        member_count,admin_count,owner_name,bot_can_delete,bot_can_restrict,
        joined_at,last_sync_at,last_error_code,last_error_message,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        CASE WHEN $5 IN ('ACTIVE','DISABLED','RESTRICTED') THEN COALESCE($13,NOW()) ELSE $13 END,
        NOW(),NULL,NULL,NOW())
      ON CONFLICT(group_id) DO UPDATE SET
        title=EXCLUDED.title,username=EXCLUDED.username,chat_type=EXCLUDED.chat_type,
        bot_status=EXCLUDED.bot_status,telegram_status=EXCLUDED.telegram_status,
        member_count=EXCLUDED.member_count,admin_count=EXCLUDED.admin_count,owner_name=EXCLUDED.owner_name,
        bot_can_delete=EXCLUDED.bot_can_delete,bot_can_restrict=EXCLUDED.bot_can_restrict,
        joined_at=COALESCE(owner_group_registry.joined_at,EXCLUDED.joined_at),
        last_sync_at=NOW(),last_error_code=NULL,last_error_message=NULL,updated_at=NOW()
    `,[
      groupId,String(chat.result.title||""),chat.result.username?String(chat.result.username):null,
      String(chat.result.type||"supergroup"),state,status,enabled,members,admins,ownerName,canDelete,canRestrict,
      existing?.joined_at??null
    ]);
    await audit(db,undefined,groupId,"sync",oldStatus,state,"SUCCESS",{telegramStatus:status,members,admins,ownerAdminCount});
    return getOwnerGroup(db,groupId,false);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const code=(error as any)?.code?String((error as any).code):"TELEGRAM_SYNC_ERROR";
    await db.query(
      "UPDATE owner_group_registry SET bot_status='ERROR',last_error_code=$2,last_error_message=$3,last_sync_at=NOW(),updated_at=NOW() WHERE group_id=$1",
      [groupId,code,message],
    ).catch(()=>{});
    await audit(db,undefined,groupId,"sync",oldStatus,"ERROR","FAILED",{code,message});
    throw error;
  }
}

export async function setOwnerGroupEnabled(db:Queryable,ownerId:number,groupId:number,enabled:boolean){
  await ensureOwnerGroupSchema(db);
  const current=(await rows<any>(db,"SELECT bot_status FROM owner_group_registry WHERE group_id=$1 LIMIT 1",[groupId]))[0];
  const old=String(current?.bot_status||"UNKNOWN");
  const next=enabled?"ACTIVE":"DISABLED";
  await db.query(
    "UPDATE owner_group_registry SET is_enabled=$2,bot_status=CASE WHEN telegram_status IN ('left','kicked') THEN 'LEFT' ELSE $3 END,updated_at=NOW() WHERE group_id=$1",
    [groupId,enabled,next],
  );
  await audit(db,ownerId,groupId,enabled?"enable":"disable",old,next,"SUCCESS",{});
  return getOwnerGroup(db,groupId,false);
}

export async function leaveOwnerGroup(db:Queryable,ownerId:number,groupId:number){
  await ensureOwnerGroupSchema(db);
  const old=(await rows<any>(db,"SELECT bot_status FROM owner_group_registry WHERE group_id=$1 LIMIT 1",[groupId]))[0]?.bot_status??"UNKNOWN";
  const r=await telegramApi("leaveChat",{chat_id:groupId});
  if(!r.ok){
    await audit(db,ownerId,groupId,"leave",String(old),"ERROR","FAILED",{error:r.description||"leaveChat failed"});
    throw new Error(r.description||"leaveChat failed");
  }
  await db.query(
    "UPDATE owner_group_registry SET bot_status='LEFT',telegram_status='left',is_enabled=FALSE,last_sync_at=NOW(),updated_at=NOW() WHERE group_id=$1",
    [groupId],
  );
  await db.query("UPDATE bot_customer_groups SET is_active=FALSE,last_seen_at=NOW() WHERE group_id=$1",[groupId]).catch(()=>{});
  await audit(db,ownerId,groupId,"leave",String(old),"LEFT","SUCCESS",{});
  return getOwnerGroup(db,groupId,false);
}

async function tableExists(db:Queryable,table:string){
  const r=await rows<{exists:boolean}>(db,"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists",[table]);
  return r[0]?.exists===true;
}

export async function resetOwnerGroup(db:Queryable,ownerId:number,groupId:number,scope:"config"|"locks"|"warnings"|"messages"|"management"|"full"="config"){
  await ensureOwnerGroupSchema(db);
  await db.query("UPDATE owner_group_registry SET bot_status='RESETTING',updated_at=NOW() WHERE group_id=$1",[groupId]);
  const targets:Record<string,string[]>={
    config:["bot_group_configs","bot_group_config"],
    locks:["content_lock_settings","content_lock_exceptions","content_lock_domains"],
    warnings:["warning_system_settings","warning_cases","warning_events","warning_penalties","warning_action_queue"],
    messages:["bot_group_welcome","bot_group_messages","bot_group_automations"],
    management:["bot_group_automations","bot_group_settings"],
    full:["bot_group_configs","bot_group_config","content_lock_settings","content_lock_exceptions","content_lock_domains","warning_system_settings","warning_cases","warning_events","warning_penalties","warning_action_queue","bot_group_welcome","bot_group_messages","bot_group_automations","bot_group_settings"],
  };
  const tables=[...new Set(targets[scope])];
  const resetTables:string[]=[];
  for(const table of tables){
    if(!(await tableExists(db,table)))continue;
    if(!["bot_group_configs","bot_group_config","content_lock_settings","content_lock_exceptions","content_lock_domains","warning_system_settings","warning_cases","warning_events","warning_penalties","warning_action_queue","bot_group_welcome","bot_group_messages","bot_group_automations","bot_group_settings"].includes(table))continue;
    await db.query(`DELETE FROM "${table}" WHERE group_id=$1`,[groupId]).catch(()=>{});
    resetTables.push(table);
  }
  await db.query("UPDATE owner_group_registry SET bot_status=CASE WHEN telegram_status IN ('left','kicked') THEN 'LEFT' WHEN is_enabled THEN 'ACTIVE' ELSE 'DISABLED' END,last_sync_at=NOW(),updated_at=NOW() WHERE group_id=$1",[groupId]);
  await audit(db,ownerId,groupId,"reset:"+scope,"RESETTING","ACTIVE","SUCCESS",{tables:resetTables});
  return {group:await getOwnerGroup(db,groupId,false),tables:resetTables};
}

export async function sendMessageToOwnerGroup(db:Queryable,ownerId:number,groupId:number,text:string){
  await ensureOwnerGroupSchema(db);
  const clean=String(text||"").trim();
  if(!clean)throw new Error("پیام خالی است.");
  if(clean.length>4000)throw new Error("پیام نباید بیشتر از ۴۰۰۰ نویسه باشد.");
  const r=await telegramApi<any>("sendMessage",{chat_id:groupId,text:clean});
  if(!r.ok){
    await audit(db,ownerId,groupId,"send_message",null,null,"FAILED",{error:r.description||"sendMessage failed"});
    throw new Error(r.description||"sendMessage failed");
  }
  await audit(db,ownerId,groupId,"send_message",null,null,"SUCCESS",{messageId:r.result?.message_id??null});
  return Number(r.result?.message_id||0);
}

export async function getOwnerGroupLogs(db:Queryable,groupId:number,limit=30){
  await ensureOwnerGroupSchema(db);
  return rows<any>(db,`
    SELECT id,owner_id,group_id,action,old_state,new_state,result,details,created_at
    FROM owner_group_audit
    WHERE group_id=$1
    ORDER BY id DESC
    LIMIT $2
  `,[groupId,Math.min(100,Math.max(1,limit))]);
}

export async function syncAllOwnerGroups(db:Queryable,limit=100){
  await ensureOwnerGroupSchema(db);
  const groups=await rows<{group_id:number}>(db,"SELECT group_id FROM owner_group_registry ORDER BY updated_at DESC LIMIT $1",[Math.min(200,Math.max(1,limit))]);
  let ok=0,failed=0;
  for(const g of groups){
    try{await syncOwnerGroup(db,Number(g.group_id));ok++;}catch{failed++;}
  }
  return {checked:groups.length,ok,failed};
}
