import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionInstallationSession,
  assertInstallationSessionTransition,
  isKnownInstallationCallback,
  installationOperationAllowed,
} from "../bot/installation-state.ts";

test("installation session state machine accepts valid transitions", () => {
  assert.equal(canTransitionInstallationSession("summary","collecting","confirmed","confirmed"), true);
  assert.equal(canTransitionInstallationSession("preflight","preflight_ready","executing","executing"), true);
  assert.equal(canTransitionInstallationSession("executing","executing","verifying","verifying"), true);
  assert.equal(canTransitionInstallationSession("verifying","verifying","completed","completed"), true);
});

test("installation session state machine rejects illegal transitions", () => {
  assert.equal(canTransitionInstallationSession("summary","collecting","completed","completed"), false);
  assert.throws(
    () => assertInstallationSessionTransition("summary","collecting","completed","completed"),
    (error) => (error as any).code === "INSTALLATION_SESSION_INVALID_TRANSITION",
  );
});

test("installation callback contract covers emitted callback families", () => {
  const exact = [
    "inst:operations",
    "inst:check",
    "inst:manage",
    "inst:health",
    "inst:confirm",
    "inst:preflight:continue",
    "inst:settings:standard",
  ];
  for (const value of exact) assert.equal(isKnownInstallationCallback(value), true);
  assert.equal(isKnownInstallationCallback("inst:op:update"), true);
  assert.equal(isKnownInstallationCallback("inst:type:quick:install"), true);
  assert.equal(isKnownInstallationCallback("inst:env:production"), true);
  assert.equal(isKnownInstallationCallback("inst:random:decorative"), false);
});

test("operation availability is server-side", () => {
  assert.equal(installationOperationAllowed("install", false), true);
  assert.equal(installationOperationAllowed("install", true), false);
  assert.equal(installationOperationAllowed("update", true), true);
  assert.equal(installationOperationAllowed("update", false), false);
  assert.equal(installationOperationAllowed("report", false), true);
});


test("installation UI emits only contract-approved callback data", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../bot/installation.ts", import.meta.url), "utf8");
  const callbacks = [
    ...[...source.matchAll(/callback_data:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
    ...[...source.matchAll(/button\(\s*["'`][^"'`]*["'`]\s*,\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
  ];
  const unique = [...new Set(callbacks)];
  assert.equal(unique.length > 0, true);
  for (const value of unique) {
    assert.equal(isKnownInstallationCallback(value), true, "unregistered callback: " + value);
  }
  assert.equal(source.includes('data === "inst:uninstall:confirm"'), false);
});


test("all five installation operations share one execution engine", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../bot/installation.ts", import.meta.url), "utf8");
  for (const operation of ["install","update","repair","reinstall","uninstall"]) {
    assert.equal(source.includes('"'+operation+'"'), true, "operation missing: "+operation);
  }
  assert.equal(
    source.includes("const operation = String(session.operation) as InstallationOperation;"),
    true,
  );
  assert.equal(
    source.includes("executeInstallationOperation("),
    true,
  );
  assert.equal(
    source.includes("executeInstallationOrchestration(client, {"),
    true,
  );
});

test("recovery transitions are explicitly permitted", () => {
  assert.equal(canTransitionInstallationSession("confirmed","confirmed","executing","executing"), true);
  assert.equal(canTransitionInstallationSession("preflight","checking","executing","executing"), true);
  assert.equal(canTransitionInstallationSession("failed","failed","preflight","checking"), true);
  assert.equal(canTransitionInstallationSession("completed","completed","preflight","checking"), true);
  assert.equal(canTransitionInstallationSession("completed","completed","executing","executing"), false);
});


test("all five operations have explicit availability rules", () => {
  const matrix = [
    ["install", false, true],
    ["update", false, false],
    ["repair", false, false],
    ["reinstall", false, false],
    ["uninstall", false, false],
    ["install", true, false],
    ["update", true, true],
    ["repair", true, true],
    ["reinstall", true, true],
    ["uninstall", true, true],
  ] as const;
  for (const [operation, installed, expected] of matrix) {
    assert.equal(installationOperationAllowed(operation, installed), expected);
  }
});

test("execution finalization invariants are source-enforced", async () => {
  const { readFile } = await import("node:fs/promises");
  const installation = await readFile(new URL("../bot/installation.ts", import.meta.url), "utf8");
  const orchestrator = await readFile(
    new URL("../bot/installation-orchestrator.ts", import.meta.url),
    "utf8",
  );
  const progress = await readFile(
    new URL("../bot/installation-progress.ts", import.meta.url),
    "utf8",
  );

  const healthIndex = orchestrator.indexOf("const health = await runInstallationHealthCheck");
  const installedIndex = orchestrator.indexOf("installed=TRUE");
  const uninstallHealthIndex = orchestrator.indexOf("Health Check حذف نصب");
  const uninstalledIndex = orchestrator.indexOf("installed=FALSE");
  assert.ok(healthIndex >= 0 && installedIndex > healthIndex);
  assert.ok(uninstallHealthIndex >= 0 && uninstalledIndex > uninstallHealthIndex);

  assert.equal(
    installation.includes('String(session?.operation ?? "") !== "report"'),
    true,
  );
  assert.equal(
    progress.includes('String(row.status) === "COMPLETED"'),
    true,
  );
  assert.equal(
    progress.includes("Math.min(99, weightedProgress)"),
    true,
  );
});

test("production hardening primitives are present", async () => {
  const { readFile } = await import("node:fs/promises");
  const installation = await readFile(new URL("../bot/installation.ts", import.meta.url), "utf8");
  const state = await readFile(new URL("../bot/installation-state.ts", import.meta.url), "utf8");
  assert.equal(installation.includes("state_version=state_version+1"), true);
  assert.equal(installation.includes("AND state_version=$"), true);
  assert.equal(installation.includes("sweepExpiredInstallationSessions"), true);
  assert.equal(state.includes("INSTALLATION_SESSION_INVALID_TRANSITION"), true);
});


test("every installation callback family has a real handler branch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../bot/installation.ts", import.meta.url), "utf8");
  const handlerStart = source.indexOf("export async function handleInstallationCallback");
  assert.ok(handlerStart >= 0);
  const handler = source.slice(handlerStart);

  const exactBranches = [
    "inst:operations",
    "inst:health",
    "inst:manage",
    "inst:check",
    "inst:preflight:details",
    "inst:preflight:summary",
    "inst:preflight:recheck",
    "inst:preflight:fix",
    "inst:preflight:continue",
    "inst:confirm",
    "inst:type:back",
    "inst:version",
    "inst:environment",
    "inst:settings:standard",
    "inst:settings:input",
    "inst:settings",
    "inst:summary:back",
    "inst:retry",
  ];

  for (const value of exactBranches) {
    assert.equal(handler.includes('data === "' + value + '"'), true, "missing handler: " + value);
  }

  assert.equal(handler.includes('data === "inst:home" || data === "inst:cancel"'), true);
  assert.equal(handler.includes('data.startsWith("inst:op:")'), true);
  assert.equal(handler.includes('data.startsWith("inst:type:")'), true);
  assert.equal(handler.includes('data === "inst:version:latest" || data === "inst:version:current"'), true);
  assert.equal(handler.includes('data === "inst:version:input"'), true);
  assert.equal(handler.includes('data.startsWith("inst:env:")'), true);
});


test("install type selection is state-machine driven", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../bot/installation.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function applyInstallType");
  const end = source.indexOf("async function renderCurrentSession", start);
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end);
  assert.equal(fn.includes("await transitionSession("), true);
  assert.equal(fn.includes("await saveSession("), false);
});
