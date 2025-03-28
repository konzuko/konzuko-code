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
    const timeoutId = setTimeout(() => controller.abort(), 11 * 60 * 1000); // 11 minutes

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

