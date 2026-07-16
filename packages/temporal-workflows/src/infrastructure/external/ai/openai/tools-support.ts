/**
 * Detection of "this provider/model cannot serve our tool-calling request".
 *
 * Providers signal this inconsistently: some 400 on the `tools` parameter
 * itself, others (e.g. Cloudflare Workers AI behind LiteLLM) accept the first
 * round but reject the tool-call conversation shape on the next one. Since
 * this check only ever guards requests that DID include tools, any 4xx schema
 * rejection is treated as lack of tool support — a false positive only costs
 * the tool loop, never the analysis (callers fall back to the single-shot
 * path, where a genuinely bad request would fail again and surface). Auth
 * (401/403), rate-limit (429), and server (5xx) errors are real failures and
 * are never swallowed.
 *
 * Kept in its own decorator-free module so tests (run via tsx/esbuild, which
 * has no experimentalDecorators) can import it without pulling in the
 * tsyringe-decorated gateway class.
 */
export function isToolsUnsupportedError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  return status === 400 || status === 404 || status === 422;
}
