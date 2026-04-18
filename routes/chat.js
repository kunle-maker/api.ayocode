const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const { checkRateLimit } = require('../utils/rateLimit');
const router = express.Router();

const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
  ? process.env.GEMINI_API_KEYS.split(',').map(key => key.trim())
  : [];
  
let currentKeyIndex = 0;

const getNextApiKey = () => {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('No Gemini API keys configured');
  }
  const key = GEMINI_API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
  return key;
};

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-flash-latest';

router.post('/completions', authenticateApiKey, async (req, res) => {
  console.log('Request received');
  
  try {
    const rateCheck = await checkRateLimit(req.apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `Daily request limit reached. You've used ${rateCheck.current}/${rateCheck.limit} requests.`,
        },
      });
    }
    
    const { messages, max_tokens, temperature, tools, tool_choice, stream } = req.body;
    
    console.log('Model:', GEMINI_MODEL);
    console.log('Messages count:', messages?.length);
    console.log('Tools:', tools?.length || 0);
    
    if (stream) {
      console.warn('Streaming disabled');
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
      const functionDeclarations = [];
      
      tools.forEach(tool => {
        if (tool.type === 'function' && tool.function) {
          const declaration = {
            name: tool.function.name,
            description: tool.function.description || '',
          };
          
          if (tool.function.parameters) {
            declaration.parameters = {
              type: 'object',
              properties: tool.function.parameters.properties || {},
              required: tool.function.parameters.required || []
            };
          }
          
          functionDeclarations.push(declaration);
        }
      });
      
      if (functionDeclarations.length > 0) {
        requestBody.tools = [{ functionDeclarations }];
        
        if (tool_choice) {
          requestBody.toolConfig = {
            functionCallingConfig: {
              mode: tool_choice === 'auto' ? 'AUTO' : 'ANY'
            }
          };
        }
      }
    }
    
    console.log('Request body:', JSON.stringify({
      ...requestBody,
      tools: requestBody.tools ? 'present' : 'none'
    }));
    
    let lastError = null;
    
    for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt++) {
      const currentKey = getNextApiKey();
      
      try {
        const response = await fetch(
          `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        );

        console.log('Gemini response:', response.status);

        if (response.ok) {
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
            model: GEMINI_MODEL,
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
          
          console.log('SUCCESS: Request completed');
          if (toolCalls.length > 0) {
            console.log('Tool calls:', toolCalls.map(t => t.function.name).join(', '));
          }
          
          return res.json(transformedResponse);
        }
        
        if (response.status === 429) {
          console.log(`Key ${currentKey.slice(0, 8)}... rate limited, trying next`);
          lastError = { status: 429, message: 'Rate limited' };
          continue;
        }
        
        const errorText = await response.text();
        console.error('FAIL: Gemini API Error:', errorText);
        lastError = { status: response.status, message: errorText };
        
        if (response.status === 400) {
          console.error('Bad request details:', errorText);
          break;
        }
        
        if (response.status !== 429 && response.status !== 403) {
          break;
        }
        
      } catch (fetchError) {
        console.error('FAIL: Fetch error:', fetchError.message);
        lastError = { status: 500, message: fetchError.message };
      }
    }
    
    return res.status(lastError?.status || 500).json({ 
      error: { message: 'All API keys failed' } 
    });
    
  } catch (err) {
    console.error('FAIL: Chat proxy error:', err);
    res.status(500).json({ 
      error: { 
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      } 
    });
  }
});

module.exports = router;