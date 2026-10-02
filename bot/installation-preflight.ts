import type { Pool } from "pg";
import { createRequire } from "node:module";
import { telegramApi } from "../src/lib/telegram/api.ts";

export type PreflightStatus =
  | "CHECKING"
  | "READY"
  | "WARNING"
  | "MISSING"
  | "FAILED"
  | "SKIPPED"
  | "FIXABLE"
  | "ACTION_REQUIRED"
  | "BLOCKED";

export type PreflightOverall = "READY" | "BLOCKED";

export type PreflightCheck = {
  id: string;
  category: string;
  label: string;
  required: boolean;
  status: PreflightStatus;
  detail: string;
  action?: string;
  autoFixable?: boolean;
  autoFixed?: boolean;
};

export type PreflightReport = {
  operation: string;
  overall: PreflightOverall;
  checks: PreflightCheck[];
  relevantCount: number;
  checkedCount: number;
  warningCount: number;
  blockerCount: number;
  autoFixableCount: number;
  autoFixedCount: number;
  generatedAt: string;
};

export type RunInstallationPreflightOptions = {
  pool: Pool;
  chatId: number;
  actorId: number;
  operation: string;
  installed: boolean;
  version?: string | null;
  environment?: string | null;
  settings?: unknown;
  sessionConfirmed: boolean;
  autoFix?: boolean;
  ensureSchema: () => Promise<void>;
};

type CheckBuilder = Omit<PreflightCheck, "status"> & {
  run: () => Promise<Pick<PreflightCheck, "status" | "detail" | "action" | "autoFixable" | "autoFixed">>;
};

const require = createRequire(import.meta.url);

function ready(detail: string, extra: Partial<PreflightCheck> = {}) {
  return { status: "READY" as const, detail, ...extra };
}

function warning(detail: string, action?: string) {
  return {
    status: "WARNING" as const,
    detail,
    ...(action ? { action } : {}),
  };
}

function missing(detail: string, action?: string) {
  return {
    status: "MISSING" as const,
    detail,
    ...(action ? { action } : {}),
  };
}

function failed(detail: string, action?: string) {
  return {
    status: "FAILED" as const,
    detail,
    ...(action ? { action } : {}),
  };
}

function actionRequired(detail: string, action?: string) {
  return {
    status: "ACTION_REQUIRED" as const,
    detail,
    ...(action ? { action } : {}),
  };
}

function fixable(detail: string, action?: string) {
  return {
    status: "FIXABLE" as const,
    detail,
    autoFixable: true,
    ...(action ? { action } : {}),
  };
}

