const ApiKey = require('../models/ApiKey');

const authenticateApiKey = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Missing or invalid API key' } });
  }
  const key = authHeader.substring(7);
  try {
    const apiKey = await ApiKey.findOne({ key }).populate('userId');
    if (!apiKey) {
      return res.status(401).json({ error: { message: 'Invalid API key' } });
    }
    req.apiKey = apiKey;
    req.user = apiKey.userId;
    next();
  } catch (err) {
    res.status(500).json({ error: { message: 'Authentication error' } });
  }
};

module.exports = { authenticateApiKey };