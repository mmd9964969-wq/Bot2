const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

let useSsl = false;
if (connectionString) {
  try {
    const hostname = new URL(connectionString).hostname;
    const isRailwayInternal = hostname.endsWith(".railway.internal");
    useSsl = process.env.NODE_ENV === "production" && !isRailwayInternal;
  } catch {
    useSsl = false;
  }
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    })
  : null;

async function query(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.query(text, params);
}

async function checkConnection() {
  if (!pool) {
    return {
      connected: false,
      configured: false,
      error: "DATABASE_URL is not configured",
    };
  }

  try {
    await pool.query("SELECT 1");
    return {
      connected: true,
      configured: true,
    };
  } catch (error) {
    return {
      connected: false,
      configured: true,
      error: error.message,
    };
  }
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
  }
}

module.exports = {
  pool,
  query,
  checkConnection,
  closeDatabase,
};
