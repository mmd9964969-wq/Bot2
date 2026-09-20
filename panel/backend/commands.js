const commands = new Map();

function normalizeCommand(name) {
  return String(name || "").trim().toLowerCase();
}

function getCommand(name) {
  return commands.get(normalizeCommand(name)) || null;
}

function setCommand(name, data = {}) {
  const key = normalizeCommand(name);
  if (!key) throw new Error("Command name is required");

  const current = commands.get(key) || {};
  const command = {
    ...current,
    ...data,
    name: key,
    enabled: data.enabled !== undefined ? Boolean(data.enabled) : current.enabled !== false,
  };

  commands.set(key, command);
  return command;
}

function removeCommand(name) {
  return commands.delete(normalizeCommand(name));
}

function listCommands() {
  return Array.from(commands.values());
}

module.exports = {
  getCommand,
  setCommand,
  removeCommand,
  listCommands,
};
