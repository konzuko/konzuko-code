export async function callApiForText({ messages, apiKey, model = 'o3-mini-high', maxTokens }) {
  try {
    console.log('Sending API request with model:', model);
    
    // Format messages based on whether they're in the new format or not
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
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      response_format: { type: 'text' }
    };
    
    // Example usage: override reasoning effort if model is "o3-mini-..."
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
      console.error('Full response:', errorText);
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

export async function callApiForImageDescription({ imageUrls = [], apiKey, model = 'o3-mini-high' }) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Please describe these images in detail. Focus on the content that would be relevant for coding or technical context.'
        },
        ...imageUrls.map(url => ({
          type: 'image_url',
          image_url: { url }  // These MUST be valid data URLs or a real remote URL
        }))
      ]
    }
  ];

  try {
    console.log('Sending image API request with model:', model);
    console.log('Image messages format:', JSON.stringify(messages, null, 2));
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 300,
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
      
      console.error(`API Error (${response.status}):`, errorDetails);
      console.error('Full response:', errorText);
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

export async function summarizeConversation(messages, apiKey, model = 'o3-mini-high') {
  const systemMessage = {
    role: 'developer',
    content: [{
      type: 'text',
      text: `Please provide a detailed step-by-step summary including all user instructions, code attempts, responses, and any pending tasks. This will continue your conversation.`
    }]
  };

  const formattedMessages = messages.map(m => {
    if (Array.isArray(m.content)) {
      return {
        role: m.role === 'system' ? 'developer' : m.role,
        content: m.content
      };
    }
    return {
      role: m.role === 'system' ? 'developer' : m.role,
      content: [{ type: 'text', text: m.content }]
    };
  });

  const result = await callApiForText({
    messages: [systemMessage, ...formattedMessages],
    apiKey,
    model,
    maxTokens: 1024
  });

  if (result.error) {
    throw new Error(result.error);
  }
  return result.content;
}