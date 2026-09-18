#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Applies all pending SQL migrations from `../migrations`, including
 * migrations inside subdirectories such as `migrations/auth/`.
 *
 * Migration files are sorted by filename, so:
 *
 *   auth/0001_auth.sql
 *   0002_bot_config.sql
 *   0003_subscriptions_and_telegram_groups.sql
 *   0004_telegram_accounts.sql
 *   0005_telegram_link_tokens.sql
 *
 * are applied in the correct order.
 *
 * Each migration runs inside its own transaction and is recorded in
 * `_migrations`, so an already-applied migration will not run again.
 *
 * If DATABASE_URL is missing, the deploy-time migrator skips execution.
 * The local/PGLite fallback handles migrations separately.
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
 * Example:
 *
 * migrations/0002_bot_config.sql
 * migrations/auth/0001_auth.sql
 *
 * becomes:
 *
 * 0002_bot_config.sql
 * auth/0001_auth.sql
 */
async function findMigrationFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      const nested = await findMigrationFiles(fullPath);

      files.push(
        ...nested.map((file) =>
          relative(migrationsDir, file),
        ),
      );

      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".sql")) {
      files.push(relative(migrationsDir, fullPath));
    }
  }

  return files;
}

async function main() {
  let entries;

  try {
    entries = await findMigrationFiles(migrationsDir);
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

    let count = 0;

    for (const migration of migrations) {
      const { name, path } = migration;

      const migrationPath = join(
        migrationsDir,
        path,
      );

      const text = await readFile(
        migrationPath,
        "utf8",
      );

      console.log(
        `[migrate] applying ${path}`,
      );

      try {
        await client.query("BEGIN");

        // PostgreSQL executes the complete SQL migration.
        await client.query(text);

        await client.query(
          "INSERT INTO _migrations (name) VALUES ($1)",
          [name],
        );

        await client.query("COMMIT");

        console.log(
          `[migrate] applied ${path}`,
        );

        count += 1;
      } catch (err) {
        console.error(
          `[migrate] error applying ${path}`,
        );

        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original migration error.
        }

        throw err;
      }
    }

    if (count > 0) {
      console.log(
        `[migrate] done — ${count} migration(s) applied.`,
      );
    } else {
      console.log(
        "[migrate] up to date.",
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    "[migrate] failed:",
    err?.message || err,
  );

  for (const key of [
    "code",
    "detail",
    "hint",
    "position",
    "where",
  ]) {
    if (err?.[key] != null) {
      console.error(
        `[migrate]   ${key}: ${err[key]}`,
      );
    }
  }

  process.exit(1);
});
