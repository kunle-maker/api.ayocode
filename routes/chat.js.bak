const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const { checkRateLimit } = require('../utils/rateLimit');
const router = express.Router();

// Configuration for Google Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Using the v1beta endpoint for the free tier compatibility
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

router.post('/completions', authenticateApiKey, async (req, res) => {
  console.log('Request received');
  
  try {
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is missing in environment variables');
      return res.status(500).json({ error: { message: 'Server configuration error: Missing API key' } });
    }
    
    console.log('Gemini API key exists');
    
    const rateCheck = await checkRateLimit(req.apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `Daily request limit reached. You've used ${rateCheck.current}/${rateCheck.limit} requests.`,
        },
      });
    }
    
    const { messages, max_tokens, temperature, stream } = req.body;
    
    console.log('Forwarding to Google Gemini...');
    console.log('Model: gemini-2.0-flash-exp');
    
    // Note: Gemini free tier does not support streaming in the same way.
    if (stream) {
      console.warn('Streaming is not fully supported in Gemini free tier. Falling back to non-stream.');
    }

    // Transform messages to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Gemini expects specific structure if there's a system prompt
    let systemInstruction = null;
    if (messages[0]?.role === 'system') {
      systemInstruction = { parts: [{ text: messages[0].content }] };
      contents.shift(); // Remove system prompt from main contents
    }

    const requestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: max_tokens || 4096,
        temperature: temperature ?? 0.3,
      }
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }
    
    const response = await fetch(
      `${GEMINI_BASE_URL}/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log('Gemini response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API Error Response:', errorText);
      
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }
      
      // Handle specific quota errors from Gemini
      if (response.status === 429) {
        return res.status(429).json({ 
          error: { message: 'Gemini free tier quota exceeded. Please try again tomorrow.' } 
        });
      }
      
      return res.status(response.status).json({ 
        error: { message: errorData.error?.message || 'Gemini API error' } 
      });
    }

    const data = await response.json();
    
    // Transform Gemini response to OpenAI-compatible format
    const transformedResponse = {
      id: data.candidates?.[0]?.content?.parts?.[0]?.text ? 'gemini-' + Date.now() : null,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gemini-2.0-flash-exp',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
    
    res.json(transformedResponse);
    console.log('Request completed successfully');
    
  } catch (err) {
    console.error('FATAL ERROR in chat proxy:', err);
    res.status(500).json({ 
      error: { 
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      } 
    });
  }
});

module.exports = router;