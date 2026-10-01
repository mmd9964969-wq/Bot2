import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/verify.server";
import {
  ensureOwnerGroupSchema,
  listOwnerGroups,
  ownerGroupOverview,
  getOwnerGroup,
  getOwnerGroupLogs,
  setOwnerGroupEnabled,
  leaveOwnerGroup,
  resetOwnerGroup,
  sendMessageToOwnerGroup,
  syncAllOwnerGroups,
} from "@/lib/bot/owner-groups";

type ActionToken={userId:string;groupIds:number[];operation:string;scope?:string;expires:number};
const pending=new Map<string,ActionToken>();

function parseList(value:string|undefined){
  return new Set(String(value||"").split(",").map(x=>x.trim()).filter(Boolean));
}
function newToken(){return crypto.randomUUID();}
function webOwnerAllowed(user:{id:string;email:string|null}|null){
  const ids=parseList(process.env.OWNER_WEB_USER_IDS);
  const emails=new Set(Array.from(parseList(process.env.OWNER_WEB_EMAILS)).map(x=>x.toLowerCase()));
  if(user && (ids.has(String(user.id)) || (user.email && emails.has(user.email.toLowerCase())))) return true;
  return !process.env.DATABASE_URL && process.env.VITE_AUTH_ENABLED==="false" && user===null;
}
async function requireWebOwner(){
  const user=await getSessionUser().catch(()=>null);
  if(!webOwnerAllowed(user)){
    return {error:Response.json({ok:false,error:"owner_access_required"},{status:403}),user:null};
  }
  return {error:null,user};
}
function normalizeIds(value:unknown){
  return Array.isArray(value)?value.map(Number).filter(x=>Number.isSafeInteger(x)):[];
}
function armToken(userId:string,operation:string,groupIds:number[],scope?:string){
  const token=newToken();
  pending.set(token,{userId,operation,groupIds:Array.from(new Set(groupIds)),scope,expires:Date.now()+120000});
  return token;
}
function consumeToken(token:string,userId:string,operation:string,groupIds:number[],scope?:string){
  const x=pending.get(token);
  if(!x||x.expires<Date.now()){pending.delete(token);return false;}
  if(x.userId!==userId||x.operation!==operation||String(x.scope||"")!==String(scope||""))return false;
  const a=[...x.groupIds].sort((m,n)=>m-n).join(",");
  const b=[...groupIds].sort((m,n)=>m-n).join(",");
  if(a!==b)return false;
  pending.delete(token);
  return true;
}

