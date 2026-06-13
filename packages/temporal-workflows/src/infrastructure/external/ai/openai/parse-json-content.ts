/**
 * Parses a model's text response into a JSON object, tolerating the common
 * ways models wrap structured output. We can't rely on `response_format:
 * json_object` everywhere: Cloudflare's OpenAI-compatible endpoint is sent
 * without it, and when the LiteLLM router falls back to another provider
 * (e.g. Gemini) the response is often wrapped in a ```json … ``` markdown
 * fence or surrounded by prose. Strategy:
 *   1. Try the raw string (fast path for well-behaved models).
 *   2. Strip a leading/trailing markdown code fence and retry.
 *   3. Extract the outermost {...} or [...] block and parse that.
 * Throws only when no JSON can be recovered at all.
 */
export function parseJsonContent(content: string): any {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to fence/substring recovery
  }

  // Strip a ```json … ``` or ``` … ``` fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  // Last resort: grab the outermost JSON object or array from surrounding prose.
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start !== -1) {
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }

  throw new SyntaxError(
    `AI response was not valid JSON and no JSON block could be recovered: ${trimmed.slice(0, 200)}`,
  );
}
