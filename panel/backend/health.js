function getHealth() {
  return {
    status: "online",
    service: "PERSIAN BOT STUDIO",
    phase: "01",
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getHealth };