export const Route=createFileRoute("/api/owner/groups")({
  server:{
    handlers:{
      GET:async({request})=>{
        try{
          const guard=await requireWebOwner();
          if(guard.error)return guard.error;
          const sql=await getSql();
          await ensureOwnerGroupSchema(sql);
          const url=new URL(request.url);
          const groupIdRaw=url.searchParams.get("groupId");
          const status=url.searchParams.get("status")||undefined;
          const search=url.searchParams.get("search")||undefined;
          const page=Math.max(1,Number(url.searchParams.get("page")||1));
          const limit=Math.min(50,Math.max(1,Number(url.searchParams.get("limit")||20)));
          if(groupIdRaw){
            const groupId=Number(groupIdRaw);
            if(!Number.isSafeInteger(groupId))return Response.json({ok:false,error:"invalid_group_id"},{status:400});
            const group=await getOwnerGroup(sql,groupId,true).catch(()=>getOwnerGroup(sql,groupId,false));
            const logs=await getOwnerGroupLogs(sql,groupId,30);
            return Response.json({ok:true,group,logs});
          }
          const overview=await ownerGroupOverview(sql);
          const list=await listOwnerGroups(sql,{status,search,limit,offset:(page-1)*limit});
          return Response.json({ok:true,overview,page,limit,...list});
        }catch(error){
          console.error("[owner-groups-api] GET failed",error);
          return Response.json({ok:false,error:error instanceof Error?error.message:"owner_groups_read_failed"},{status:500});
        }
      },
      POST:async({request})=>{
        try{
          const guard=await requireWebOwner();
          if(guard.error)return guard.error;
          const sql=await getSql();
          await ensureOwnerGroupSchema(sql);
          const body=await request.json() as Record<string,unknown>;
          const action=String(body.action||"");
          const ownerIdRaw=String(process.env.OWNER_WEB_TELEGRAM_ID||"");
          const ownerIdNumber=Number(ownerIdRaw);
          const ownerId=Number.isSafeInteger(ownerIdNumber)&&ownerIdNumber>0?ownerIdNumber:0;
          if(action==="sync"){
            return Response.json({ok:true,result:await syncAllOwnerGroups(sql,200)});
          }
          if(action==="send"){
            const groupId=Number(body.groupId);
            const text=String(body.text||"").trim();
            if(!Number.isSafeInteger(groupId)||!text)return Response.json({ok:false,error:"invalid_message"},{status:400});
            const messageId=await sendMessageToOwnerGroup(sql,ownerId,groupId,text);
            return Response.json({ok:true,messageId});
          }
          if(action==="enable"){
            const groupId=Number(body.groupId);
            if(!Number.isSafeInteger(groupId))return Response.json({ok:false,error:"invalid_group_id"},{status:400});
            const group=await setOwnerGroupEnabled(sql,ownerId,groupId,true);
            return Response.json({ok:true,group});
          }
          if(action==="group_refresh"){
            const groupId=Number(body.groupId);
            if(!Number.isSafeInteger(groupId))return Response.json({ok:false,error:"invalid_group_id"},{status:400});
            const group=await getOwnerGroup(sql,groupId,true);
            return Response.json({ok:true,group});
          }
          if(action==="confirm"){
            const groupIds=normalizeIds(body.groupIds);
            if(!groupIds.length&&body.groupId!==undefined)groupIds.push(Number(body.groupId));
            const operation=String(body.operation||"");
            const scope=String(body.scope||"");
            const valid=["disable","leave","reset","bulk_disable","bulk_leave","bulk_reset"];
            if(!groupIds.length||!valid.includes(operation))return Response.json({ok:false,error:"invalid_confirmation"},{status:400});
            const token=armToken(String(guard.user?.id||"dev-user"),operation,groupIds,scope);
            return Response.json({ok:true,stage:1,token,expiresInSeconds:120});
          }
          if(action==="execute"){
            const groupIds=normalizeIds(body.groupIds);
            if(!groupIds.length&&body.groupId!==undefined)groupIds.push(Number(body.groupId));
            const operation=String(body.operation||"");
            const scope=String(body.scope||"");
            const ok=consumeToken(String(body.token||""),String(guard.user?.id||"dev-user"),operation,groupIds,scope);
            if(!ok)return Response.json({ok:false,error:"confirmation_expired_or_invalid"},{status:409});
            const results:{groupId:number;ok:boolean;error?:string}[]=[];
            for(const groupId of groupIds){
              try{
                if(operation==="disable"||operation==="bulk_disable")await setOwnerGroupEnabled(sql,ownerId,groupId,false);
                else if(operation==="leave"||operation==="bulk_leave")await leaveOwnerGroup(sql,ownerId,groupId);
                else if(operation==="reset"||operation==="bulk_reset"){
                  const resetScope=scope as "config"|"locks"|"warnings"|"messages"|"management"|"full";
                  if(!["config","locks","warnings","messages","management","full"].includes(resetScope))throw new Error("invalid reset scope");
                  await resetOwnerGroup(sql,ownerId,groupId,resetScope);
                }else throw new Error("invalid operation");
                results.push({groupId,ok:true});
              }catch(error){
                results.push({groupId,ok:false,error:error instanceof Error?error.message:String(error)});
              }
            }
            return Response.json({ok:true,results});
          }
          return Response.json({ok:false,error:"unknown_action"},{status:400});
        }catch(error){
          console.error("[owner-groups-api] POST failed",error);
          return Response.json({ok:false,error:error instanceof Error?error.message:"owner_groups_action_failed"},{status:500});
        }
      }
    }
  }
});
