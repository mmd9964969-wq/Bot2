const auditLog = [];

function recordAudit({ actorId, action, target, before = null, after = null, source = "panel" } = {}) {
  const entry = {
    id: auditLog.length + 1,
    actorId: actorId ?? null,
    action: action || "unknown",
    target: target ?? null,
    before,
    after,
    source,
    timestamp: new Date().toISOString(),
  };

  auditLog.push(entry);
  return entry;
}

function listAuditLogs(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  return auditLog.slice(-safeLimit).reverse();
}

function clearAuditLogs() {
  auditLog.length = 0;
}

module.exports = {
  recordAudit,
  listAuditLogs,
  clearAuditLogs,
};
