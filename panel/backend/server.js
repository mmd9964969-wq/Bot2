const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
  });

  res.end(
    JSON.stringify({
      name: "PERSIAN BOT STUDIO",
      status: "online",
      phase: "01",
      language: ["fa", "en"],
    })
  );
});

server.listen(PORT, () => {
  console.log(`Persian Bot Studio API running on port ${PORT}`);
});
