const http = require("http");
const fs = require("fs");
const path = require("path");
const { checkConnection, query } = require("./backend/database");

const PORT = process.env.PORT || 3000;
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

http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,"http://localhost");

    if (url.pathname === "/api/health") {
      const database = await checkConnection();
      return send(res,200,JSON.stringify({
        name:"PERSIAN BOT STUDIO", status:"online", phase:"03",
        language:["fa","en"], database, timestamp:new Date().toISOString()
      }));
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
}).listen(PORT,() => console.log(`PERSIAN BOT STUDIO running on port ${PORT}`));
