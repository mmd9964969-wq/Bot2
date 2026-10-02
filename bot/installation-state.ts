export type InstallationSessionStep =
  | "operation"
  | "install_type"
  | "version"
  | "environment"
  | "settings"
  | "summary"
  | "confirmed"
  | "preflight"
  | "executing"
  | "verifying"
  | "completed"
  | "failed";

export type InstallationSessionStatus =
  | "collecting"
  | "confirmed"
  | "checking"
  | "preflight_ready"
  | "preflight_blocked"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "preflight_report"
  | "ready";

const STEP_TRANSITIONS: Record<InstallationSessionStep, InstallationSessionStep[]> = {
  operation: ["install_type", "summary", "preflight"],
  install_type: ["version", "summary", "operation"],
  version: ["environment", "version", "install_type"],
  environment: ["settings", "environment", "version"],
  settings: ["summary", "settings", "environment"],
  summary: ["confirmed", "summary", "install_type", "operation"],
  confirmed: ["preflight", "confirmed", "operation"],
  preflight: ["preflight", "executing", "failed", "summary", "confirmed"],
  executing: ["executing", "verifying", "failed"],
  verifying: ["verifying", "completed", "failed"],
  completed: ["completed", "operation", "preflight"],
  failed: ["failed", "preflight", "operation"],
};

const STATUS_TRANSITIONS: Record<InstallationSessionStatus, InstallationSessionStatus[]> = {
  collecting: ["collecting", "confirmed", "checking", "failed"],
  confirmed: ["confirmed", "checking", "preflight_ready", "preflight_blocked", "executing", "failed"],
  checking: ["checking", "preflight_ready", "preflight_blocked", "failed"],
  preflight_ready: ["preflight_ready", "checking", "executing", "failed"],
  preflight_blocked: ["preflight_blocked", "checking", "failed"],
  executing: ["executing", "verifying", "failed"],
  verifying: ["verifying", "completed", "failed"],
  completed: ["completed", "collecting", "checking", "failed"],
  failed: ["failed", "checking", "preflight_blocked", "preflight_ready", "collecting"],
  preflight_report: ["preflight_report", "checking", "failed"],
  ready: ["ready", "checking", "executing", "failed"],
};

const EXACT_CALLBACKS = new Set([
  "inst:operations",
  "inst:check",
  "inst:manage",
  "inst:cancel",
  "inst:home",
  "inst:preflight:details",
  "inst:preflight:recheck",
  "inst:preflight:fix",
  "inst:preflight:continue",
  "inst:preflight:summary",
  "inst:health",
  "inst:confirm",
  "inst:retry",
  "inst:type:back",
  "inst:version",
  "inst:environment",
  "inst:settings",
  "inst:settings:standard",
  "inst:settings:input",
  "inst:summary:back",
]);

const PREFIX_CALLBACKS = [
  "inst:op:",
  "inst:type:",
  "inst:version:",
  "inst:env:",
];

export function canTransitionInstallationSession(
  currentStep: string,
  currentStatus: string,
  nextStep: InstallationSessionStep,
  nextStatus: InstallationSessionStatus,
) {
  const stepAllowed = STEP_TRANSITIONS[currentStep as InstallationSessionStep]?.includes(nextStep) ?? false;
  const statusAllowed = STATUS_TRANSITIONS[currentStatus as InstallationSessionStatus]?.includes(nextStatus) ?? false;
  return stepAllowed && statusAllowed;
}

export function assertInstallationSessionTransition(
  currentStep: string,
  currentStatus: string,
  nextStep: InstallationSessionStep,
  nextStatus: InstallationSessionStatus,
) {
  if (!canTransitionInstallationSession(currentStep, currentStatus, nextStep, nextStatus)) {
    const error = new Error(
      `نشست نصب نمی‌تواند از ${currentStep}/${currentStatus} به ${nextStep}/${nextStatus} منتقل شود.`,
    );
    (error as any).code = "INSTALLATION_SESSION_INVALID_TRANSITION";
    throw error;
  }
}

export function isKnownInstallationCallback(value: string) {
  const data = String(value ?? "").trim();
  return EXACT_CALLBACKS.has(data) || PREFIX_CALLBACKS.some((prefix) => data.startsWith(prefix));
}

export function installationOperationAllowed(
  operation: string,
  installed: boolean,
) {
  if (operation === "install") return !installed;
  if (["update", "repair", "reinstall", "uninstall"].includes(operation)) return installed;
  return operation === "report";
}
