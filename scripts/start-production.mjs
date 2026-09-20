import { spawn } from "node:child_process";

function run(command, args, env = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function waitForProcess(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(label + " stopped by " + signal));
      else resolve(code ?? 0);
    });
  });
}

async function main() {
  const migration = run("npm", ["run", "db:migrate"]);
  const migrationCode = await waitForProcess(migration, "database migration");
  if (migrationCode !== 0) process.exit(migrationCode);

  const port = process.env.PORT || "8080";
  const web = run("npm", ["run", "preview"], { PORT: port });
  const bot = run("node", ["--experimental-strip-types", "bot/main.ts"]);

  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    web.kill("SIGTERM");
    bot.kill("SIGTERM");
    setTimeout(() => process.exit(code), 1000).unref();
  };

  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));

  web.once("exit", (code, signal) => {
    if (!stopping && (signal || code !== 0)) {
      console.error("[production] web panel stopped");
      stop(code || 1);
    }
  });

  bot.once("exit", (code, signal) => {
    if (!stopping && (signal || code !== 0)) {
      console.error("[production] telegram bot stopped", signal || code);
      stop(code || 1);
    }
  });

  console.log("[production] web panel + telegram bot started");
}

main().catch((error) => {
  console.error("[production] startup failed:", error);
  process.exit(1);
});
