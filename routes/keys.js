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
    const { name } = req.body;
    const existing = await ApiKey.findOne({ userId: req.userId });
    
    const apiKey = new ApiKey({ 
      userId: req.userId,
      name: name || `Key-${Date.now()}`
    });
    
    await apiKey.save();
    res.json({ 
      key: apiKey.key, 
      tier: apiKey.tier,
      name: apiKey.name,
      expiresAt: apiKey.expiresAt
    });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to create API key' } });
  }
});

router.get('/', authenticateJWT, async (req, res) => {
  try {
    const keys = await ApiKey.find({ userId: req.userId }).select('-__v');
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to fetch API keys' } });
  }
});

router.delete('/:keyId', authenticateJWT, async (req, res) => {
  try {
    const result = await ApiKey.findOneAndDelete({ 
      _id: req.params.keyId,
      userId: req.userId 
    });
    
    if (!result) {
      return res.status(404).json({ error: { message: 'API key not found' } });
    }
    
    res.json({ message: 'API key deleted' });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to delete API key' } });
  }
});

router.get('/usage', authenticateApiKey, async (req, res) => {
  const apiKey = req.apiKey;
  const now = new Date();
  const lastReset = new Date(apiKey.lastReset);
  
  if (apiKey.isExpired()) {
    return res.status(403).json({ error: { message: 'API key expired' } });
  }
  
  if (now - lastReset > 24 * 60 * 60 * 1000) {
    apiKey.usageCount = 0;
    apiKey.lastReset = now;
  }
  
  apiKey.lastUsed = now;
  await apiKey.save();
  
  const limit = apiKey.tier === 'free' ? 100 : 1000;
  
  res.json({
    tier: apiKey.tier,
    usage: apiKey.usageCount,
    limit: limit,
    remaining: limit - apiKey.usageCount,
    reset: new Date(apiKey.lastReset.getTime() + 24 * 60 * 60 * 1000),
    expiresAt: apiKey.expiresAt
  });
});

module.exports = router;