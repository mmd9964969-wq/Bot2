const LEVELS = {
  OWNER: 100,
  SUPER_ADMIN: 90,
  ADMIN: 80,
  MODERATOR: 60,
  SPECIAL_USER: 40,
  MEMBER: 10,
};
const PERMISSION_KEYS = ["view","create","edit","delete","manage","configure","execute","sync"];
function normalizeRole(role) {
  const value = String(role || "MEMBER").trim().toUpperCase().replace(/\s+/g, "_");
  return LEVELS[value] !== undefined ? value : "MEMBER";
}
function normalizeLevel(level) {
  if (typeof level === "number") return level;
  return LEVELS[normalizeRole(level)] ?? LEVELS.MEMBER;
}
function hasPermission(userLevel, requiredLevel) {
  return normalizeLevel(userLevel) >= normalizeLevel(requiredLevel);
}
module.exports = { LEVELS, PERMISSION_KEYS, normalizeRole, normalizeLevel, hasPermission };
