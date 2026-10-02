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
