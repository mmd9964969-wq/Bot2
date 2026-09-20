let lastSync = null;

function markSync(source = "panel") {
  lastSync = {
    source,
    timestamp: new Date().toISOString(),
  };
  return lastSync;
}

function getLastSync() {
  return lastSync;
}

module.exports = { markSync, getLastSync };
