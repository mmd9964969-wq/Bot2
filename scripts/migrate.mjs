#!/usr/bin/env node

/**
 * Deploy-time database migrator.
 *
 * Finds all SQL migrations recursively under ../migrations.
 *
 * Example:
 *
 *   migrations/
 *   ├── auth/
 *   │   └── 0001_auth.sql
 *   ├── 0002_bot_config.sql
 *   ├── 0003_subscriptions_and_telegram_groups.sql
 *   ├── 0004_telegram_accounts.sql
 *   └── 0005_telegram_link_tokens.sql
 *
 * Migration ordering is handled by migration-plan.mjs:
 *
 *   0001 -> 0002 -> 0003 -> 0004 -> 0005
 *
 * Each migration runs inside its own transaction and is recorded
 * in _migrations so it is never applied twice.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );

  process.exit(0);
}

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

/**
 * Recursively find all SQL migration files.
 *
 * Returned paths are relative to migrations/.
 *
 * Example:
 *
 *   auth/0001_auth.sql
 *   0002_bot_config.sql
 */
async function findMigrationFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    const fullPath = join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      files.push(
        ...(await findMigrationFiles(fullPath)),
      );

      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(".sql")
    ) {
      files.push(
        relative(
          migrationsDir,
          fullPath,
        ),
      );
    }
  }

  return files;
}

async function main() {
  let entries;

  try {
    entries = await findMigrationFiles(
      migrationsDir,
    );
  } catch {
    console.log(
      "[migrate] no migrations/ directory — nothing to do.",
    );

    return;
  }

  if (entries.length === 0) {
    console.log(
      "[migrate] no migrations — nothing to do.",
    );

    return;
  }

  console.log(
    `[migrate] found ${entries.length} migration file(s).`,
  );

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
  });

  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query(
      "SELECT name FROM _migrations",
    );

    const applied = appliedResult.rows.map(
      (row) => row.name,
    );

    const migrations = pendingMigrations(
      entries,
      applied,
    );

    if (migrations.length === 0) {
      console.log(
        "[migrate] up to date.",
      );

      return;
    }

    console.log(
      "[migrate] pending migrations:",
    );

    for (const migration of migrations) {
      console.log(
        `[migrate]   ${migration.path}`,
      );
    }

    let count = 0;

    for (const migration of migrations) {
      const { name, path } = migration;

      const migrationPath = join(
        migrationsDir,
        path,
      );

      const sql = await readFile(
        migrationPath,
        "utf8",
      );

      console.log(
        `[migrate] applying ${path}`,
      );

      try {
        await client.query("BEGIN");

        await client.query(sql);

        await client.query(
          "INSERT INTO _migrations (name) VALUES ($1)",
          [name],
        );

        await client.query("COMMIT");

        console.log(
          `[migrate] applied ${path}`,
        );

        count += 1;
      } catch (error) {
        console.error(
          `[migrate] error applying ${path}`,
        );

        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original migration error.
        }

        throw error;
      }
    }

    console.log(
      `[migrate] done — ${count} migration(s) applied.`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    "[migrate] failed:",
    error?.message || error,
  );

  for (const key of [
    "code",
    "detail",
    "hint",
    "position",
    "where",
  ]) {
    if (error?.[key] != null) {
      console.error(
        `[migrate]   ${key}: ${error[key]}`,
      );
    }
  }

  process.exit(1);
});
