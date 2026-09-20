const LEVELS = {
  OWNER: 100,
  ADMIN: 80,
  MODERATOR: 60,
  MEMBER: 10,
};

function normalizeLevel(level) {
  if (typeof level === "number") return level;
  return LEVELS[String(level || "MEMBER").toUpperCase()] ?? LEVELS.MEMBER;
}

function hasPermission(userLevel, requiredLevel) {
  return normalizeLevel(userLevel) >= normalizeLevel(requiredLevel);
}

module.exports = { LEVELS, normalizeLevel, hasPermission };
