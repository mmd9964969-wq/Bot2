import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";
import { telegramApi } from "../telegram/api.ts";

type PanelScope={userId:number;pool:Pool};

const scopeStorage=new AsyncLocalStorage<PanelScope>();
let schemaPromise:Promise<void>|null=null;
let cleanupStarted=false;

export function runWithPanelScope<T>(userId:number,pool:Pool,fn:()=>Promise<T>):Promise<T>{
  return scopeStorage.run({userId,pool},fn);
}

export function currentPanelScope():PanelScope|null{
  return scopeStorage.getStore()??null;
}

export async function ensurePanelSessionSchema(pool:Pool){
  if(!schemaPromise){
    schemaPromise=pool.query(`
      CREATE TABLE IF NOT EXISTS bot_panel_sessions (
        chat_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        panel_kind TEXT NOT NULL DEFAULT 'panel',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 minute'),
        PRIMARY KEY (chat_id,message_id)
      )
    `).then(async()=>{\n      await pool.query(\"UPDATE bot_panel_sessions SET expires_at=updated_at+INTERVAL '1 minute' WHERE expires_at>updated_at+INTERVAL '1 minute'\");\n    });
  }
  try{
    await schemaPromise;
    startPanelSessionCleanup(pool);
  }catch(error){
    schemaPromise=null;
    throw error;
  }
}

function startPanelSessionCleanup(pool:Pool){
  if(cleanupStarted)return;
  cleanupStarted=true;
  const timer=setInterval(async()=>{
    try{
      const r=await pool.query(
        `SELECT chat_id,message_id,panel_kind
           FROM bot_panel_sessions
          WHERE expires_at<=NOW()
          ORDER BY expires_at ASC
          LIMIT 100`,
      );
      for(const row of r.rows){
        const chatId=Number(row.chat_id);
        const messageId=Number(row.message_id);
        if(Number.isSafeInteger(chatId)&&Number.isSafeInteger(messageId)&&row.panel_kind!=="command"){
          await telegramApi("deleteMessage",{chat_id:chatId,message_id:messageId}).catch(()=>{});
        }
        await pool.query(
          "DELETE FROM bot_panel_sessions WHERE chat_id=$1 AND message_id=$2",
          [String(row.chat_id),String(row.message_id)],
        ).catch(()=>{});
      }
    }catch(error){
      console.error("[panel-session] cleanup failed",error);
    }
  },10000);
  timer.unref?.();
}

export async function bindPanelMessage(pool:Pool,chatId:number,messageId:number,userId:number,panelKind="panel"){
  await ensurePanelSessionSchema(pool);
  await pool.query(
    `INSERT INTO bot_panel_sessions(chat_id,message_id,user_id,panel_kind,created_at,updated_at,expires_at)
     VALUES($1,$2,$3,$4,NOW(),NOW(),NOW()+INTERVAL '1 minute')
     ON CONFLICT(chat_id,message_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,
       panel_kind=CASE WHEN bot_panel_sessions.panel_kind='command' THEN 'command' ELSE EXCLUDED.panel_kind END,
       updated_at=NOW(),
       expires_at=NOW()+INTERVAL '1 minute'`,
    [String(chatId),String(messageId),String(userId),panelKind],
  );
}

export async function touchPanelMessage(pool:Pool,chatId:number,messageId:number,userId:number){
  await ensurePanelSessionSchema(pool);
  const r=await pool.query(
    `UPDATE bot_panel_sessions
        SET updated_at=NOW(),expires_at=NOW()+INTERVAL '1 minute'
      WHERE chat_id=$1 AND message_id=$2 AND user_id=$3
      RETURNING message_id`,
    [String(chatId),String(messageId),String(userId)],
  );
  return !!r.rowCount;
}

export async function panelMessageOwnedBy(pool:Pool,chatId:number,messageId:number,userId:number){
  await ensurePanelSessionSchema(pool);
  const r=await pool.query(
    `SELECT 1
       FROM bot_panel_sessions
      WHERE chat_id=$1 AND message_id=$2 AND user_id=$3 AND expires_at>NOW()
      LIMIT 1`,
    [String(chatId),String(messageId),String(userId)],
  );
  return !!r.rowCount;
}

export async function unbindPanelMessage(pool:Pool,chatId:number,messageId:number,userId:number){
  await ensurePanelSessionSchema(pool);
  await pool.query(
    `DELETE FROM bot_panel_sessions WHERE chat_id=$1 AND message_id=$2 AND user_id=$3`,
    [String(chatId),String(messageId),String(userId)],
  );
}
