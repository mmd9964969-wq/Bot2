import { spawn } from "node:child_process";

function run(command, args) {
  return spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  const bot = run("node", ["--experimental-strip-types", "bot/main.ts"]);

  let stopping = false;

  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    bot.kill("SIGTERM");
    setTimeout(() => process.exit(code), 1000).unref();
  };

  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));

  bot.once("exit", (code, signal) => {
    if (!stopping) {
      console.error("[production] telegram bot stopped", signal || code);
      stop(code || 1);
    }
  });

  console.log("[production] telegram bot started");
}

main().catch((error) => {
  console.error("[production] startup failed:", error);
  process.exit(1);
});
