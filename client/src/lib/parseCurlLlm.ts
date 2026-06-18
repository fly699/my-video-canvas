// Parse a `curl ... /v1/chat/completions` command (what vLLM/Ollama/LM Studio docs show)
// into the fields we need to register a self-hosted OpenAI-compatible LLM:
//   - url:    the server BASE (strip the /v1/chat/completions path)
//   - model:  from the JSON body `"model": "..."`
//   - apiKey: from an `Authorization: Bearer ...` header (optional; vLLM often no-auth)
export interface ParsedCurlLlm { url?: string; model?: string; apiKey?: string }

export function parseCurlLlm(curl: string): ParsedCurlLlm {
  const out: ParsedCurlLlm = {};
  if (!curl || !curl.trim()) return out;

  // First http(s) URL token (may be quoted). Strip the OpenAI chat path + trailing slash
  // so we keep just the server origin/base (the app re-appends /v1/chat/completions).
  const urlMatch = curl.match(/https?:\/\/[^\s'"]+/i);
  if (urlMatch) {
    out.url = urlMatch[0]
      .replace(/\/+(v1\/)?chat\/completions\/?$/i, "")
      .replace(/\/+$/, "");
  }

  // Authorization: Bearer <key>  (header may be in -H "..." or --header '...').
  const auth = curl.match(/authorization:\s*bearer\s+([^\s'"\\]+)/i);
  if (auth && auth[1] && !/^\$|\{\{/.test(auth[1])) out.apiKey = auth[1]; // ignore shell/template placeholders

  // "model": "<id>" anywhere in the -d / --data JSON body.
  const model = curl.match(/["']model["']\s*:\s*["']([^"']+)["']/);
  if (model) out.model = model[1].trim();

  return out;
}
