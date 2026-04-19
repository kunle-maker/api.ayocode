const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const { checkRateLimit } = require('../utils/rateLimit');
const router = express.Router();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const OPENROUTER_MODEL = 'qwen/qwen-2.5-7b-instruct:free';
const GEMINI_MODEL = 'gemini-1.5-flash';

async function callGroq(messages, tools, temperature = 0.3, max_tokens = 8192) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      tools,
      temperature,
      max_tokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq error ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  return transformOpenAIResponse(data);
}

async function callOpenRouter(messages, tools, temperature = 0.3, max_tokens = 8192) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://ayocode.edgeone.app',
      'X-Title': 'AyoCode CLI'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      tools,
      temperature,
      max_tokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return transformOpenAIResponse(data);
}

async function callGemini(messages, tools, temperature = 0.3, max_tokens = 8192) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
  }

  const requestBody = {
    contents,
    generationConfig: {
      maxOutputTokens: max_tokens,
      temperature,
      topP: 0.95
    }
  };
  if (systemInstruction) requestBody.systemInstruction = systemInstruction;
  if (tools && tools.length > 0) {
    const functionDeclarations = [];
    for (const tool of tools) {
      if (tool.type === 'function' && tool.function) {
        functionDeclarations.push({
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: {
            type: 'object',
            properties: tool.function.parameters?.properties || {},
            required: tool.function.parameters?.required || []
          }
        });
      }
    }
    if (functionDeclarations.length > 0) {
      requestBody.tools = [{ functionDeclarations }];
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return transformGeminiResponse(data);
}

function transformOpenAIResponse(data) {
  return data;
}

function transformGeminiResponse(geminiData) {
  const candidate = geminiData.candidates?.[0];
  const content = candidate?.content;
  const parts = content?.parts || [];

  let messageContent = '';
  let toolCalls = [];

  for (const part of parts) {
    if (part.text) messageContent += part.text;
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
  }

  return {
    id: geminiData.responseId || `gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: GEMINI_MODEL,
    choices: [{
      index: candidate?.index || 0,
      message: {
        role: 'assistant',
        content: messageContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      },
      finish_reason: candidate?.finishReason === 'STOP' ? 'stop' :
                     candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop'
    }],
    usage: {
      prompt_tokens: geminiData.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiData.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: geminiData.usageMetadata?.totalTokenCount || 0
    }
  };
}

router.post('/completions', authenticateApiKey, async (req, res) => {
  console.log('Chat request received');

  try {
    const rateCheck = await checkRateLimit(req.apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `Daily limit reached: ${rateCheck.current}/${rateCheck.limit} requests.`
        }
      });
    }
    const { messages, max_tokens = 8192, temperature = 0.3, tools } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: { message: 'Invalid messages array' } });
    }

    //: Groq → OpenRouter (Qwen) → Gemini
    const providers = [
      { name: 'Groq', fn: () => callGroq(messages, tools, temperature, max_tokens) },
      { name: 'OpenRouter (Qwen)', fn: () => callOpenRouter(messages, tools, temperature, max_tokens) },
      { name: 'Gemini', fn: () => callGemini(messages, tools, temperature, max_tokens) }
    ];

    let lastError = null;

    for (const provider of providers) {
      try {
        console.log(`Trying provider: ${provider.name}`);
        const response = await provider.fn();
        console.log(`Success with ${provider.name}`);
        return res.json(response);
      } catch (err) {
        console.error(`${provider.name} failed:`, err.message);
        lastError = err;
      }
    }

    console.error('All providers failed');
    return res.status(503).json({
      error: {
        message: 'All AI providers are currently unavailable. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? lastError?.message : undefined
      }
    });

  } catch (err) {
    console.error('Chat proxy fatal error:', err);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      }
    });
  }
});

module.exports = router;