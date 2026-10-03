import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { telegramApi } from "../telegram/api.ts";

export type RegistrationStatus = "UNREGISTERED" | "REGISTERING" | "REGISTERED" | "DISABLED" | "ARCHIVED";
export type InstallationStatus = "NOT_INSTALLED" | "PENDING" | "INSTALLING" | "INSTALLED" | "FAILED" | "UNINSTALLING" | "UNINSTALLED";
export type BotMembershipStatus = "UNKNOWN" | "MEMBER" | "ADMINISTRATOR" | "RESTRICTED" | "LEFT" | "BANNED";
export type ServiceStatus = "UNKNOWN" | "ACTIVE" | "DEGRADED" | "PAUSED" | "STOPPED" | "BLOCKED";

type Db = Pool;
type GroupInputType = "USERNAME" | "PUBLIC_LINK" | "PRIVATE_INVITE" | "CHAT_ID" | "UNKNOWN";
const MODULES = ["security","commands","statistics","members","activity","tools"] as const;

function uuid(){ return crypto.randomUUID(); }
function sha256(value:string){ return crypto.createHash("sha256").update(value).digest(); }
function encodeCursor(value:{updatedAt:string;groupId:string}){ return Buffer.from(JSON.stringify(value),"utf8").toString("base64url"); }
function decodeCursor(value:string|null|undefined){
  if(!value) return null;
  try { const p=JSON.parse(Buffer.from(value,"base64url").toString("utf8")); if(!p?.updatedAt||!p?.groupId)return null; return {updatedAt:String(p.updatedAt),groupId:String(p.groupId)}; } catch { return null; }
}
function normalizeUsername(value:string){ return value.replace(/^@/,"").trim().toLowerCase(); }
function parseInput(raw:unknown){
  const value=String(raw??"").trim();
  if(!value)return {type:"UNKNOWN" as const,reference:null,fingerprint:sha256("")};
  const chatId=value.match(/^-100\d{5,}$/);
  if(chatId)return {type:"CHAT_ID" as const,reference:chatId[0],fingerprint:sha256(chatId[0])};
  const privateInvite=value.match(/^(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)\/?$/i);
  if(privateInvite){ const token=privateInvite[1]; return {type:"PRIVATE_INVITE" as const,reference:null,fingerprint:sha256("private-invite:"+token)}; }
  const publicLink=value.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,32})\/?$/i);
  if(publicLink){ const username=normalizeUsername(publicLink[1]); return {type:"PUBLIC_LINK" as const,reference:"@"+username,fingerprint:sha256("username:"+username)}; }
  if(/^@[A-Za-z0-9_]{5,32}$/.test(value)){ const username=normalizeUsername(value); return {type:"USERNAME" as const,reference:"@"+username,fingerprint:sha256("username:"+username)}; }
  if(/^[A-Za-z0-9_]{5,32}$/.test(value)){ const username=normalizeUsername(value); return {type:"USERNAME" as const,reference:"@"+username,fingerprint:sha256("username:"+username)}; }
  return {type:"UNKNOWN" as const,reference:null,fingerprint:sha256(value)};
}
function mapMemberStatus(status:string):BotMembershipStatus{
  if(status==="administrator")return "ADMINISTRATOR";
  if(status==="member")return "MEMBER";
  if(status==="restricted")return "RESTRICTED";
  if(status==="kicked")return "BANNED";
  if(status==="left")return "LEFT";
  return "UNKNOWN";
}
function deriveHealth(registration:RegistrationStatus,installation:InstallationStatus,bot:BotMembershipStatus,service:ServiceStatus,failed:boolean){
  if(registration==="ARCHIVED")return "ARCHIVED";
  if(registration!=="REGISTERED")return "UNAVAILABLE";
  if(bot==="LEFT"||bot==="BANNED")return "BLOCKED";
  if(installation!=="INSTALLED")return "NOT_READY";
  if(failed||service==="BLOCKED")return "BLOCKED";
  if(service==="DEGRADED")return "DEGRADED";
  if(service==="STOPPED")return "STOPPED";
  if(service==="ACTIVE")return "HEALTHY";
  return "DEGRADED";
}
async function tableExists(db:Db,name:string){ const r=await db.query<{exists:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists",[name]); return r.rows[0]?.exists===true; }
async function withTx<T>(db:Db,groupId:string|null,fn:(client:PoolClient)=>Promise<T>){ const client=await db.connect(); try{ await client.query("BEGIN"); if(groupId) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["gm-group:"+groupId]); const out=await fn(client); await client.query("COMMIT"); return out; }catch(e){ await client.query("ROLLBACK").catch(()=>{}); throw e; }finally{ client.release(); } }

export async function ensureGroupManagementCoreSchema(db:Db){
  const sqls:string[]=[
    "CREATE TABLE IF NOT EXISTS gm_groups(group_id UUID PRIMARY KEY,telegram_chat_id BIGINT NOT NULL UNIQUE,chat_type VARCHAR(20) NOT NULL,title TEXT NOT NULL,username VARCHAR(255),description TEXT,telegram_owner_id BIGINT,is_forum BOOLEAN NOT NULL DEFAULT FALSE,telegram_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_groups_chat_type_ck CHECK(chat_type IN ('group','supergroup')),CONSTRAINT gm_groups_title_ck CHECK(length(btrim(title))>0),CONSTRAINT gm_groups_metadata_ck CHECK(jsonb_typeof(telegram_metadata)='object'))",
    "CREATE UNIQUE INDEX IF NOT EXISTS gm_groups_username_uq ON gm_groups(username) WHERE username IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS gm_groups_updated_idx ON gm_groups(updated_at DESC,group_id DESC)",
    "CREATE TABLE IF NOT EXISTS gm_group_access(access_id UUID PRIMARY KEY,group_id UUID NOT NULL REFERENCES gm_groups(group_id) ON DELETE RESTRICT,telegram_user_id BIGINT NOT NULL,role VARCHAR(20) NOT NULL,capabilities_override JSONB NOT NULL DEFAULT '{}'::jsonb,granted_by_user_id BIGINT,granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),revoked_by_user_id BIGINT,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_group_access_role_ck CHECK(role IN ('OWNER','ADMIN','OPERATOR')),CONSTRAINT gm_group_access_override_ck CHECK(jsonb_typeof(capabilities_override)='object'),CONSTRAINT gm_group_access_revoked_ck CHECK(revoked_at IS NULL OR revoked_at>=granted_at))",
    "CREATE UNIQUE INDEX IF NOT EXISTS gm_group_access_active_uq ON gm_group_access(group_id,telegram_user_id) WHERE revoked_at IS NULL",
    "CREATE INDEX IF NOT EXISTS gm_group_access_user_idx ON gm_group_access(telegram_user_id)",
    "CREATE INDEX IF NOT EXISTS gm_group_access_group_role_idx ON gm_group_access(group_id,role)",
    "CREATE TABLE IF NOT EXISTS gm_group_registrations(registration_id UUID PRIMARY KEY,group_id UUID NOT NULL UNIQUE REFERENCES gm_groups(group_id) ON DELETE RESTRICT,status VARCHAR(20) NOT NULL DEFAULT 'UNREGISTERED',registered_by_user_id BIGINT,registered_at TIMESTAMPTZ,disabled_by_user_id BIGINT,disabled_at TIMESTAMPTZ,disable_reason TEXT,archived_at TIMESTAMPTZ,registration_version BIGINT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_registration_status_ck CHECK(status IN ('UNREGISTERED','REGISTERING','REGISTERED','DISABLED','ARCHIVED')),CONSTRAINT gm_registration_registered_at_ck CHECK(status<>'REGISTERED' OR registered_at IS NOT NULL),CONSTRAINT gm_registration_version_ck CHECK(registration_version>=1))",
    "CREATE INDEX IF NOT EXISTS gm_registrations_status_idx ON gm_group_registrations(status,updated_at DESC)",
    "CREATE TABLE IF NOT EXISTS gm_group_installations(installation_id UUID PRIMARY KEY,group_id UUID NOT NULL UNIQUE REFERENCES gm_groups(group_id) ON DELETE RESTRICT,status VARCHAR(20) NOT NULL DEFAULT 'NOT_INSTALLED',current_version INTEGER NOT NULL DEFAULT 0,target_version INTEGER,attempt_no INTEGER NOT NULL DEFAULT 0,started_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,failed_at TIMESTAMPTZ,failure_code VARCHAR(100),failure_message TEXT,installed_by_user_id BIGINT,config_version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_install_status_ck CHECK(status IN ('NOT_INSTALLED','PENDING','INSTALLING','INSTALLED','FAILED','UNINSTALLING','UNINSTALLED')),CONSTRAINT gm_install_version_ck CHECK(current_version>=0 AND (target_version IS NULL OR target_version>=1)),CONSTRAINT gm_install_attempt_ck CHECK(attempt_no>=0),CONSTRAINT gm_install_config_version_ck CHECK(config_version>=1))",
    "CREATE INDEX IF NOT EXISTS gm_installations_status_idx ON gm_group_installations(status,updated_at DESC)",
    "CREATE TABLE IF NOT EXISTS gm_group_runtime(runtime_id UUID PRIMARY KEY,group_id UUID NOT NULL UNIQUE REFERENCES gm_groups(group_id) ON DELETE RESTRICT,bot_membership_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',service_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',member_count INTEGER,admin_count INTEGER,last_message_at TIMESTAMPTZ,last_bot_activity_at TIMESTAMPTZ,last_admin_action_at TIMESTAMPTZ,last_security_event_at TIMESTAMPTZ,last_reconcile_at TIMESTAMPTZ,last_error_code VARCHAR(100),last_error_at TIMESTAMPTZ,runtime_revision BIGINT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_runtime_bot_ck CHECK(bot_membership_status IN ('UNKNOWN','MEMBER','ADMINISTRATOR','RESTRICTED','LEFT','BANNED')),CONSTRAINT gm_runtime_service_ck CHECK(service_status IN ('UNKNOWN','ACTIVE','DEGRADED','PAUSED','STOPPED','BLOCKED')),CONSTRAINT gm_runtime_counts_ck CHECK((member_count IS NULL OR member_count>=0) AND (admin_count IS NULL OR admin_count>=0)),CONSTRAINT gm_runtime_revision_ck CHECK(runtime_revision>=1))",
    "CREATE INDEX IF NOT EXISTS gm_runtime_bot_idx ON gm_group_runtime(bot_membership_status)",
    "CREATE INDEX IF NOT EXISTS gm_runtime_service_idx ON gm_group_runtime(service_status)",
    "CREATE TABLE IF NOT EXISTS gm_group_permission_snapshots(snapshot_id UUID PRIMARY KEY,group_id UUID NOT NULL REFERENCES gm_groups(group_id) ON DELETE RESTRICT,is_current BOOLEAN NOT NULL DEFAULT TRUE,membership_status VARCHAR(20) NOT NULL,is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,can_manage_chat BOOLEAN NOT NULL DEFAULT FALSE,can_delete_messages BOOLEAN NOT NULL DEFAULT FALSE,can_manage_video_chats BOOLEAN NOT NULL DEFAULT FALSE,can_restrict_members BOOLEAN NOT NULL DEFAULT FALSE,can_promote_members BOOLEAN NOT NULL DEFAULT FALSE,can_change_info BOOLEAN NOT NULL DEFAULT FALSE,can_invite_users BOOLEAN NOT NULL DEFAULT FALSE,can_post_stories BOOLEAN NOT NULL DEFAULT FALSE,can_edit_stories BOOLEAN NOT NULL DEFAULT FALSE,can_delete_stories BOOLEAN NOT NULL DEFAULT FALSE,can_pin_messages BOOLEAN NOT NULL DEFAULT FALSE,can_manage_topics BOOLEAN NOT NULL DEFAULT FALSE,can_manage_tags BOOLEAN NOT NULL DEFAULT FALSE,can_send_welcome_messages BOOLEAN NOT NULL DEFAULT FALSE,can_be_edited BOOLEAN NOT NULL DEFAULT FALSE,custom_title TEXT,rights_json JSONB NOT NULL DEFAULT '{}'::jsonb,captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),source VARCHAR(30) NOT NULL DEFAULT 'telegram',CONSTRAINT gm_permission_membership_ck CHECK(membership_status IN ('UNKNOWN','MEMBER','ADMINISTRATOR','RESTRICTED','LEFT','BANNED')),CONSTRAINT gm_permission_json_ck CHECK(jsonb_typeof(rights_json)='object'))",
    "CREATE UNIQUE INDEX IF NOT EXISTS gm_permission_current_uq ON gm_group_permission_snapshots(group_id) WHERE is_current=TRUE",
    "CREATE INDEX IF NOT EXISTS gm_permission_history_idx ON gm_group_permission_snapshots(group_id,captured_at DESC)",
    "CREATE TABLE IF NOT EXISTS gm_security_profiles(security_profile_id UUID PRIMARY KEY,profile_key VARCHAR(50) NOT NULL UNIQUE,display_name VARCHAR(100) NOT NULL,version INTEGER NOT NULL DEFAULT 1,config JSONB NOT NULL DEFAULT '{}'::jsonb,is_system BOOLEAN NOT NULL DEFAULT TRUE,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_by_user_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_security_profile_version_ck CHECK(version>=1),CONSTRAINT gm_security_profile_json_ck CHECK(jsonb_typeof(config)='object'))",
    "CREATE TABLE IF NOT EXISTS gm_settings_profiles(settings_profile_id UUID PRIMARY KEY,profile_key VARCHAR(50) NOT NULL UNIQUE,display_name VARCHAR(100) NOT NULL,version INTEGER NOT NULL DEFAULT 1,config JSONB NOT NULL DEFAULT '{}'::jsonb,is_system BOOLEAN NOT NULL DEFAULT TRUE,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_by_user_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_settings_profile_version_ck CHECK(version>=1),CONSTRAINT gm_settings_profile_json_ck CHECK(jsonb_typeof(config)='object'))",
    "CREATE TABLE IF NOT EXISTS gm_group_settings(group_settings_id UUID PRIMARY KEY,group_id UUID NOT NULL UNIQUE REFERENCES gm_groups(group_id) ON DELETE RESTRICT,settings_profile_id UUID NOT NULL REFERENCES gm_settings_profiles(settings_profile_id) ON DELETE RESTRICT,settings_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,config_version INTEGER NOT NULL DEFAULT 1,security_profile_key VARCHAR(50) NOT NULL DEFAULT 'default',updated_by_user_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_group_settings_json_ck CHECK(jsonb_typeof(settings_overrides)='object'),CONSTRAINT gm_group_settings_version_ck CHECK(config_version>=1))",
    "CREATE INDEX IF NOT EXISTS gm_group_settings_profile_idx ON gm_group_settings(settings_profile_id)",
    "CREATE TABLE IF NOT EXISTS gm_group_module_states(module_state_id UUID PRIMARY KEY,group_id UUID NOT NULL REFERENCES gm_groups(group_id) ON DELETE RESTRICT,module_key VARCHAR(50) NOT NULL,state VARCHAR(20) NOT NULL DEFAULT 'READY',enabled BOOLEAN NOT NULL DEFAULT FALSE,version INTEGER NOT NULL DEFAULT 1,config_version INTEGER NOT NULL DEFAULT 1,last_error_code VARCHAR(100),last_error_at TIMESTAMPTZ,updated_by_user_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_module_unique UNIQUE(group_id,module_key),CONSTRAINT gm_module_state_ck CHECK(state IN ('READY','ACTIVE','DEGRADED','DISABLED','FAILED')),CONSTRAINT gm_module_versions_ck CHECK(version>=1 AND config_version>=1))",
    "CREATE INDEX IF NOT EXISTS gm_module_group_idx ON gm_group_module_states(group_id,module_key)",
    "CREATE INDEX IF NOT EXISTS gm_module_active_idx ON gm_group_module_states(group_id,module_key) WHERE enabled=TRUE",
    "CREATE TABLE IF NOT EXISTS gm_group_resolution_attempts(resolution_id UUID PRIMARY KEY,request_id UUID NOT NULL UNIQUE,requester_user_id BIGINT NOT NULL,input_type VARCHAR(30) NOT NULL,normalized_reference TEXT,input_fingerprint BYTEA NOT NULL,resolved_group_id UUID REFERENCES gm_groups(group_id) ON DELETE RESTRICT,provider VARCHAR(40) NOT NULL,resolution_status VARCHAR(30) NOT NULL,access_state VARCHAR(30) NOT NULL,bot_status VARCHAR(30),registration_status VARCHAR(20),installation_status VARCHAR(20),next_action VARCHAR(30),failure_code VARCHAR(100),metadata JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ,CONSTRAINT gm_resolution_input_type_ck CHECK(input_type IN ('USERNAME','PUBLIC_LINK','PRIVATE_INVITE','CHAT_ID','UNKNOWN')),CONSTRAINT gm_resolution_status_ck CHECK(resolution_status IN ('RESOLVED','NOT_FOUND','INVALID','ACCESS_DENIED','UNSUPPORTED','ERROR','EXPIRED')),CONSTRAINT gm_resolution_access_ck CHECK(access_state IN ('UNKNOWN','ACCESSIBLE','INACCESSIBLE','JOIN_REQUIRED')),CONSTRAINT gm_resolution_next_action_ck CHECK(next_action IS NULL OR next_action IN ('MANAGE','REGISTER','REQUEST_ACCESS','UNAVAILABLE','NONE')),CONSTRAINT gm_resolution_json_ck CHECK(jsonb_typeof(metadata)='object'))",
    "CREATE INDEX IF NOT EXISTS gm_resolution_requester_idx ON gm_group_resolution_attempts(requester_user_id,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS gm_resolution_group_idx ON gm_group_resolution_attempts(resolved_group_id,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS gm_resolution_status_idx ON gm_group_resolution_attempts(resolution_status,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS gm_resolution_fingerprint_idx ON gm_group_resolution_attempts(input_fingerprint)",
    "CREATE TABLE IF NOT EXISTS gm_group_audit_log(audit_id UUID PRIMARY KEY,group_id UUID NOT NULL REFERENCES gm_groups(group_id) ON DELETE RESTRICT,request_id UUID,actor_type VARCHAR(20) NOT NULL,actor_user_id BIGINT,source VARCHAR(20) NOT NULL,action VARCHAR(100) NOT NULL,target_type VARCHAR(50),target_id TEXT,before_data JSONB,after_data JSONB,result VARCHAR(20) NOT NULL,error_code VARCHAR(100),reason TEXT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,ip_address INET,user_agent TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_audit_actor_ck CHECK(actor_type<>'USER' OR actor_user_id IS NOT NULL),CONSTRAINT gm_audit_result_ck CHECK(result IN ('SUCCESS','FAILURE','DENIED','NOOP')),CONSTRAINT gm_audit_before_ck CHECK(before_data IS NULL OR jsonb_typeof(before_data)='object'),CONSTRAINT gm_audit_after_ck CHECK(after_data IS NULL OR jsonb_typeof(after_data)='object'),CONSTRAINT gm_audit_metadata_ck CHECK(jsonb_typeof(metadata)='object'))",
    "CREATE INDEX IF NOT EXISTS gm_audit_group_time_idx ON gm_group_audit_log(group_id,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS gm_audit_actor_time_idx ON gm_group_audit_log(actor_user_id,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS gm_audit_action_time_idx ON gm_group_audit_log(action,created_at DESC)",
    "CREATE TABLE IF NOT EXISTS gm_domain_events(event_id UUID PRIMARY KEY,group_id UUID NOT NULL REFERENCES gm_groups(group_id) ON DELETE RESTRICT,event_type VARCHAR(100) NOT NULL,aggregate_version BIGINT NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',attempt_count INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt_at TIMESTAMPTZ,occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),published_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT gm_event_delivery_ck CHECK(delivery_status IN ('PENDING','PROCESSING','PUBLISHED','FAILED','DEAD')),CONSTRAINT gm_event_attempt_ck CHECK(attempt_count>=0),CONSTRAINT gm_event_version_ck CHECK(aggregate_version>=1),CONSTRAINT gm_event_payload_ck CHECK(jsonb_typeof(payload)='object'))",
    "CREATE INDEX IF NOT EXISTS gm_events_pending_idx ON gm_domain_events(next_attempt_at,created_at) WHERE delivery_status IN ('PENDING','FAILED')",
    "CREATE INDEX IF NOT EXISTS gm_events_group_version_idx ON gm_domain_events(group_id,aggregate_version)",
    "CREATE TABLE IF NOT EXISTS gm_idempotency_keys(idempotency_id UUID PRIMARY KEY,scope VARCHAR(50) NOT NULL,idempotency_key VARCHAR(255) NOT NULL,operation VARCHAR(100) NOT NULL,request_hash BYTEA NOT NULL,group_id UUID REFERENCES gm_groups(group_id) ON DELETE RESTRICT,actor_user_id BIGINT,status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',response_payload JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,CONSTRAINT gm_idempotency_status_ck CHECK(status IN ('PROCESSING','COMPLETED','FAILED','EXPIRED')),CONSTRAINT gm_idempotency_response_ck CHECK(response_payload IS NULL OR jsonb_typeof(response_payload)='object'),CONSTRAINT gm_idempotency_expiry_ck CHECK(expires_at IS NULL OR expires_at>=created_at))",
    "CREATE UNIQUE INDEX IF NOT EXISTS gm_idempotency_scope_key_uq ON gm_idempotency_keys(scope,idempotency_key)",
  ];
  for(const sql of sqls) await db.query(sql);
  const profiles=[["default","پیش‌فرض"],["community","اجتماعی"],["strict","سخت‌گیرانه"],["maximum_security","حداکثر امنیت"]];
  for(const [key,name] of profiles){
    await db.query("INSERT INTO gm_security_profiles(security_profile_id,profile_key,display_name,config) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(profile_key) DO NOTHING",[uuid(),key,name,JSON.stringify({profileKey:key})]);
    await db.query("INSERT INTO gm_settings_profiles(settings_profile_id,profile_key,display_name,config) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(profile_key) DO NOTHING",[uuid(),key,name,JSON.stringify({preset:key})]);
  }
  if(await tableExists(db,"owner_group_registry")){
    await db.query("INSERT INTO gm_groups(group_id,telegram_chat_id,chat_type,title,username,is_forum,first_seen_at,last_seen_at,created_at,updated_at) SELECT md5('gm:'||group_id::text)::uuid,group_id,CASE WHEN chat_type='group' THEN 'group' ELSE 'supergroup' END,COALESCE(NULLIF(title,''),'گروه بدون نام'),username,FALSE,COALESCE(created_at,NOW()),COALESCE(last_sync_at,updated_at,NOW()),COALESCE(created_at,NOW()),NOW() FROM owner_group_registry ON CONFLICT(telegram_chat_id) DO UPDATE SET title=EXCLUDED.title,username=EXCLUDED.username,updated_at=NOW()");
    await db.query("INSERT INTO gm_group_registrations(registration_id,group_id,status,registered_at,registration_version) SELECT md5('reg:'||g.telegram_chat_id::text)::uuid,g.group_id,'REGISTERED',COALESCE(r.created_at,NOW()),1 FROM gm_groups g JOIN owner_group_registry r ON r.group_id=g.telegram_chat_id ON CONFLICT(group_id) DO NOTHING");
    const hasLegacyInstall=await tableExists(db,"bot_group_installations");
    if(hasLegacyInstall) await db.query("INSERT INTO gm_group_installations(installation_id,group_id,status,current_version,completed_at,config_version) SELECT md5('inst:'||g.telegram_chat_id::text)::uuid,g.group_id,CASE WHEN bi.installed THEN 'INSTALLED' ELSE 'NOT_INSTALLED' END,CASE WHEN bi.installed THEN 1 ELSE 0 END,CASE WHEN bi.installed THEN COALESCE(bi.installed_at,NOW()) ELSE NULL END,1 FROM gm_groups g JOIN owner_group_registry r ON r.group_id=g.telegram_chat_id LEFT JOIN bot_group_installations bi ON bi.group_id=g.telegram_chat_id ON CONFLICT(group_id) DO NOTHING");
    else await db.query("INSERT INTO gm_group_installations(installation_id,group_id,status,current_version,config_version) SELECT md5('inst:'||g.telegram_chat_id::text)::uuid,g.group_id,'NOT_INSTALLED',0,1 FROM gm_groups g JOIN owner_group_registry r ON r.group_id=g.telegram_chat_id ON CONFLICT(group_id) DO NOTHING");
    await db.query("INSERT INTO gm_group_runtime(runtime_id,group_id,bot_membership_status,service_status,member_count,admin_count,last_message_at,last_reconcile_at,last_error_code) SELECT md5('run:'||g.telegram_chat_id::text)::uuid,g.group_id,CASE WHEN r.telegram_status IN ('administrator','admin') THEN 'ADMINISTRATOR' WHEN r.telegram_status='member' THEN 'MEMBER' WHEN r.telegram_status='restricted' THEN 'RESTRICTED' WHEN r.telegram_status IN ('kicked','banned') THEN 'BANNED' WHEN r.telegram_status='left' THEN 'LEFT' ELSE 'UNKNOWN' END,CASE WHEN r.telegram_status IN ('left','kicked','banned') OR r.is_enabled=FALSE THEN 'STOPPED' WHEN r.bot_status IN ('ERROR','RESTRICTED') THEN 'DEGRADED' ELSE 'ACTIVE' END,r.member_count,r.admin_count,r.last_activity_at,r.last_sync_at,r.last_error_code FROM gm_groups g JOIN owner_group_registry r ON r.group_id=g.telegram_chat_id ON CONFLICT(group_id) DO NOTHING");
    await db.query("INSERT INTO gm_group_permission_snapshots(snapshot_id,group_id,membership_status,can_delete_messages,can_restrict_members,captured_at) SELECT md5('perm:'||g.telegram_chat_id::text)::uuid,g.group_id,CASE WHEN r.telegram_status IN ('administrator','admin') THEN 'ADMINISTRATOR' WHEN r.telegram_status='member' THEN 'MEMBER' WHEN r.telegram_status='restricted' THEN 'RESTRICTED' WHEN r.telegram_status IN ('left','kicked','banned') THEN 'LEFT' ELSE 'UNKNOWN' END,r.bot_can_delete,r.bot_can_restrict,COALESCE(r.last_sync_at,NOW()) FROM gm_groups g JOIN owner_group_registry r ON r.group_id=g.telegram_chat_id ON CONFLICT DO NOTHING");
  }
  if(await tableExists(db,"bot_groups")){
    await db.query("INSERT INTO gm_groups(group_id,telegram_chat_id,chat_type,title,username,is_forum,created_at,updated_at) SELECT md5('gm:'||id::text)::uuid,id::bigint,CASE WHEN type='group' THEN 'group' ELSE 'supergroup' END,COALESCE(NULLIF(title,''),'گروه بدون نام'),username,FALSE,NOW(),NOW() FROM bot_groups ON CONFLICT(telegram_chat_id) DO UPDATE SET title=EXCLUDED.title,username=EXCLUDED.username,updated_at=NOW()");
  }
  for(const key of MODULES){
    await db.query("INSERT INTO gm_group_module_states(module_state_id,group_id,module_key,state,enabled) SELECT md5($1||':'||group_id::text)::uuid,group_id,$1,CASE WHEN i.status='INSTALLED' THEN 'ACTIVE' ELSE 'READY' END,CASE WHEN i.status='INSTALLED' THEN TRUE ELSE FALSE END FROM gm_group_installations i ON CONFLICT(group_id,module_key) DO NOTHING",[key]);
  }
  await db.query("INSERT INTO gm_group_settings(group_settings_id,group_id,settings_profile_id,security_profile_key) SELECT md5('settings:'||g.group_id::text)::uuid,g.group_id,sp.settings_profile_id,'default' FROM gm_groups g CROSS JOIN LATERAL (SELECT settings_profile_id FROM gm_settings_profiles WHERE profile_key='default' LIMIT 1) sp ON CONFLICT(group_id) DO NOTHING");
}

async function ensureGroupRecord(db:Db,chat:any){
  const chatId=Number(chat.id); if(!Number.isSafeInteger(chatId))throw new Error("شناسه Telegram گروه معتبر نیست.");
  const existing=await db.query<{group_id:string}>("SELECT group_id FROM gm_groups WHERE telegram_chat_id=$1 LIMIT 1",[chatId]);
  const groupId=existing.rows[0]?.group_id??uuid();
  await db.query("INSERT INTO gm_groups(group_id,telegram_chat_id,chat_type,title,username,description,is_forum,last_seen_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) ON CONFLICT(telegram_chat_id) DO UPDATE SET chat_type=EXCLUDED.chat_type,title=EXCLUDED.title,username=EXCLUDED.username,description=EXCLUDED.description,is_forum=EXCLUDED.is_forum,last_seen_at=NOW(),updated_at=NOW()",[groupId,chatId,chat.type==="group"?"group":"supergroup",String(chat.title||"گروه بدون نام"),chat.username||null,chat.description||null,chat.is_forum===true]);
  return String((await db.query<{group_id:string}>("SELECT group_id FROM gm_groups WHERE telegram_chat_id=$1 LIMIT 1",[chatId])).rows[0]?.group_id??groupId);
}
async function audit(db:Db,actor:number|null,groupId:string,action:string,result:"SUCCESS"|"FAILURE"|"DENIED"|"NOOP",beforeData?:any,afterData?:any,reason?:string){
  const actorType=actor==null?"SYSTEM":"USER";
  await db.query("INSERT INTO gm_group_audit_log(audit_id,group_id,actor_type,actor_user_id,source,action,before_data,after_data,result,reason) VALUES($1,$2,$3,$4,'TELEGRAM',$5,$6::jsonb,$7::jsonb,$8,$9)",[uuid(),groupId,actorType,actor,action,beforeData==null?null:JSON.stringify(beforeData),afterData==null?null:JSON.stringify(afterData),result,reason||null]).catch(()=>{});
}
async function event(db:Db,groupId:string,eventType:string,version:number,payload:any){ await db.query("INSERT INTO gm_domain_events(event_id,group_id,event_type,aggregate_version,payload) VALUES($1,$2,$3,$4,$5::jsonb)",[uuid(),groupId,eventType,version,JSON.stringify(payload??{})]).catch(()=>{}); }

export async function getGroup(db:Db,groupId:string){ await ensureGroupManagementCoreSchema(db); return (await db.query("SELECT * FROM gm_groups WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]??null; }
export async function getGroupOverview(db:Db,groupId:string){
  await ensureGroupManagementCoreSchema(db);
  const row=(await db.query("SELECT g.*,r.status AS registration_status,i.status AS installation_status,i.current_version,i.target_version,i.failure_code,i.failure_message,rt.bot_membership_status,rt.service_status,rt.member_count,rt.admin_count,rt.last_message_at,rt.last_bot_activity_at,rt.last_admin_action_at,rt.last_security_event_at,rt.last_reconcile_at,rt.last_error_code,rt.last_error_at,(SELECT COUNT(*)::int FROM gm_group_module_states m WHERE m.group_id=g.group_id AND m.state IN ('FAILED','DEGRADED')) AS failed_modules FROM gm_groups g LEFT JOIN gm_group_registrations r ON r.group_id=g.group_id LEFT JOIN gm_group_installations i ON i.group_id=g.group_id LEFT JOIN gm_group_runtime rt ON rt.group_id=g.group_id WHERE g.group_id=$1 LIMIT 1",[groupId])).rows[0];
  if(!row)return null;
  return {...row,health_status:deriveHealth(row.registration_status??"UNREGISTERED",row.installation_status??"NOT_INSTALLED",row.bot_membership_status??"UNKNOWN",row.service_status??"UNKNOWN",Number(row.failed_modules||0)>0),member_count:row.member_count==null?null:Number(row.member_count),admin_count:row.admin_count==null?null:Number(row.admin_count)};
}

export async function groupManagementOverview(db:Db){
  await ensureGroupManagementCoreSchema(db);
  const row=(await db.query("SELECT COUNT(*) FILTER(WHERE r.status='REGISTERED')::int AS total,COUNT(*) FILTER(WHERE r.status='REGISTERED' AND i.status='INSTALLED' AND rt.bot_membership_status='ADMINISTRATOR' AND rt.service_status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM gm_group_module_states m WHERE m.group_id=g.group_id AND m.state IN ('FAILED','DEGRADED')))::int AS active,COUNT(*) FILTER(WHERE r.status='REGISTERED' AND (i.status IS DISTINCT FROM 'INSTALLED' OR rt.bot_membership_status IN ('UNKNOWN','MEMBER','RESTRICTED','LEFT','BANNED') OR rt.service_status IN ('UNKNOWN','DEGRADED','PAUSED','STOPPED','BLOCKED') OR EXISTS(SELECT 1 FROM gm_group_module_states m WHERE m.group_id=g.group_id AND m.state IN ('FAILED','DEGRADED'))))::int AS needs_review,COUNT(*) FILTER(WHERE r.status='REGISTERED' AND rt.bot_membership_status IN ('LEFT','BANNED'))::int AS unavailable FROM gm_groups g LEFT JOIN gm_group_registrations r ON r.group_id=g.group_id LEFT JOIN gm_group_installations i ON i.group_id=g.group_id LEFT JOIN gm_group_runtime rt ON rt.group_id=g.group_id")).rows[0]||{};
  return {total:Number(row.total||0),active:Number(row.active||0),needsReview:Number(row.needs_review||0),unavailable:Number(row.unavailable||0)};
}

export async function listManagedGroups(db:Db,options:{cursor?:string|null;limit?:number}={}):Promise<{rows:any[];nextCursor:string|null}>{
  await ensureGroupManagementCoreSchema(db);
  const limit=Math.min(20,Math.max(1,Number(options.limit||8))); const cursor=decodeCursor(options.cursor);
  const params:any[]=[]; let where="r.status='REGISTERED'";
  if(cursor){ params.push(cursor.updatedAt,cursor.groupId); where+=" AND (g.updated_at,g.group_id)<($1::timestamptz,$2::uuid)"; }
  params.push(limit);
  const sql="SELECT g.group_id,g.telegram_chat_id,g.title,g.username,g.chat_type,g.updated_at,r.status AS registration_status,i.status AS installation_status,rt.bot_membership_status,rt.service_status,rt.member_count,rt.admin_count,(SELECT COUNT(*)::int FROM gm_group_module_states m WHERE m.group_id=g.group_id AND m.state IN ('FAILED','DEGRADED')) AS degraded_modules FROM gm_groups g JOIN gm_group_registrations r ON r.group_id=g.group_id LEFT JOIN gm_group_installations i ON i.group_id=g.group_id LEFT JOIN gm_group_runtime rt ON rt.group_id=g.group_id WHERE "+where+" ORDER BY g.updated_at DESC,g.group_id DESC LIMIT $"+params.length;
  const rows=(await db.query(sql,params)).rows.map((row:any)=>({...row,member_count:row.member_count==null?null:Number(row.member_count),admin_count:row.admin_count==null?null:Number(row.admin_count),health_status:deriveHealth(row.registration_status,row.installation_status||"NOT_INSTALLED",row.bot_membership_status||"UNKNOWN",row.service_status||"UNKNOWN",Number(row.degraded_modules||0)>0)}));
  const last=rows.at(-1); const nextCursor=rows.length===limit&&last?encodeCursor({updatedAt:new Date(last.updated_at).toISOString(),groupId:String(last.group_id)}):null;
  return {rows,nextCursor};
}
export async function getRuntimeState(db:Db,groupId:string){ await ensureGroupManagementCoreSchema(db); return (await db.query("SELECT * FROM gm_group_runtime WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]??null; }
export async function getPermissions(db:Db,groupId:string){ await ensureGroupManagementCoreSchema(db); return (await db.query("SELECT * FROM gm_group_permission_snapshots WHERE group_id=$1 AND is_current=TRUE LIMIT 1",[groupId])).rows[0]??null; }
export async function getModuleState(db:Db,groupId:string,moduleKey?:string){ await ensureGroupManagementCoreSchema(db); if(moduleKey)return (await db.query("SELECT * FROM gm_group_module_states WHERE group_id=$1 AND module_key=$2 LIMIT 1",[groupId,moduleKey])).rows[0]??null; return (await db.query("SELECT * FROM gm_group_module_states WHERE group_id=$1 ORDER BY module_key",[groupId])).rows; }

export async function inspectGroup(db:Db,groupId:string){
  await ensureGroupManagementCoreSchema(db);
  const group=await getGroup(db,groupId); if(!group)throw new Error("گروه در هسته مدیریت پیدا نشد.");
  const chatId=Number(group.telegram_chat_id);
  const chat=await telegramApi<any>("getChat",{chat_id:chatId}); if(!chat.ok||!chat.result)throw new Error(chat.description||"Telegram getChat failed");
  const me=await telegramApi<any>("getMe",{}); if(!me.ok||!me.result?.id)throw new Error(me.description||"Telegram getMe failed");
  const member=await telegramApi<any>("getChatMember",{chat_id:chatId,user_id:me.result.id}); if(!member.ok||!member.result)throw new Error(member.description||"Telegram getChatMember failed");
  const membership=mapMemberStatus(String(member.result.status||""));
  let memberCount=Number(group.member_count||0),adminCount=Number(group.admin_count||0);
  try{const c=await telegramApi<any>("getChatMemberCount",{chat_id:chatId});if(c.ok)memberCount=Number(c.result||0);}catch{}
  try{const a=await telegramApi<any>("getChatAdministrators",{chat_id:chatId});if(a.ok&&Array.isArray(a.result))adminCount=a.result.length;}catch{}
  const reg=(await db.query<{status:RegistrationStatus}>("SELECT status FROM gm_group_registrations WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]?.status??"UNREGISTERED";
  const inst=(await db.query<{status:InstallationStatus}>("SELECT status FROM gm_group_installations WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]?.status??"NOT_INSTALLED";
  let service:ServiceStatus="DEGRADED";
  if(reg==="ARCHIVED"||reg==="DISABLED"||membership==="LEFT"||membership==="BANNED")service="STOPPED";
  else if(inst==="INSTALLED"&&membership==="ADMINISTRATOR")service="ACTIVE";
  else if(inst==="INSTALLED")service="DEGRADED";
  else service="STOPPED";
  const rights=member.result;
  const snapshot={membership_status:membership,is_anonymous:rights.is_anonymous===true,can_manage_chat:rights.can_manage_chat===true,can_delete_messages:rights.can_delete_messages===true,can_manage_video_chats:rights.can_manage_video_chats===true,can_restrict_members:rights.can_restrict_members===true,can_promote_members:rights.can_promote_members===true,can_change_info:rights.can_change_info===true,can_invite_users:rights.can_invite_users===true,can_post_stories:rights.can_post_stories===true,can_edit_stories:rights.can_edit_stories===true,can_delete_stories:rights.can_delete_stories===true,can_pin_messages:rights.can_pin_messages===true,can_manage_topics:rights.can_manage_topics===true,can_manage_tags:rights.can_manage_tags===true,can_send_welcome_messages:rights.can_manage_chat===true,can_be_edited:rights.can_be_edited===true,custom_title:rights.custom_title||null,rights_json:rights};
  await withTx(db,groupId,async client=>{
    await client.query("UPDATE gm_groups SET title=$2,username=$3,description=$4,is_forum=$5,last_seen_at=NOW(),updated_at=NOW() WHERE group_id=$1",[groupId,String(chat.result.title||group.title),chat.result.username||null,chat.result.description||null,chat.result.is_forum===true]);
    await client.query("UPDATE gm_group_permission_snapshots SET is_current=FALSE WHERE group_id=$1 AND is_current=TRUE",[groupId]);
    await client.query("INSERT INTO gm_group_permission_snapshots(snapshot_id,group_id,is_current,membership_status,is_anonymous,can_manage_chat,can_delete_messages,can_manage_video_chats,can_restrict_members,can_promote_members,can_change_info,can_invite_users,can_post_stories,can_edit_stories,can_delete_stories,can_pin_messages,can_manage_topics,can_manage_tags,can_send_welcome_messages,can_be_edited,custom_title,rights_json,source) VALUES($1,$2,TRUE,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'telegram')",[uuid(),groupId,snapshot.membership_status,snapshot.is_anonymous,snapshot.can_manage_chat,snapshot.can_delete_messages,snapshot.can_manage_video_chats,snapshot.can_restrict_members,snapshot.can_promote_members,snapshot.can_change_info,snapshot.can_invite_users,snapshot.can_post_stories,snapshot.can_edit_stories,snapshot.can_delete_stories,snapshot.can_pin_messages,snapshot.can_manage_topics,snapshot.can_manage_tags,snapshot.can_send_welcome_messages,snapshot.can_be_edited,snapshot.custom_title,JSON.stringify(snapshot.rights_json)]);
    const old=(await client.query("SELECT * FROM gm_group_runtime WHERE group_id=$1 LIMIT 1",[groupId])).rows[0]; const revision=Number(old?.runtime_revision||0)+1;
    await client.query("INSERT INTO gm_group_runtime(runtime_id,group_id,bot_membership_status,service_status,member_count,admin_count,last_reconcile_at,runtime_revision,last_error_code,last_error_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW(),$7,NULL,NULL,NOW()) ON CONFLICT(group_id) DO UPDATE SET bot_membership_status=EXCLUDED.bot_membership_status,service_status=EXCLUDED.service_status,member_count=EXCLUDED.member_count,admin_count=EXCLUDED.admin_count,last_reconcile_at=NOW(),runtime_revision=EXCLUDED.runtime_revision,last_error_code=NULL,last_error_at=NULL,updated_at=NOW()",[uuid(),groupId,membership,service,memberCount,adminCount,revision]);
    await audit(client as any,null,groupId,"group_reconciled","SUCCESS",old??null,{membership,service,memberCount,adminCount});
    await event(client as any,groupId,"group.runtime.reconciled",revision,{membership,service,memberCount,adminCount});
  });
  return getGroupOverview(db,groupId);
}

export async function resolveGroupInput(db:Db,actorUserId:number,rawInput:unknown){
  await ensureGroupManagementCoreSchema(db);
  const p=parseInput(rawInput),requestId=uuid();
  const save=async(status:string,access:string,next:string,failure:string|null,groupId:string|null=null)=>db.query("INSERT INTO gm_group_resolution_attempts(resolution_id,request_id,requester_user_id,input_type,normalized_reference,input_fingerprint,resolved_group_id,provider,resolution_status,access_state,next_action,failure_code) VALUES($1,$2,$3,$4,$5,$6,$7,'telegram',$8,$9,$10,$11)",[uuid(),requestId,actorUserId,p.type,p.reference,p.fingerprint,groupId,status,access,next,failure]);
  if(p.type==="UNKNOWN"){await save("INVALID","UNKNOWN","UNAVAILABLE","INVALID_INPUT");return {inputType:p.type,normalizedReference:null,fingerprint:p.fingerprint,status:"INVALID",accessState:"UNKNOWN",nextAction:"UNAVAILABLE",message:"فرمت ورودی قابل شناسایی نیست."};}
  if(p.type==="PRIVATE_INVITE"){await save("UNSUPPORTED","JOIN_REQUIRED","REQUEST_ACCESS","PRIVATE_INVITE_JOIN_REQUIRED");return {inputType:p.type,normalizedReference:p.reference,fingerprint:p.fingerprint,status:"UNSUPPORTED",accessState:"JOIN_REQUIRED",nextAction:"REQUEST_ACCESS",message:"لینک خصوصی شناسایی شد، اما ربات از این مسیر امکان پیوستن خودکار ندارد. ابتدا دسترسی واقعی ربات به گروه برقرار شود."};}
  const chat=await telegramApi<any>("getChat",{chat_id:p.reference});
  if(!chat.ok||!chat.result){await save("NOT_FOUND","INACCESSIBLE","UNAVAILABLE","TELEGRAM_GET_CHAT_FAILED");return {inputType:p.type,normalizedReference:p.reference,fingerprint:p.fingerprint,status:"NOT_FOUND",accessState:"INACCESSIBLE",nextAction:"UNAVAILABLE",message:"گروه با این ورودی از مسیر Bot API قابل شناسایی نیست."};}
  if(!["group","supergroup"].includes(String(chat.result.type))){await save("INVALID","INACCESSIBLE","UNAVAILABLE","NOT_A_GROUP");return {inputType:p.type,normalizedReference:p.reference,fingerprint:p.fingerprint,status:"INVALID",accessState:"INACCESSIBLE",nextAction:"UNAVAILABLE",message:"مقصد شناسایی شد، اما یک گروه Telegram نیست."};}
  const groupId=await ensureGroupRecord(db,chat.result);
  let botStatus:BotMembershipStatus="UNKNOWN";
  let accessState:"UNKNOWN"|"ACCESSIBLE"|"INACCESSIBLE"|"JOIN_REQUIRED"="INACCESSIBLE";
  try{
    const me=await telegramApi<any>("getMe",{});
    if(me.ok&&me.result?.id){
      const member=await telegramApi<any>("getChatMember",{chat_id:Number(chat.result.id),user_id:me.result.id});
      if(member.ok&&member.result){
        botStatus=mapMemberStatus(String(member.result.status||""));
        accessState=botStatus==="LEFT"||botStatus==="BANNED"?"INACCESSIBLE":"ACCESSIBLE";
      }
    }
  }catch{}
  const overview=await getGroupOverview(db,groupId);
  if(botStatus==="UNKNOWN"&&overview?.bot_membership_status)botStatus=String(overview.bot_membership_status) as BotMembershipStatus;
  if(botStatus!=="UNKNOWN")accessState=botStatus==="LEFT"||botStatus==="BANNED"?"INACCESSIBLE":"ACCESSIBLE";
  const reg=overview?.registration_status??"UNREGISTERED",inst=overview?.installation_status??"NOT_INSTALLED";
  const accessible=accessState==="ACCESSIBLE";
  const next=reg==="REGISTERED"||reg==="ARCHIVED"?(accessible?"MANAGE":"REQUEST_ACCESS"):(accessible?"REGISTER":"REQUEST_ACCESS");
  await db.query("INSERT INTO gm_group_resolution_attempts(resolution_id,request_id,requester_user_id,input_type,normalized_reference,input_fingerprint,resolved_group_id,provider,resolution_status,access_state,next_action,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'telegram','RESOLVED',$8,$9,$10,$11::jsonb)",[uuid(),requestId,actorUserId,p.type,p.reference,p.fingerprint,groupId,accessState,next,JSON.stringify({title:String(chat.result.title||"گروه بدون نام"),username:chat.result.username||null,botStatus,registrationStatus:reg,installationStatus:inst})]);
  return {inputType:p.type,normalizedReference:p.reference,fingerprint:p.fingerprint,status:"RESOLVED",accessState,nextAction:next,registrationStatus:reg,installationStatus:inst,botStatus,group:{groupId,telegramChatId:Number(chat.result.id),title:String(chat.result.title||"گروه بدون نام"),username:chat.result.username||null,chatType:String(chat.result.type)}};
}

export async function registerGroup(db:Db,actorUserId:number,groupId:string){
  await ensureGroupManagementCoreSchema(db);
  const inspected=await inspectGroup(db,groupId);
  if(!inspected)throw new Error("گروه پیدا نشد.");
  if(["LEFT","BANNED"].includes(String(inspected.bot_membership_status)))throw new Error("ربات فعلاً به این گروه دسترسی ندارد.");
  const group=await getGroup(db,groupId); if(!group)throw new Error("گروه پیدا نشد.");
  return withTx(db,groupId,async client=>{
    const runtime=(await client.query("SELECT bot_membership_status FROM gm_group_runtime WHERE group_id=$1 LIMIT 1 FOR UPDATE",[groupId])).rows[0];
    if(["LEFT","BANNED"].includes(String(runtime?.bot_membership_status||"")))throw new Error("ربات فعلاً به این گروه دسترسی ندارد.");
    const cur=(await client.query("SELECT * FROM gm_group_registrations WHERE group_id=$1 LIMIT 1 FOR UPDATE",[groupId])).rows[0];
    if(cur?.status==="ARCHIVED")throw new Error("گروه آرشیو شده است؛ ابتدا بازیابی شود.");
    const previous=cur?.status??"UNREGISTERED";
    const registrationId=cur?.registration_id??uuid();
    await client.query("INSERT INTO gm_group_registrations(registration_id,group_id,status,registered_by_user_id,registration_version,updated_at) VALUES($1,$2,'REGISTERING',$3,COALESCE($4,1),NOW()) ON CONFLICT(group_id) DO UPDATE SET status='REGISTERING',registered_by_user_id=$3,updated_at=NOW()",[registrationId,groupId,actorUserId,cur?.registration_version??1]);
    await client.query("UPDATE gm_group_registrations SET status='REGISTERED',registered_at=COALESCE(registered_at,NOW()),disabled_by_user_id=NULL,disabled_at=NULL,archived_at=NULL,registration_version=registration_version+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await client.query("INSERT INTO gm_group_settings(group_settings_id,group_id,settings_profile_id,security_profile_key,updated_by_user_id) SELECT $1,$2,settings_profile_id,'default',$3 FROM gm_settings_profiles WHERE profile_key='default' LIMIT 1 ON CONFLICT(group_id) DO NOTHING",[uuid(),groupId,actorUserId]);
    for(const key of MODULES)await client.query("INSERT INTO gm_group_module_states(module_state_id,group_id,module_key,state,enabled,updated_by_user_id) VALUES($1,$2,$3,'READY',FALSE,$4) ON CONFLICT(group_id,module_key) DO NOTHING",[uuid(),groupId,key,actorUserId]);
    await client.query("INSERT INTO gm_group_installations(installation_id,group_id,status,current_version,target_version,attempt_no,config_version) VALUES($1,$2,'NOT_INSTALLED',0,1,0,1) ON CONFLICT(group_id) DO NOTHING",[uuid(),groupId]);
    await client.query("INSERT INTO gm_group_runtime(runtime_id,group_id,bot_membership_status,service_status,runtime_revision) VALUES($1,$2,'UNKNOWN','STOPPED',1) ON CONFLICT(group_id) DO NOTHING",[uuid(),groupId]);
    await client.query("INSERT INTO gm_group_access(access_id,group_id,telegram_user_id,role) VALUES($1,$2,$3,'OWNER') ON CONFLICT(group_id,telegram_user_id) WHERE revoked_at IS NULL DO NOTHING",[uuid(),groupId,actorUserId]).catch(async()=>{ await client.query("SELECT 1"); });
    await audit(client as any,actorUserId,groupId,"group_registered","SUCCESS",{status:previous},{status:"REGISTERED"});
    await event(client as any,groupId,"group.registration.completed",Number(cur?.registration_version||0)+1,{actorUserId});
    return getGroupOverview(client as any,groupId);
  });
}

export async function installGroup(db:Db,actorUserId:number,groupId:string){
  await ensureGroupManagementCoreSchema(db);
  const overview=await getGroupOverview(db,groupId); if(!overview)throw new Error("گروه پیدا نشد.");
  if(overview.registration_status!=="REGISTERED")throw new Error("گروه باید ابتدا ثبت شود.");
  if(["LEFT","BANNED"].includes(String(overview.bot_membership_status)))throw new Error("ربات به گروه دسترسی ندارد.");
  return withTx(db,groupId,async client=>{
    const current=(await client.query("SELECT * FROM gm_group_installations WHERE group_id=$1 LIMIT 1 FOR UPDATE",[groupId])).rows[0];
    if(!current)throw new Error("رکورد نصب گروه پیدا نشد.");
    if(["PENDING","INSTALLING"].includes(String(current.status))||current.status==="INSTALLED")return getGroupOverview(client as any,groupId);
    const legacyExists=await tableExists(db,"bot_group_installations");
    if(legacyExists){
      const legacy=(await client.query("SELECT installed,installation_version FROM bot_group_installations WHERE group_id=$1 LIMIT 1",[String(overview.telegram_chat_id)])).rows[0];
      if(legacy?.installed){
        await client.query("UPDATE gm_group_installations SET status='INSTALLED',current_version=1,target_version=1,completed_at=COALESCE(completed_at,NOW()),installed_by_user_id=$2,updated_at=NOW() WHERE group_id=$1",[groupId,actorUserId]);
        await client.query("UPDATE gm_group_module_states SET state='ACTIVE',enabled=TRUE,updated_by_user_id=$2,updated_at=NOW() WHERE group_id=$1",[groupId,actorUserId]);
        await client.query("UPDATE gm_group_runtime SET service_status=CASE WHEN bot_membership_status='ADMINISTRATOR' THEN 'ACTIVE' ELSE 'DEGRADED' END,runtime_revision=runtime_revision+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
        await audit(client as any,actorUserId,groupId,"group_installation_reconciled","SUCCESS",null,{status:"INSTALLED"});
        return getGroupOverview(client as any,groupId);
      }
    }
    await client.query("UPDATE gm_group_installations SET status='PENDING',target_version=1,attempt_no=attempt_no+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await audit(client as any,actorUserId,groupId,"group_installation_pending","NOOP",null,{status:"PENDING"},"Actual installation remains owned by the existing installation engine.");
    return getGroupOverview(client as any,groupId);
  });
}

export async function archiveGroup(db:Db,actorUserId:number,groupId:string){
  await ensureGroupManagementCoreSchema(db);
  return withTx(db,groupId,async client=>{
    const cur=(await client.query("SELECT * FROM gm_group_registrations WHERE group_id=$1 LIMIT 1 FOR UPDATE",[groupId])).rows[0]; if(!cur)throw new Error("رکورد ثبت گروه پیدا نشد.");
    if(cur.status==="ARCHIVED")return getGroupOverview(client as any,groupId);
    await client.query("UPDATE gm_group_registrations SET status='ARCHIVED',archived_at=NOW(),registration_version=registration_version+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await client.query("UPDATE gm_group_runtime SET service_status='STOPPED',runtime_revision=runtime_revision+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await client.query("UPDATE gm_group_module_states SET state='DISABLED',enabled=FALSE,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await audit(client as any,actorUserId,groupId,"group_archived","SUCCESS",{status:cur.status},{status:"ARCHIVED"});
    await event(client as any,groupId,"group.archive.completed",Number(cur.registration_version||1)+1,{actorUserId});
    return getGroupOverview(client as any,groupId);
  });
}
export async function restoreGroup(db:Db,actorUserId:number,groupId:string){
  await ensureGroupManagementCoreSchema(db);
  const inspected=await inspectGroup(db,groupId);
  if(!inspected)throw new Error("گروه پیدا نشد.");
  if(["LEFT","BANNED"].includes(String(inspected.bot_membership_status)))throw new Error("ربات هنوز به گروه دسترسی ندارد.");
  return withTx(db,groupId,async client=>{
    const cur=(await client.query("SELECT * FROM gm_group_registrations WHERE group_id=$1 LIMIT 1 FOR UPDATE",[groupId])).rows[0]; if(!cur)throw new Error("رکورد ثبت گروه پیدا نشد.");
    if(cur.status!=="ARCHIVED")return getGroupOverview(client as any,groupId);
    await client.query("UPDATE gm_group_registrations SET status='REGISTERED',archived_at=NULL,registration_version=registration_version+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await client.query("UPDATE gm_group_module_states SET state='READY',enabled=FALSE,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await client.query("UPDATE gm_group_runtime SET service_status='STOPPED',runtime_revision=runtime_revision+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
    await audit(client as any,actorUserId,groupId,"group_restored","SUCCESS",{status:"ARCHIVED"},{status:"REGISTERED"});
    await event(client as any,groupId,"group.restore.completed",Number(cur.registration_version||1)+1,{actorUserId});
    return getGroupOverview(client as any,groupId);
  });
}
export async function reconcileGroup(db:Db,groupId:string){ return inspectGroup(db,groupId); }
export async function resumeGroup(db:Db,actorUserId:number,groupId:string){
  const overview=await reconcileGroup(db,groupId); if(!overview)throw new Error("گروه پیدا نشد.");
  if(overview.registration_status==="ARCHIVED")throw new Error("گروه آرشیو شده است؛ ابتدا بازیابی شود.");
  if(["LEFT","BANNED"].includes(String(overview.bot_membership_status)))throw new Error("ربات هنوز به گروه دسترسی ندارد.");
  if(overview.installation_status!=="INSTALLED")throw new Error("نصب هسته هنوز کامل نیست.");
  await db.query("UPDATE gm_group_runtime SET service_status=CASE WHEN bot_membership_status='ADMINISTRATOR' THEN 'ACTIVE' ELSE 'DEGRADED' END,runtime_revision=runtime_revision+1,updated_at=NOW() WHERE group_id=$1",[groupId]);
  await audit(db,actorUserId,groupId,"group_resumed","SUCCESS",null,{service:"ACTIVE_OR_DEGRADED"});
  return getGroupOverview(db,groupId);
}
export function groupStatusLabel(value:string){ return value==="HEALTHY"?"● فعال":value==="DEGRADED"?"◐ نیازمند بررسی":value==="BLOCKED"?"✗ مسدود":value==="STOPPED"?"○ متوقف":value==="NOT_READY"?"■ آماده نصب":value==="ARCHIVED"?"■ آرشیو":"○ نامشخص"; }
export function botMembershipLabel(value:string){ return value==="ADMINISTRATOR"?"● مدیر":value==="MEMBER"?"○ عضو":value==="RESTRICTED"?"◐ محدود":value==="LEFT"?"✗ خارج‌شده":value==="BANNED"?"✗ مسدود":"■ نامشخص"; }
