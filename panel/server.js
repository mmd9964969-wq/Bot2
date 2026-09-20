const http = require("http");
const fs = require("fs");
const path = require("path");
const { checkConnection } = require("./backend/database");

const PORT = process.env.PORT || 3000;
const FRONTEND = path.join(__dirname, "frontend");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/health") {
      const database = await checkConnection();
      return send(res, 200, JSON.stringify({
        name: "PERSIAN BOT STUDIO",
        status: "online",
        phase: "02",
        language: ["fa", "en"],
        database,
        timestamp: new Date().toISOString()
      }));
    }

    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(FRONTEND, requestPath.replace(/^\/+/, "")));

    if (!filePath.startsWith(FRONTEND + path.sep)) {
      return send(res, 403, JSON.stringify({ error: "Forbidden" }));
    }

    fs.readFile(filePath, (error, data) => {
      if (error) return send(res, 404, JSON.stringify({ error: "Not found" }));
      send(res, 200, data, types[path.extname(filePath)] || "application/octet-stream");
    });
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }));
  }
}).listen(PORT, () => {
  console.log(`PERSIAN BOT STUDIO running on port ${PORT}`);
});
