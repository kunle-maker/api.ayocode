const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: { message: 'Email and password required' } });
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: { message: 'User already exists' } });
    }
    const user = new User({ email, password });
    await user.save();
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.json({ token, user: { email: user.email } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Registration failed' } });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.json({ token, user: { email: user.email } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Login failed' } });
  }
});

module.exports = router;