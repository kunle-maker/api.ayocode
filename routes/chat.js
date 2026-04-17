const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const { checkRateLimit } = require('../utils/rateLimit');
const router = express.Router();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

router.post('/completions', authenticateApiKey, async (req, res) => {
  console.log('Request received');
  
  try {
    // Check if Groq API key exists
    if (!GROQ_API_KEY) {
      console.error('GROQ_API_KEY is missing in environment variables');
      return res.status(500).json({ error: { message: 'Server configuration error: Missing API key' } });
    }
    
    console.log(' Groq API key exists');
    
    const rateCheck = await checkRateLimit(req.apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `Daily request limit reached. You've used ${rateCheck.current}/${rateCheck.limit} requests.`,
        },
      });
    }
    
    const { messages, max_tokens, temperature, tools, tool_choice, stream } = req.body;
    
    console.log(' Forwarding to Groq...');
    console.log('Model: llama-3.3-70b-versatile');
    console.log('Messages count:', messages?.length);
    
    const requestBody = {
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: max_tokens || 8192,
      temperature: temperature ?? 0.3,
      tools,
      tool_choice: tool_choice || 'auto',
      stream,
    };
    
    console.log('Request body keys:', Object.keys(requestBody));
    
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(' Groq response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API Error Response:', errorText);
      
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }
      
      return res.status(response.status).json({ 
        error: { message: errorData.error?.message || errorData.message || 'Groq API error' } 
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
    
    console.log('Request completed successfully');
    
  } catch (err) {
    console.error('FATAL ERROR in chat proxy:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ 
      error: { 
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      } 
    });
  }
});

module.exports = router;