function skipped(detail: string) {
  return { status: "SKIPPED" as const, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMajorVersion(value: string | null | undefined) {
  const match = String(value ?? "").match(/^v?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function compareMajor(a: string, b: string) {
  const aa = parseMajorVersion(a);
  const bb = parseMajorVersion(b);
  if (aa === null || bb === null) return null;
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

function blockingStatus(status: PreflightStatus) {
  return ["MISSING", "FAILED", "FIXABLE", "ACTION_REQUIRED", "BLOCKED"].includes(status);
}

function operationUsesEnvironment(operation: string) {
  return ["install", "update", "repair", "reinstall"].includes(operation);
}

function operationUsesVersion(operation: string) {
  return ["install", "update", "repair", "reinstall"].includes(operation);
}

function operationNeedsConfirmation(operation: string) {
  return ["install", "update", "repair", "reinstall", "uninstall"].includes(operation);
}

async function runSafe(name: string, fn: () => Promise<any>) {
  try {
    return await fn();
  } catch (error) {
    const message = String((error as any)?.message ?? error ?? "خطای نامشخص");
    console.warn("[installation-preflight] " + name + " failed:", message);
    return null;
  }
}

export async function runInstallationPreflight(
  options: RunInstallationPreflightOptions,
): Promise<PreflightReport> {
  const {
    pool,
    chatId,
    operation,
    installed,
    version,
    environment,
    settings,
    sessionConfirmed,
    autoFix = false,
    ensureSchema,
  } = options;

  const checks: CheckBuilder[] = [
    {
      id: "environment",
      category: "محیط",
      label: "محیط اجرا",
      required: true,
      run: async () => {
        if (!operationUsesEnvironment(operation)) return skipped("برای این عملیات نیازی به محیط مقصد نیست.");

        const major = Number(String(process.versions.node).split(".")[0] || 0);
        if (major < 20) {
          return failed(
            "نسخهٔ Node.js این محیط برای اجرای استاندارد ربات کافی نیست.",
            "Node.js را به نسخهٔ ۲۰ یا بالاتر ارتقا دهید.",
          );
        }

        if (typeof fetch !== "function") {
          return failed(
            "API داخلی fetch در محیط اجرا در دسترس نیست.",
            "محیط اجرای Node.js را اصلاح کنید.",
          );
        }

        const selectedEnvironment = String(environment ?? "").trim();
        if (!["production", "staging", "development"].includes(selectedEnvironment)) {
          return actionRequired(
            "محیط مقصد معتبر انتخاب نشده است.",
            "از یکی از محیط‌های production، staging یا development استفاده کنید.",
          );
        }

        return ready("Node.js v" + process.versions.node + " و محیط " + selectedEnvironment + " آماده است.");
      },
    },
    {
      id: "dependencies",
      category: "وابستگی‌ها",
      label: "وابستگی‌های runtime",
      required: true,
      run: async () => {
        const requiredPackages = ["pg"];
        const missingPackages: string[] = [];

        for (const packageName of requiredPackages) {
          try {
            require.resolve(packageName);
          } catch {
            missingPackages.push(packageName);
          }
        }

        if (missingPackages.length) {
          return missing(
            "وابستگی‌های لازم پیدا نشد: " + missingPackages.join("، "),
            "وابستگی‌های پروژه را نصب یا بازیابی کنید.",
          );
        }

        return ready("وابستگی‌های اصلی runtime قابل دسترسی هستند.");
      },
    },
    {
      id: "permissions",
      category: "دسترسی",
      label: "دسترسی ربات در گروه",
      required: true,
      run: async () => {
        const me = await runSafe("getMe", () => telegramApi<any>("getMe", {}));
        const botId = Number(me?.result?.id ?? 0);
        if (!me?.ok || !botId) {
          return failed(
            "شناسهٔ ربات از Telegram دریافت نشد.",
            "اتصال ربات به Telegram را بررسی کنید.",
          );
        }

        const member = await runSafe("getChatMember", () =>
          telegramApi<any>("getChatMember", {
            chat_id: chatId,
            user_id: botId,
          }),
        );

        if (!member?.ok) {
          return actionRequired(
            "وضعیت عضویت ربات در گروه قابل دریافت نیست.",
            "ربات را در گروه بررسی و دوباره درخواست بررسی سیستم را اجرا کنید.",
          );
        }

        const status = String(member.result?.status ?? "");
        if (status === "creator") {
          return ready("ربات مالک گروه است و دسترسی پایهٔ مدیریت را دارد.");
        }

        if (status !== "administrator") {
          return missing(
            "ربات عضو مدیریتی گروه نیست.",
            "ربات را به‌عنوان مدیر گروه اضافه کنید.",
          );
        }

        const missingOptional: string[] = [];
        if (member.result?.can_delete_messages === false) missingOptional.push("حذف پیام");
        if (member.result?.can_restrict_members === false) missingOptional.push("محدودسازی اعضا");
        if (member.result?.can_invite_users === false) missingOptional.push("دعوت اعضا");

        if (missingOptional.length) {
          return warning(
            "ربات مدیر است، اما این دسترسی‌ها محدود هستند: " + missingOptional.join("، ") + ".",
            "دسترسی‌های مدیریتی موردنیاز قابلیت‌های فعال را تکمیل کنید.",
          );
        }

        return ready("ربات مدیر گروه است و دسترسی‌های پایهٔ مدیریت در دسترس هستند.");
      },
    },
    {
      id: "configuration",
      category: "پیکربندی",
      label: "پیکربندی سرویس",
      required: true,
      run: async () => {
        if (!String(process.env.BOT_TOKEN ?? "").trim()) {
          return missing("BOT_TOKEN تنظیم نشده است.", "BOT_TOKEN را در متغیرهای محیطی ثبت کنید.");
        }

        if (!String(process.env.DATABASE_URL ?? "").trim()) {
          return missing("DATABASE_URL تنظیم نشده است.", "اتصال PostgreSQL را در متغیرهای محیطی ثبت کنید.");
        }

        if (version && version !== "latest") {
          const normalized = String(version).trim().replace(/^v/i, "");
          if (!/^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
            return actionRequired("نسخهٔ انتخاب‌شده معتبر نیست.", "نسخه را دوباره انتخاب یا وارد کنید.");
          }
        }

        if (settings !== undefined && settings !== null && !isRecord(settings)) {
          return actionRequired("ساختار تنظیمات نشست معتبر نیست.", "تنظیمات را دوباره ثبت کنید.");
        }

        return ready("تنظیمات پایه و ورودی‌های نشست معتبر هستند.");
      },
    },
    {
      id: "connectivity",
      category: "اتصال",
      label: "اتصال به سرویس‌ها",
      required: true,
      run: async () => {
        const me = await runSafe("getMe", () => telegramApi<any>("getMe", {}));
        if (!me?.ok) {
          return failed(
            "اتصال به Telegram برقرار نشد.",
            "توکن ربات و دسترسی شبکهٔ سرویس را بررسی کنید.",
          );
        }

        const chat = await runSafe("getChat", () =>
          telegramApi<any>("getChat", {
            chat_id: chatId,
          }),
        );

        if (!chat?.ok) {
          return failed(
            "اتصال برقرار است، اما گروه از Telegram قابل دریافت نیست.",
            "عضویت ربات در گروه و دسترسی API را بررسی کنید.",
          );
        }

        return ready(
          "اتصال Telegram برقرار است و گروه «" +
            String(chat.result?.title ?? "بدون نام") +
            "» قابل دسترسی است.",
        );
      },
    },
    {
      id: "storage",
      category: "پایگاه داده",
      label: "پایگاه داده و ذخیره‌سازی",
      required: true,
      run: async () => {
        const ping = await runSafe("database-ping", () => pool.query("SELECT 1 AS ok"));
        if (!ping?.rows?.[0]?.ok) {
          return failed(
            "پایگاه داده پاسخ معتبر نداد.",
            "اتصال PostgreSQL و سلامت سرویس پایگاه داده را بررسی کنید.",
          );
        }

        const tables = [
          "bot_group_installations",
          "bot_installation_sessions",
          "bot_installation_events",
        ];

        const tableResult = await runSafe("database-tables", () =>
          pool.query(
            "SELECT t.name, to_regclass(t.name) AS regclass " +
              "FROM unnest($1::text[]) AS t(name)",
            [tables],
          ),
        );

        const missingTables = (tableResult?.rows ?? [])
          .filter((row: any) => !row.regclass)
          .map((row: any) => String(row.name));

        if (missingTables.length) {
          if (!autoFix) {
            return fixable(
              "ساختار ذخیره‌سازی ناقص است: " + missingTables.join("، "),
              "رفع خودکار ساختار پایگاه داده را اجرا کنید.",
            );
          }

          try {
            await ensureSchema();
            const verify = await pool.query(
              "SELECT to_regclass(name) AS regclass FROM unnest($1::text[]) AS t(name)",
              [tables],
            );
            const unresolved = verify.rows.filter((row: any) => !row.regclass);
            if (unresolved.length) {
              return failed(
                "ساختار پایگاه داده پس از اصلاح خودکار کامل نشد.",
                "ساختار PostgreSQL و مجوز CREATE را بررسی کنید.",
              );
            }

            return ready("ساختار پایگاه داده به‌صورت خودکار تکمیل شد.", {
              autoFixed: true,
            });
          } catch (error) {
            return failed(
              "اصلاح خودکار ساختار پایگاه داده ناموفق بود: " +
                String((error as any)?.message ?? error),
              "مجوز ایجاد جدول و سلامت PostgreSQL را بررسی کنید.",
            );
          }
        }

        return ready("پایگاه داده در دسترس است و جداول موردنیاز مرحلهٔ نصب وجود دارند.");
      },
    },
    {
      id: "version",
      category: "نسخه",
      label: "سازگاری نسخه",
      required: true,
      run: async () => {
        if (!operationUsesVersion(operation)) return skipped("برای این عملیات نسخهٔ مقصد بررسی نمی‌شود.");

        const selected = String(version ?? "latest").trim();
        const current = String(process.env.NIZAM_PANEL_VERSION || "v1.0.0").trim();

        if (!selected) {
          return actionRequired("نسخهٔ مقصد مشخص نشده است.", "نسخه را از مرحلهٔ انتخاب نسخه مشخص کنید.");
        }

        if (selected === "latest") {
          return ready("نسخهٔ مقصد روی آخرین نسخه تنظیم شده است.");
        }

        const relation = compareMajor(selected, current);
        if (relation === null) {
          return actionRequired("نسخهٔ مقصد قابل تحلیل نیست.", "نسخه را با قالب v1.2.3 وارد کنید.");
        }

        if (relation === 0) {
          return ready("نسخهٔ مقصد با شاخهٔ اصلی فعلی سازگار است.");
        }

        return warning(
          "نسخهٔ انتخاب‌شده خارج از شاخهٔ اصلی فعلی است و نیازمند بررسی سازگاری بیشتر است.",
          "در صورت استفاده از نسخهٔ خاص، سازگاری افزونه‌ها و تنظیمات را بررسی کنید.",
        );
      },
    },
    {
      id: "installation-state",
      category: "وضعیت نصب",
      label: "وضعیت فعلی نصب",
      required: true,
      run: async () => {
        const expectedInstalled = {
          install: false,
          update: true,
          repair: true,
          reinstall: true,
          uninstall: true,
          report: undefined,
        } as Record<string, boolean | undefined>;

        const expected = expectedInstalled[operation];
        if (operation === "report") {
          return ready(installed ? "گروه در حال حاضر نصب‌شده است." : "گروه هنوز نصب نشده است.");
        }

        if (expected === undefined) return skipped("نیاز عملیاتی تعریف نشده است.");

        if (expected !== installed) {
          return actionRequired(
            operation === "install"
              ? "گروه از قبل نصب شده و نصب اولیه روی آن مجاز نیست."
              : "این عملیات به نصب فعال نیاز دارد.",
            "وضعیت فعلی نصب را در مرکز مدیریت بررسی کنید.",
          );
        }

        return ready("وضعیت نصب با عملیات انتخاب‌شده سازگار است.");
      },
    },
    {
      id: "safety",
      category: "ایمنی",
      label: "کنترل ایمنی عملیات",
      required: true,
      run: async () => {
        if (!operationNeedsConfirmation(operation)) {
          return skipped("این عملیات تغییردهنده نیست.");
        }

        if (!sessionConfirmed) {
          return actionRequired(
            "تأیید نهایی عملیات هنوز ثبت نشده است.",
            "ابتدا خلاصهٔ عملیات را تأیید کنید.",
          );
        }

        if (operation === "uninstall") {
          return ready("تأیید حذف نصب ثبت شده و قبل از اجرا یک کنترل ایمنی دیگر لازم است.");
        }

        return ready("تأیید نهایی ثبت شده و اجرای عملیات هنوز شروع نشده است.");
      },
    },
  ];

  const results: PreflightCheck[] = [];
  for (const check of checks) {
    try {
      const result = await check.run();
      results.push({
        id: check.id,
        category: check.category,
        label: check.label,
        required: check.required,
        status: result.status,
        detail: result.detail,
        ...(result.action ? { action: result.action } : {}),
        ...(result.autoFixable ? { autoFixable: true } : {}),
        ...(result.autoFixed ? { autoFixed: true } : {}),
      });
    } catch (error) {
      results.push({
        id: check.id,
        category: check.category,
        label: check.label,
        required: check.required,
        status: "FAILED",
        detail: String((error as any)?.message ?? error ?? "خطای نامشخص در بررسی."),
        action: "جزئیات فنی را در لاگ سرویس بررسی کنید.",
      });
    }
  }

  const relevant = results.filter((item) => item.status !== "SKIPPED");
  const blockers = relevant.filter((item) => item.required && blockingStatus(item.status));
  const warnings = relevant.filter((item) => item.status === "WARNING");
  const fixables = relevant.filter((item) => item.autoFixable && item.status === "FIXABLE");
  const autoFixed = relevant.filter((item) => item.autoFixed);

  return {
    operation,
    overall: blockers.length ? "BLOCKED" : "READY",
    checks: results,
    relevantCount: relevant.length,
    checkedCount: relevant.filter((item) => item.status !== "CHECKING").length,
    warningCount: warnings.length,
    blockerCount: blockers.length,
    autoFixableCount: fixables.length,
    autoFixedCount: autoFixed.length,
    generatedAt: new Date().toISOString(),
  };
}

export function preflightStatusLabel(status: PreflightStatus) {
  const map: Record<PreflightStatus, string> = {
    CHECKING: "در حال بررسی",
    READY: "آماده",
    WARNING: "هشدار",
    MISSING: "ناقص",
    FAILED: "ناموفق",
    SKIPPED: "رد شده",
    FIXABLE: "قابل رفع خودکار",
    ACTION_REQUIRED: "نیازمند اقدام",
    BLOCKED: "مسدود",
  };
  return map[status];
}

export function preflightStatusSymbol(status: PreflightStatus) {
  const map: Record<PreflightStatus, string> = {
    CHECKING: "●",
    READY: "●",
    WARNING: "○",
    MISSING: "■",
    FAILED: "■",
    SKIPPED: "→",
    FIXABLE: "↗",
    ACTION_REQUIRED: "❯",
    BLOCKED: "■",
  };
  return map[status];
}
