// Parse a `curl ... /v1/chat/completions` command (what vLLM/Ollama/LM Studio docs show)
// into the fields we need to register a self-hosted OpenAI-compatible LLM:
//   - url:    canonical `/v1/chat/completions` → server BASE (app re-appends it);
//             a NON-/v1 endpoint like Open WebUI's `/api/chat/completions` is kept
//             VERBATIM so selfHostedChatUrl() uses it as-is (no /v1 force-append).
//   - model:  from the JSON body `"model": "..."`
//   - apiKey: from an `Authorization: Bearer ...` header (optional; vLLM often no-auth)
export interface ParsedCurlLlm { url?: string; model?: string; apiKey?: string }

export function parseCurlLlm(curl: string): ParsedCurlLlm {
  const out: ParsedCurlLlm = {};
  if (!curl || !curl.trim()) return out;

  // First http(s) URL token (may be quoted).
  const urlMatch = curl.match(/https?:\/\/[^\s'"]+/i);
  if (urlMatch) {
    const raw = urlMatch[0].replace(/\/+$/, "");
    if (/\/v1\/chat\/completions$/i.test(raw)) {
      // canonical OpenAI path → store BASE (backend re-appends /v1/chat/completions).
      out.url = raw.replace(/\/+v1\/chat\/completions$/i, "").replace(/\/+$/, "");
    } else {
      // Open WebUI `/api/chat/completions`, a bare base, or any other endpoint →
      // keep verbatim; selfHostedChatUrl() decides whether to append /v1/chat/completions.
      out.url = raw;
    }
  }

  // Authorization: Bearer <key>  (header may be in -H "..." or --header '...').
  const auth = curl.match(/authorization:\s*bearer\s+([^\s'"\\]+)/i);
  if (auth && auth[1] && !/^\$|\{\{/.test(auth[1])) out.apiKey = auth[1]; // ignore shell/template placeholders

  // "model": "<id>" anywhere in the -d / --data JSON body.
  const model = curl.match(/["']model["']\s*:\s*["']([^"']+)["']/);
  if (model) out.model = model[1].trim();

  return out;
}
