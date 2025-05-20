// workers/tokenWorker.js
import { GoogleGenAI } from "@google/genai";

self.onmessage = async (e) => {
  const { id, apiKey, model, items } = e.data;

  // UNCOMMENT for detailed worker input logging if needed
  // console.log('[Worker] Received data:', { id, apiKeyPresent: !!apiKey, model, itemsCount: items ? items.length : 0, itemsContent: JSON.stringify(items) });

  if (!apiKey || String(apiKey).trim() === "") {
    // console.log('[Worker] API key is missing or empty in worker.'); // Optional log
    self.postMessage({ id, total: 0, error: "API key is missing or empty in worker." });
    return;
  }

  try {
    const genAI = new GoogleGenAI({ apiKey: apiKey }); 
    
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
        // console.log('[Worker] No valid parts constructed for API call.'); // Optional log
        self.postMessage({ id, total: 0 });
        return;
    }
    
    const contentsForApi = [{ role: "user", parts }];
    // console.log('[Worker] Contents being sent to countTokens API:', JSON.stringify(contentsForApi, null, 2)); // Optional log

    const result = await genAI.models.countTokens({ model: model, contents: contentsForApi }); 
    // console.log('[Worker] API countTokens result:', result); // Optional log
    self.postMessage({ id, total: result.totalTokens });

  } catch (err) {
    console.error('[Worker] Error during token counting:', err.message, err.stack); // Log full error in worker
    self.postMessage({ 
        id, 
        total: 0, 
        error: `Worker error: ${err.message}${err.stack ? ` | Stack: ${err.stack.substring(0, 200)}...` : ''}` 
    });
  }
};

self.addEventListener('error', e => {
  console.error('[Worker] Unhandled script error:', e.message, e.filename, e.lineno); // Log more details
  self.postMessage({ 
      id: -1, 
      total: 0, 
      error: `Unexpected worker script error: ${e.message}` 
  });
});
