const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
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
