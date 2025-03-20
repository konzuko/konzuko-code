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
    if (model.includes('o3-mini') || model.includes('o1') || model.includes('o1-pro')) {
      requestBody.reasoning_effort = 'high';
    }
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
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
  
export async function callApiForImageDescription({ imageUrls = [], apiKey, openRouterApiKey, model = 'qwen/qwen2.5-vl-72b-instruct' }) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Please describe these images in detail. {ONLY RETURN THE DESCRIPTION OF THE IMAGES AND ITS ENTIRE CONTENT IN COMPREHENSIVE AND DETAILED LANGUAGE. DO NOT RETURN ANYTHING ELSE.}'
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
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes
    
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
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
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
