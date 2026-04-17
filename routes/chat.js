const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const { checkRateLimit } = require('../utils/rateLimit');
const router = express.Router();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

router.post('/completions', authenticateApiKey, async (req, res) => {
  try {
    const rateCheck = await checkRateLimit(req.apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `Daily request limit reached. You've used ${rateCheck.current}/${rateCheck.limit} requests.`,
        },
      });
    }
    const { model, messages, max_tokens, temperature, tools, tool_choice, stream } = req.body;
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: max_tokens || 8192,
        temperature: temperature ?? 0.3,
        tools,
        tool_choice: tool_choice || 'auto',
        stream,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Groq API Error:', response.status, error);
      return res.status(response.status).json({ 
        error: { message: error.error?.message || 'Groq API error' } 
      });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.body.pipe(res);
    } else {
      const data = await response.json();
      res.json(data);
    }
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

module.exports = router;