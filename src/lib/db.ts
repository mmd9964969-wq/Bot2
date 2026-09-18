import { pendingMigrations } from "../../scripts/migration-plan.mjs";

/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

const rawDatabaseUrl =
  typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;

const databaseUrl =
  rawDatabaseUrl && rawDatabaseUrl.trim()
    ? rawDatabaseUrl
    : undefined;

export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";

/**
 * Shared SQL interface used by both Neon and PGLite.
 */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;

  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<
    import("@electric-sql/pglite").PGlite
  >;
  __pgliteMigrateChain__?: Promise<void>;
};

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;

const identity = (value: string) => value;

type Run = <T>(
  text: string,
  params: unknown[],
) => Promise<T[]>;

/**
 * Convert a query runner into the shared Sql interface.
 */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];

    for (let i = 0; i < values.length; i += 1) {
      text += `$${i + 1}${strings[i + 1]}`;
    }

    return run<T>(text, values);
  }) as unknown as Sql;

  sql.query = <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) => run<T>(text, params);

  return sql;
}

/**
 * Create Neon / PostgreSQL SQL client.
 */
function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    const { Pool, types } = await import("pg");

    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);

    const pool = new Pool({
      connectionString: databaseUrl,
    });

    return toSql(async <T>(
      text: string,
      params: unknown[],
    ) => {
      const result = await pool.query(
        text,
        params,
      );

      return result.rows as T[];
    });
  })().catch((error) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw error;
  });

  return globalRef.__pgSqlPromise__;
}

/**
 * Convert a Vite glob path into a path relative to migrations/.
 *
 * Example:
 *
 * /migrations/0002_bot_config.sql
 *   -> 0002_bot_config.sql
 *
 * /migrations/auth/0001_auth.sql
 *   -> auth/0001_auth.sql
 */
function migrationPathFromGlob(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const prefix = "/migrations/";

  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }

  return normalized.replace(/^\/+/, "");
}

/**
 * Create PGLite SQL client.
 */
async function createPgliteSql(): Promise<Sql> {
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import(
      "@electric-sql/pglite"
    );

    const pg = new PGlite({
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });

    await pg.waitReady;

    await pg.exec(`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    return pg;
  })().catch((error) => {
    globalRef.__pgliteInstance__ = undefined;
    throw error;
  });

  const pg = await globalRef.__pgliteInstance__;

  /**
   * Recursively import all SQL migrations.
   *
   * This includes:
   *
   * migrations/*.sql
   * migrations/auth/*.sql
   * migrations/**/.../*.sql
   */
  const migrations = import.meta.glob(
    "/migrations/**/*.sql",
    {
      query: "?raw",
      import: "default",
      eager: true,
    },
  ) as Record<string, string>;

  const migrationEntries = Object.keys(
    migrations,
  ).map((path) =>
    migrationPathFromGlob(path),
  );

  /**
   * Apply pending migrations.
   */
  const migrate = async (): Promise<void> => {
    const doneRows = await pg.query<{
      name: string;
    }>(
      "select name from _migrations",
    );

    const done = doneRows.rows.map(
      (row) => row.name,
    );

    const pending = pendingMigrations(
      migrationEntries,
      done,
    );

    for (const {
      name,
      path,
    } of pending) {
      const globPath = `/migrations/${path}`;

      const sqlText = migrations[globPath];

      if (typeof sqlText !== "string") {
        throw new Error(
          `[db] Migration file not found: ${globPath}`,
        );
      }

      console.log(
        `[db] applying migration ${path}`,
      );

      await pg.transaction(async (tx) => {
        await tx.exec(sqlText);

        await tx.query(
          "insert into _migrations (name) values ($1)",
          [name],
        );
      });

      console.log(
        `[db] applied migration ${path}`,
      );
    }
  };

  /**
   * Serialize migration passes so concurrent callers
   * cannot apply the same migration twice.
   */
  const migrationChain = (
    globalRef.__pgliteMigrateChain__ ??
    Promise.resolve()
  )
    .catch(() => undefined)
    .then(migrate);

  globalRef.__pgliteMigrateChain__ =
    migrationChain;

  await migrationChain;

  return toSql(async <T>(
    text: string,
    params: unknown[],
  ) => {
    const result = await pg.query<T>(
      text,
      params,
    );

    return result.rows;
  });
}

/**
 * Create the active database client.
 */
let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a server route or server function, never from client code.",
    );
  }

  return dbSource === "neon"
    ? createNeonSql()
    : createPgliteSql();
}

/**
 * Get the shared server-only SQL client.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch(
    (error) => {
      sqlPromise = null;
      throw error;
    },
  );

  return sqlPromise;
}

/**
 * Get the shared PGLite instance.
 */
export async function getPglite(): Promise<
  import("@electric-sql/pglite").PGlite
> {
  if (dbSource !== "pglite") {
    throw new Error(
      "getPglite() is only available on the PGLite fallback (no DATABASE_URL)",
    );
  }

  await getSql();

  const pg =
    await globalRef.__pgliteInstance__;

  if (!pg) {
    throw new Error(
      "PGLite instance failed to initialize",
    );
  }

  return pg;
}

/**
 * Ensure database bootstrap is complete.
 */
export function ensureDbReady(): Promise<void> {
  if (dbSource !== "pglite") {
    return Promise.resolve();
  }

  return getSql().then(
    () => undefined,
  );
}

/**
 * Server-only eager PGLite bootstrap.
 */
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};

if (
  typeof window === "undefined" &&
  dbSource === "pglite"
) {
  globalBoot.__pgBootstrapPromise__ ??=
    ensureDbReady().catch((error) => {
      globalBoot.__pgBootstrapPromise__ =
        undefined;

      console.error(
        "[db] PGLite bootstrap failed:",
        error,
      );

      throw error;
    });
}
