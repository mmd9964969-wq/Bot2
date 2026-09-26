import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";

const cooldowns=new Map<string,number>();
const scheduleLocks=new Set<string>();

export const AUTOMATION_ACTIONS=["reply","delete","mute","kick"] as const;
export type AutomationAction=typeof AUTOMATION_ACTIONS[number];

export async function ensureAutomationSchema(pool:Pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS bot_group_automations(
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'keyword',
    trigger_value TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_payload TEXT NOT NULL DEFAULT '',
    cooldown_seconds INTEGER NOT NULL DEFAULT 10 CHECK(cooldown_seconds BETWEEN 0 AND 86400),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id,name)
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_bot_group_automations_runtime ON bot_group_automations(group_id,enabled,trigger_type)");
}

async function audit(pool:Pool,actorId:string,action:string,target:string,meta:Record<string,unknown>){
  await pool.query(
    "INSERT INTO audit_logs(actor_id,action,target,after_data,source) VALUES($1,$2,$3,$4::jsonb,'automation')",
    [actorId,action,target,JSON.stringify(meta)]
  ).catch(()=>{});
}

export async function runAutomations(pool:Pool,groupId:number,userId:number,firstName:string|undefined,textValue:string,messageId:number){
  const text=String(textValue||"").trim().toLowerCase();
  if(!text)return false;
  await ensureAutomationSchema(pool);
  const rows=await pool.query(
    "SELECT id,name,trigger_value,action_type,action_payload,cooldown_seconds FROM bot_group_automations WHERE group_id=$1 AND enabled=TRUE AND trigger_type='keyword' ORDER BY id",
    [groupId]
  );
  let acted=false;
  const member=await telegramApi<any>("getChatMember",{chat_id:groupId,user_id:userId});
  const protectedMember=member.ok&&["administrator","creator"].includes(String(member.result?.status||""));
  for(const row of rows.rows as any[]){
    const trigger=String(row.trigger_value||"").trim().toLowerCase();
    if(!trigger||!text.includes(trigger))continue;
    const key=`${groupId}:${userId}:${row.id}`;
    const cooldown=Math.max(0,Number(row.cooldown_seconds||0))*1000;
    const now=Date.now();
    if(cooldown&&now-(cooldowns.get(key)||0)<cooldown)continue;
    cooldowns.set(key,now);
    const action=String(row.action_type) as AutomationAction;
    let result:any={ok:false};
    if(action==="reply"){
      const rendered=String(row.action_payload||"").replace(/{{\s*user_name\s*}}/gi,firstName||String(userId));
      result=await telegramApi("sendMessage",{chat_id:groupId,text:rendered,reply_to_message_id:messageId});
    }else if(action==="delete"){
      result=protectedMember?{ok:false,description:"protected_member"}:await telegramApi("deleteMessage",{chat_id:groupId,message_id:messageId});
    }else if(action==="mute"){
      result=protectedMember?{ok:false,description:"protected_member"}:await telegramApi("restrictChatMember",{
        chat_id:groupId,user_id:userId,until_date:Math.floor(Date.now()/1000)+600,
        permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false},
        use_independent_chat_permissions:true
      });
    }else if(action==="kick"){
      result=protectedMember?{ok:false,description:"protected_member"}:await telegramApi("banChatMember",{chat_id:groupId,user_id:userId,until_date:Math.floor(Date.now()/1000)+60});
    }
    await audit(pool,String(userId),"automation_executed",String(row.id),{groupId,automationId:row.id,action,success:Boolean(result.ok),protectedMember});
    acted=acted||Boolean(result.ok);
  }
  return acted;
}

async function renderDailyReport(pool:Pool,sourceGroupId:number){
  const [events,warnings,locks,commands,schedules]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM supervision_events WHERE group_id=$1 AND created_at>=CURRENT_DATE",[sourceGroupId]).catch(()=>({rows:[{n:0}]})),
    pool.query("SELECT COUNT(*)::int n FROM warning_events WHERE group_id=$1 AND created_at>=CURRENT_DATE",[sourceGroupId]).catch(()=>({rows:[{n:0}]})),
    pool.query("SELECT COUNT(*)::int n FROM content_lock_logs WHERE group_id=$1 AND created_at>=CURRENT_DATE",[sourceGroupId]).catch(()=>({rows:[{n:0}]})),
    pool.query("SELECT COUNT(*)::int n FROM bot_group_commands WHERE group_id=$1 AND enabled=TRUE",[sourceGroupId]).catch(()=>({rows:[{n:0}]})),
    pool.query("SELECT COUNT(*)::int n FROM bot_schedules WHERE group_id=$1 AND enabled=TRUE",[sourceGroupId]).catch(()=>({rows:[{n:0}]}))
  ]);
  return [
    "◈ Pᴇʀsɪᴀɴ ᴮᵒᵗ · Dᴀɪʟʏ Rᴇᴘᴏʀᴛ",
    "",
    "─────━━───── ◈ ─────━━─────",
    "",
    "⛂ - رویدادهای امروز : "+Number(events.rows[0]?.n||0),
    "⛂ - اخطارهای امروز : "+Number(warnings.rows[0]?.n||0),
    "⛂ - تخلف‌های قفل محتوا : "+Number(locks.rows[0]?.n||0),
    "⛂ - دستورات فعال : "+Number(commands.rows[0]?.n||0),
    "⛂ - زمان‌بندی‌های فعال : "+Number(schedules.rows[0]?.n||0),
    "",
    "⛂ - زمان گزارش : "+new Date().toLocaleString("fa-IR")
  ].join("\n");
}

export async function tickSchedules(pool:Pool){
  const rows=await pool.query(
    "SELECT id,group_id,creator_id,message_text,send_at,repeat_seconds FROM bot_schedules WHERE enabled=TRUE AND send_at<=NOW() ORDER BY send_at LIMIT 20"
  );
  for(const row of rows.rows as any[]){
    const key=String(row.id);
    if(scheduleLocks.has(key))continue;
    scheduleLocks.add(key);
    try{
      const rawMessage=String(row.message_text||"");
      const reportMarker=rawMessage.match(/^__PERSIAN_BOT_DAILY_REPORT__:(-?\\d+)$/);
      const messageText=reportMarker?await renderDailyReport(pool,Number(reportMarker[1])):rawMessage;
      const result=await telegramApi("sendMessage",{chat_id:Number(row.group_id),text:messageText});
      if(Number(row.repeat_seconds||0)>0){
        let next=new Date(row.send_at).getTime()+Number(row.repeat_seconds)*1000;
        while(next<=Date.now())next+=Number(row.repeat_seconds)*1000;
        await pool.query("UPDATE bot_schedules SET send_at=$1 WHERE id=$2 AND enabled=TRUE",[new Date(next),row.id]);
      }else{
        await pool.query("UPDATE bot_schedules SET enabled=FALSE WHERE id=$1",[row.id]);
      }
      await audit(pool,String(row.creator_id),result.ok?"schedule_sent":"schedule_failed",String(row.id),{groupId:row.group_id,success:Boolean(result.ok)});
    }finally{
      scheduleLocks.delete(key);
    }
  }
}
