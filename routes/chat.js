const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const { checkRateLimit } = require('../utils/rateLimit');
const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

router.post('/completions', authenticateApiKey, async (req, res) => {
  console.log('Request received');
  
  try {
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is missing in environment variables');
      return res.status(500).json({ error: { message: 'Server configuration error: Missing API key' } });
    }
    
    console.log(' Gemini API key exists');
    
    const rateCheck = await checkRateLimit(req.apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `Daily request limit reached. You've used ${rateCheck.current}/${rateCheck.limit} requests.`,
        },
      });
    }
    
    const { messages, max_tokens, temperature, tools, tool_choice, stream } = req.body;
    
    console.log('- Forwarding to Gemini for coding agent...');
    console.log('- Model: gemini-flash-latest');
    console.log('- Messages count:', messages?.length);
    console.log('- Tools provided:', !!tools);
    
    if (stream) {
      console.warn('Streaming disabled for compatibility');
    }

    const contents = [];
    let systemInstruction = null;
    
    messages.forEach(msg => {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    });

    const requestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: max_tokens || 8192,
        temperature: temperature ?? 0.3,
        topP: 0.95,
      }
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools.map(tool => ({
        functionDeclarations: tool.function ? [{
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }] : []
      }));
      
      if (tool_choice) {
        requestBody.toolConfig = {
          functionCallingConfig: {
            mode: tool_choice === 'auto' ? 'AUTO' : 'ANY'
          }
        };
      }
    }
    
    console.log('Sending request.....');
    
    const response = await fetch(
      `${GEMINI_BASE_URL}/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
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
      
      if (response.status === 429) {
        return res.status(429).json({ 
          error: { message: 'Rate limit exceeded. Please try again in 24hours.' } 
        });
      }
      
      return res.status(response.status).json({ 
        error: { message: errorData.error?.message || 'Gemini API error' } 
      });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const content = candidate?.content;
    const parts = content?.parts || [];
    
    let messageContent = '';
    let toolCalls = [];
    
    parts.forEach(part => {
      if (part.text) {
        messageContent += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        });
      }
    });
    
    const transformedResponse = {
      id: data.responseId || `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gemini-flash-latest',
      choices: [{
        index: candidate?.index || 0,
        message: {
          role: 'assistant',
          content: messageContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: candidate?.finishReason === 'STOP' ? 'stop' : 
                       candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
      }],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
    
    console.log('Request completed successfully');
    if (toolCalls.length > 0) {
      console.log(' Tool calls generated:', toolCalls.map(t => t.function.name).join(', '));
    }
    
    res.json(transformedResponse);
    
  } catch (err) {
    console.error('ERROR in chat proxy:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
      error: { 
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      } 
    });
  }
});

module.exports = router;