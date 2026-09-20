const settings = new Map();

const DEFAULT_SETTINGS = {
  language: "fa",
  botName: "PERSIAN BOT",
  bareCommands: true,
  responseStyle: "classic",
};

function getSettings() {
  return Object.fromEntries(settings);
}

function getSetting(key) {
  if (settings.has(key)) return settings.get(key);
  return DEFAULT_SETTINGS[key];
}

function setSetting(key, value) {
  if (!key) throw new Error("Setting key is required");
  settings.set(String(key), value);
  return value;
}

function updateSettings(values = {}) {
  for (const [key, value] of Object.entries(values)) {
    setSetting(key, value);
  }
  return getSettings();
}

function resetSettings() {
  settings.clear();
  return getSettings();
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  getSetting,
  setSetting,
  updateSettings,
  resetSettings,
};
