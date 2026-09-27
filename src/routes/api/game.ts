import { Pool } from "pg";
import { createFileRoute } from "@tanstack/react-router";
import { miniAppAction, renderEngineSession, ensureEngineSchema, resolveAction, createMiniAppLaunchToken } from "@/lib/bot/game-engine";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

export const Route = createFileRoute("/api/game")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sessionId = Number(url.searchParams.get("session") || 0);
        if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
          return Response.json({ ok: false, error: "invalid_session" }, { status: 400 });
        }
        try {
          await ensureEngineSchema(pool);
          const session = (await pool.query<any>("SELECT id,group_id,game_code,status,mode,current_turn_user_id,turn_no,state FROM game_sessions WHERE id=$1",[sessionId])).rows[0];
          if (!session) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
          const players=(await pool.query<any>("SELECT sp.user_id,sp.slot,sp.score,COALESCE(p.display_name,p.first_name,p.username,p.user_id::text) name FROM game_session_players sp LEFT JOIN game_players p ON p.group_id=sp.group_id AND p.user_id=sp.user_id WHERE sp.session_id=$1 AND sp.left_at IS NULL ORDER BY sp.slot",[sessionId])).rows;
          return Response.json({
            ok:true,
            session:{
              id:Number(session.id), gameCode:String(session.game_code), status:String(session.status),
              mode:String(session.mode), currentTurnUserId:session.current_turn_user_id?Number(session.current_turn_user_id):null,
              turnNo:Number(session.turn_no||0), state:session.state||{}, players
            }
          });
        } catch {
          return Response.json({ ok:false,error:"server_error" },{status:500});
        }
      },
      POST: async ({ request }) => {
        try {
          const body=await request.json();
          const sessionId=Number(body?.sessionId||0);
          const action=String(body?.action||"move");
          const payload=String(body?.payload??"");
          const initData=String(body?.initData||"");
          const launchToken=String(body?.launchToken||"");
          if(!Number.isSafeInteger(sessionId)||sessionId<=0||(!initData&&!launchToken)) return Response.json({ok:false,error:"invalid_request"},{status:400});

          let view:any;
          if(initData){
            view=await miniAppAction(pool,sessionId,initData,String(process.env.BOT_TOKEN||""),action,payload);
          }else{
            const row=(await pool.query<any>(
              "SELECT group_id FROM game_sessions WHERE id=$1 AND status='active'",
              [sessionId]
            )).rows[0];
            if(!row) throw new Error("session_finished");

            const playerRows=(await pool.query<any>(
              "SELECT user_id FROM game_session_players WHERE session_id=$1 AND left_at IS NULL ORDER BY slot",
              [sessionId]
            )).rows;
            const botToken=String(process.env.BOT_TOKEN||"");
            const userId=playerRows
              .map((r:any)=>Number(r.user_id))
              .find((id:number)=>createMiniAppLaunchToken(sessionId,id,botToken)===launchToken);
            if(!userId) throw new Error("invalid_launch_token");

            const ctx:any={
              pool,
              chatId:Number(row.group_id),
              userId,
              user:{id:userId},
              isAdmin:false
            };
            await resolveAction(pool,ctx,sessionId,action,payload);
            view=await renderEngineSession(pool,ctx,sessionId);
          }
          const current=await pool.query<any>("SELECT id,group_id,game_code,status,mode,current_turn_user_id,turn_no,state FROM game_sessions WHERE id=$1",[sessionId]);
          const players=await pool.query<any>("SELECT sp.user_id,sp.slot,sp.score,sp.cups_delta,COALESCE(p.display_name,p.first_name,p.username,p.user_id::text) name FROM game_session_players sp LEFT JOIN game_players p ON p.group_id=sp.group_id AND p.user_id=sp.user_id WHERE sp.session_id=$1 AND sp.left_at IS NULL ORDER BY sp.slot",[sessionId]);
          const s=current.rows[0];
          return Response.json({
            ok:true, message:view?.text||null,
            session:s?{
              id:Number(s.id),gameCode:String(s.game_code),status:String(s.status),mode:String(s.mode),
              currentTurnUserId:s.current_turn_user_id?Number(s.current_turn_user_id):null,
              turnNo:Number(s.turn_no||0),state:s.state||{},players:players.rows
            }:null
          });
        } catch(error:any) {
          const code=String(error?.message||"game_error");
          const status=["invalid_telegram_init_data","not_participant","not_your_turn","session_finished"].includes(code)?403:400;
          return Response.json({ok:false,error:code},{status});
        }
      }
    }
  }
});
