const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true, 
    default: () => `ayo-${crypto.randomBytes(24).toString('hex')}` 
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tier: { type: String, enum: ['free', 'pro'], default: 'free' },
  usageCount: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  lastUsed: { type: Date },
  name: { type: String, default: 'Default Key' }
});

apiKeySchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

module.exports = mongoose.model('ApiKey', apiKeySchema); 