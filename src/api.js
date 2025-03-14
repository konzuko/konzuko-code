/* api.js */
export async function callApiForText({ messages, apiKey, model = 'o3-mini-high' }) {
  try {
    console.log('Sending API request with model:', model);
    // Format messages so that each message has an array of content objects.
    const formattedMessages = messages.map(m => {
      if (Array.isArray(m.content)) return m;
      return {
        role: m.role === 'system' ? 'developer' : m.role,
        content: [{ type: 'text', text: m.content }]
      };
    });
    const requestBody = {
      model,
      messages: formattedMessages,
      response_format: { type: 'text' }
    };
    // Example: override reasoning_effort if model includes "o3-mini"
    if (model.includes('o3-mini')) {
      requestBody.reasoning_effort = 'high';
    }
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch (e) {
        errorDetails = errorText;
      }
      console.error(`API Error (${response.status}):`, errorDetails);
      return { 
        error: `HTTP Error ${response.status}: ${errorDetails}`,
        status: response.status,
        details: errorText
      };
    }
    const data = await response.json();
    if (data.error) {
      return { error: data.error.message };
    }
    return { content: data.choices?.[0]?.message?.content || '' };
  } catch (err) {
    return { error: err.message };
  }
}

export async function callApiForImageDescription({ imageUrls = [], apiKey, openRouterApiKey, model = 'mistralai/mistral-small-24b-instruct-2501' }) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Please describe these images in detail. Focus on content relevant for coding or technical context.'
        },
        ...imageUrls.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ]
    }
  ];

  try {
    console.log('Sending image API request via OpenRouter with model:', model);
    console.log('Image messages format:', JSON.stringify(messages, null, 2));
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey || apiKey}`,
        'HTTP-Referer': 'https://konzuko-code.local', 
        'X-Title': 'Konzuko Code',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        response_format: { type: 'text' }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch (e) {
        errorDetails = errorText;
      }
      console.error(`Image API Error (${response.status}):`, errorDetails);
      return { 
        error: `HTTP Error ${response.status}: ${errorDetails}`,
        status: response.status,
        details: errorText
      };
    }
    const data = await response.json();
    if (data.error) {
      return { error: data.error.message };
    }
    return { content: data.choices?.[0]?.message?.content || '' };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Summaries that might have existed for chat titles or conversation
 * have been removed to comply with the "no AI-based title" request.
 */