const express = require('express');
const jwt = require('jsonwebtoken');
const ApiKey = require('../models/ApiKey');
const { authenticateApiKey } = require('../middleware/auth');
const router = express.Router();

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Missing token' } });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: { message: 'Invalid token' } });
  }
};

router.post('/', authenticateJWT, async (req, res) => {
  try {
    const existing = await ApiKey.findOne({ userId: req.userId });
    if (existing) {
      return res.status(400).json({ error: { message: 'You already have an API key. Delete it first or contact support.' } });
    }
    const apiKey = new ApiKey({ userId: req.userId });
    await apiKey.save();
    res.json({ key: apiKey.key, tier: apiKey.tier });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to create API key' } });
  }
});

router.get('/usage', authenticateApiKey, async (req, res) => {
  const apiKey = req.apiKey;
  const now = new Date();
  const lastReset = new Date(apiKey.lastReset);
  if (now - lastReset > 24 * 60 * 60 * 1000) {
    apiKey.usageCount = 0;
    apiKey.lastReset = now;
    await apiKey.save();
  }
  res.json({
    tier: apiKey.tier,
    usage: apiKey.usageCount,
    limit: apiKey.tier === 'free' ? 100 : 1000,
    reset: new Date(apiKey.lastReset.getTime() + 24 * 60 * 60 * 1000),
  });
});

module.exports = router;