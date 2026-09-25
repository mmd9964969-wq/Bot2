import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";

type PanelScope={userId:number;pool:Pool};

const scopeStorage=new AsyncLocalStorage<PanelScope>();
let schemaPromise:Promise<void>|null=null;

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
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
        PRIMARY KEY (chat_id,message_id)
      )
    `).then(()=>undefined);
  }
  try{
    await schemaPromise;
  }catch(error){
    schemaPromise=null;
    throw error;
  }
}

export async function bindPanelMessage(pool:Pool,chatId:number,messageId:number,userId:number,panelKind="panel"){
  await ensurePanelSessionSchema(pool);
  await pool.query(
    `INSERT INTO bot_panel_sessions(chat_id,message_id,user_id,panel_kind,created_at,updated_at,expires_at)
     VALUES($1,$2,$3,$4,NOW(),NOW(),NOW()+INTERVAL '30 minutes')
     ON CONFLICT(chat_id,message_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,
       panel_kind=EXCLUDED.panel_kind,
       updated_at=NOW(),
       expires_at=NOW()+INTERVAL '30 minutes'`,
    [String(chatId),String(messageId),String(userId),panelKind],
  );
}

export async function touchPanelMessage(pool:Pool,chatId:number,messageId:number,userId:number){
  await ensurePanelSessionSchema(pool);
  const r=await pool.query(
    `UPDATE bot_panel_sessions
        SET updated_at=NOW(),expires_at=NOW()+INTERVAL '30 minutes'
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
