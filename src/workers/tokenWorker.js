// file: src/lib/tokenWorker.js
import { GoogleGenAI } from "@google/genai";

let genAI = null;

self.onmessage = async (e) => {
  const { type, id, apiKey, model, items } = e.data;

  if (type === 'INIT') {
    if (apiKey && String(apiKey).trim() !== "") {
      try {
        genAI = new GoogleGenAI({ apiKey: apiKey });
        console.log('[Worker] Gemini SDK Initialized.');
      } catch (err) {
        console.error('[Worker] SDK Initialization failed:', err.message);
      }
    }
    return;
  }

  if (type !== 'COUNT') {
    // Ignore unknown message types
    return;
  }

  if (!genAI) {
    self.postMessage({ id, total: 0, error: "Worker not initialized with API key." });
    return;
  }

  try {
    const parts = [];
    if (items && items.length > 0) {
        items.forEach(item => {
            if (item.type === 'text' && typeof item.value === 'string') {
                parts.push({ text: item.value });
            } else if (item.type === 'pdf' && item.uri && item.mimeType) {
                parts.push({ fileData: { fileUri: item.uri, mimeType: item.mimeType } });
            }
        });
    }
    
    if (parts.length === 0) {
        self.postMessage({ id, total: 0 });
        return;
    }
    
    const contentsForApi = [{ role: "user", parts }];
    
    const result = await genAI.models.countTokens({ model: model, contents: contentsForApi }); 
    self.postMessage({ id, total: result.totalTokens });

  } catch (err) {
    console.error('[Worker] Error during token counting:', err.message, err.stack);
    self.postMessage({ 
        id, 
        total: 0, 
        error: `Worker error: ${err.message}${err.stack ? ` | Stack: ${err.stack.substring(0, 200)}...` : ''}` 
    });
  }
};

self.addEventListener('error', e => {
  console.error('[Worker] Unhandled script error:', e.message, e.filename, e.lineno);
  self.postMessage({ 
      id: -1, 
      total: 0, 
      error: `Unexpected worker script error: ${e.message}` 
  });
});
