// @ts-check

/**
 * Shared migration bookkeeping for:
 *
 *   scripts/migrate.mjs
 *   src/lib/db.ts
 *
 * Migration IDs are based on their path relative to `migrations/`.
 *
 * Examples:
 *
 *   0002_bot_config.sql
 *   auth/0001_auth.sql
 *
 * are stored separately in `_migrations`.
 */

/**
 * Normalize a migration path.
 *
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
}

/**
 * Check whether a path is a SQL migration file.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Extract the numeric migration order from a migration filename.
 *
 * Examples:
 *
 *   0001_auth.sql -> 1
 *   0002_bot_config.sql -> 2
 *   auth/0003_users.sql -> 3
 *
 * Migrations without a numeric prefix are placed after
 * numbered migrations.
 *
 * @param {string} path
 * @returns {number}
 */
export function migrationOrder(path) {
  const normalized = migrationName(path);
  const filename =
    normalized.split("/").pop() ?? normalized;

  const match = filename.match(/^(\d+)/);

  return match
    ? Number(match[1])
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Return pending migrations in deterministic order.
 *
 * Migrations are sorted by their numeric prefix first.
 *
 * Example:
 *
 *   auth/0001_auth.sql
 *   0002_bot_config.sql
 *   0003_subscriptions_and_telegram_groups.sql
 *   0004_telegram_accounts.sql
 *   0005_telegram_link_tokens.sql
 *
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(
    [...applied].map((name) =>
      migrationName(name),
    ),
  );

  return [...paths]
    .filter(isMigrationFile)
    .map((path) => {
      const normalizedPath =
        migrationName(path);

      return {
        name: normalizedPath,
        path: normalizedPath,
      };
    })
    .sort((a, b) => {
      const orderA =
        migrationOrder(a.path);

      const orderB =
        migrationOrder(b.path);

      return (
        orderA - orderB ||
        a.name.localeCompare(b.name)
      );
    })
    .filter(({ name }) => !done.has(name));
}
