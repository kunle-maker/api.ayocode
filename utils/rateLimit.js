const ApiKey = require('../models/ApiKey');
const DAILY_LIMITS = {
  free: 100,
  pro: 1000,
};

const checkRateLimit = async (apiKey) => {
  const now = new Date();
  const lastReset = new Date(apiKey.lastReset);
  if (now - lastReset > 24 * 60 * 60 * 1000) {
    apiKey.usageCount = 0;
    apiKey.lastReset = now;
    await apiKey.save();
  }
  const limit = DAILY_LIMITS[apiKey.tier] || 100;
  if (apiKey.usageCount >= limit) {
    return { allowed: false, limit, current: apiKey.usageCount };
  }
  apiKey.usageCount += 1;
  await apiKey.save();
  return { allowed: true, limit, current: apiKey.usageCount };
};

module.exports = { checkRateLimit };