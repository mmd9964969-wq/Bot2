const users = new Map();

function getUser(userId) {
  return users.get(String(userId)) || null;
}

function setUser(userId, data = {}) {
  const key = String(userId);
  const current = users.get(key) || {};
  const user = { ...current, ...data, id: key };
  users.set(key, user);
  return user;
}

function removeUser(userId) {
  return users.delete(String(userId));
}

function listUsers() {
  return Array.from(users.values());
}

module.exports = {
  getUser,
  setUser,
  removeUser,
  listUsers,
};
