Context caching

Python JavaScript Go REST

In a typical AI workflow, you might pass the same input tokens over and over to a model. The Gemini API offers two different caching mechanisms:

Implicit caching (automatic, no cost saving guarantee)
Explicit caching (manual, cost saving guarantee)
Implicit caching is enabled on Gemini 2.5 models by default. If a request contains content that is a cache hit, we automatically pass the cost savings back to you.

Explicit caching is useful in cases where you want to guarantee cost savings, but with some added developer work.

There are two layers of caches in Gemini:

Prefill cache: Cache for models being ready to generate the first token. It cannot share between models.
Preprocess cache: Cache for formatting and tokenizing multi-modal input like videos and PDF. It could be reused by different models
Implicit caching
Implicit caching is enabled by default for all Gemini 2.5 models. We automatically pass on cost savings if your request hits caches. There is nothing you need to do in order to enable this. It is effective as of May 8th, 2025. The minimum input token count for context caching is 1,024 for 2.5 Flash and 2,048 for 2.5 Pro.

To increase the chance of an implicit cache hit:

Try putting large and common contents at the beginning of your prompt
Try to send requests with similar prefix in a short amount of time
You can see the number of tokens which were cache hits in the response object's usage_metadata field.

The cost savings are measure by prefilled cache hits. Only prefilled cache and YouTube video preprocessing cache are enabled for implicit caching. For lower latency Gemini calls for other multi-modal input, consider using explicit cache.

Explicit caching
Using the Gemini API explicit caching feature, you can pass some content to the model once, cache the input tokens, and then refer to the cached tokens for subsequent requests. At certain volumes, using cached tokens is lower cost than passing in the same corpus of tokens repeatedly.

When you cache a set of tokens, you can choose how long you want the cache to exist before the tokens are automatically deleted. This caching duration is called the time to live (TTL). If not set, the TTL defaults to 1 hour. The cost for caching depends on the input token size and how long you want the tokens to persist.

This section assumes that you've installed a Gemini SDK (or have curl installed) and that you've configured an API key, as shown in the quickstart.

Generate content using a cache
The following example shows how to generate content using a cached system instruction and a text file.


import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";

const ai = new GoogleGenAI({ apiKey: "GEMINI_API_KEY" });

async function main() {
  const doc = await ai.files.upload({
    file: "path/to/file.txt",
    config: { mimeType: "text/plain" },
  });
  console.log("Uploaded file name:", doc.name);

  const modelName = "gemini-2.0-flash-001";
  const cache = await ai.caches.create({
    model: modelName,
    config: {
      contents: createUserContent(createPartFromUri(doc.uri, doc.mimeType)),
      systemInstruction: "You are an expert analyzing transcripts.",
    },
  });
  console.log("Cache created:", cache);

  const response = await ai.models.generateContent({
    model: modelName,
    contents: "Please summarize this transcript",
    config: { cachedContent: cache.name },
  });
  console.log("Response text:", response.text);
}

await main();
List caches
It's not possible to retrieve or view cached content, but you can retrieve cache metadata (name, model, displayName, usageMetadata, createTime, updateTime, and expireTime).

To list metadata for all uploaded caches, use GoogleGenAI.caches.list():


console.log("My caches:");
const pager = await ai.caches.list({ config: { pageSize: 10 } });
let page = pager.page;
while (true) {
  for (const c of page) {
    console.log("    ", c.name);
  }
  if (!pager.hasNextPage()) break;
  page = await pager.nextPage();
}
Update a cache
You can set a new ttl or expireTime for a cache. Changing anything else about the cache isn't supported.

The following example shows how to update the ttl of a cache using GoogleGenAI.caches.update().


const ttl = `${2 * 3600}s`; // 2 hours in seconds
const updatedCache = await ai.caches.update({
  name: cache.name,
  config: { ttl },
});
console.log("After update (TTL):", updatedCache);
Delete a cache
The caching service provides a delete operation for manually removing content from the cache. The following example shows how to delete a cache using GoogleGenAI.caches.delete().


await ai.caches.delete({ name: cache.name });
Explicit caching using the OpenAI library
If you're using an OpenAI library, you can enable explicit caching using the cached_content property on extra_body.

When to use explicit caching
Context caching is particularly well suited to scenarios where a substantial initial context is referenced repeatedly by shorter requests. Consider using context caching for use cases such as:

Chatbots with extensive system instructions
Repetitive analysis of lengthy video files
Recurring queries against large document sets
Frequent code repository analysis or bug fixing
How explicit caching reduces costs
Context caching is a paid feature designed to reduce overall operational costs. Billing is based on the following factors:

Cache token count: The number of input tokens cached, billed at a reduced rate when included in subsequent prompts.
Storage duration: The amount of time cached tokens are stored (TTL), billed based on the TTL duration of cached token count. There are no minimum or maximum bounds on the TTL.
Other factors: Other charges apply, such as for non-cached input tokens and output tokens.
For up-to-date pricing details, refer to the Gemini API pricing page. To learn how to count tokens, see the Token guide.

Additional considerations
Keep the following considerations in mind when using context caching:

The minimum input token count for context caching is 1,024 for 2.5 Flash and 2,048 for 2.5 Pro. The maximum is the same as the maximum for the given model. (For more on counting tokens, see the Token guide).
The model doesn't make any distinction between cached tokens and regular input tokens. Cached content is a prefix to the prompt.
There are no special rate or usage limits on context caching; the standard rate limits for GenerateContent apply, and token limits include cached tokens.
The number of cached tokens is returned in the usage_metadata from the create, get, and list operations of the cache service, and also in GenerateContent when using the cache.
