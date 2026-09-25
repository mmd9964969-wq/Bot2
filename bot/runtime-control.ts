import http from "node:http";

let maintenance = false;
let runtimeSettings: Record<string, unknown> = {};

function authorized(req: http.IncomingMessage) {
  const expected = process.env.BOT_CORE_CONTROL_TOKEN ?? process.env.BOT_TOKEN ?? "";
  const supplied = String(req.headers["x-runtime-control-token"] ?? "");
  return Boolean(expected && supplied && supplied === expected);
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

let refreshStudioRef: (() => Promise<void>) | null = null;

export async function executeRuntimeAction(action:string){
  if(action==="health_check")return {success:true,action,status:"executed",maintenance};
  if(action==="reload_config"){
    if(!refreshStudioRef)throw new Error("Runtime control is not initialized");
    await refreshStudioRef();
    return {success:true,action,status:"executed"};
  }
  if(action==="maintenance_on"){maintenance=true;return {success:true,action,status:"executed",maintenance};}
  if(action==="maintenance_off"){maintenance=false;return {success:true,action,status:"executed",maintenance};}
  if(action==="restart_requested"){
    setTimeout(()=>process.kill(process.pid,"SIGTERM"),250);
    return {success:true,action,status:"accepted",restart:"requested"};
  }
  throw new Error("Invalid runtime action");
}

export function isRuntimeMaintenance() {
  return maintenance;
}

export function getRuntimeSettings() {
  return {...runtimeSettings};
}

export function startRuntimeControlServer(deps: {
  refreshStudio: () => Promise<void>;
}) {
  const port = Number(process.env.CONTROL_PORT || process.env.PORT || 3000);

  refreshStudioRef=deps.refreshStudio;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://runtime");

      if (url.pathname === "/" || url.pathname === "/internal/runtime/status") {
        if (url.pathname !== "/" && !authorized(req)) return json(res, 401, {error: "Unauthorized"});
        return json(res, 200, {
          status: "online",
          maintenance,
          uptime: Math.floor(process.uptime()),
          pid: process.pid,
          telegram: "polling",
          control: "connected",
          settings: runtimeSettings,
        });
      }

      if (!url.pathname.startsWith("/internal/runtime/")) {
        return json(res, 404, {error: "Not found"});
      }

      if (!authorized(req)) return json(res, 401, {error: "Unauthorized"});

      if (req.method === "PUT" && url.pathname === "/internal/runtime/settings") {
        runtimeSettings = await readBody(req);
        return json(res, 200, {success: true, settings: runtimeSettings});
      }

      if (req.method === "POST" && url.pathname === "/internal/runtime/action") {
        const body = await readBody(req);
        const action = String(body.action ?? "");
        try{
          const result=await executeRuntimeAction(action);
          return json(res,result.status==="accepted"?202:200,result);
        }catch(error){
          return json(res,400,{error:error instanceof Error?error.message:String(error)});
        }
      }

      return json(res, 404, {error: "Not found"});
    } catch (error) {
      return json(res, 500, {error: error instanceof Error ? error.message : String(error)});
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("[runtime-control] listening on " + port);
  });

  return server;
}
