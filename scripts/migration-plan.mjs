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
 * Return pending migrations in deterministic order.
 *
 * Each migration keeps its relative path so migrations in different
 * directories cannot collide just because they have the same filename.
 *
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(
    [...applied].map((name) => migrationName(name)),
  );

  return [...paths]
    .filter(isMigrationFile)
    .map((path) => {
      const normalizedPath = migrationName(path);

      return {
        name: normalizedPath,
        path: normalizedPath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}
