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
