// services/openaiJson.ts
import { OPENAI_API_KEY } from '@env';

// --- small helpers (ported as-is) ---
function looksLikeJson(s: string) {
  if (!s) return false;
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

export function firstJsonIn(text?: string): any | null {
  if (!text) return null;
  const s = text.trim();
  if (looksLikeJson(s)) { try { return JSON.parse(s); } catch {} }
  const match = s.match(/[{\[][\s\S]*[}\]]/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

export function extractStructured<T = any>(json: any): T | null {
  if (json?.output_parsed) return json.output_parsed as T;
  if (json?.parsed) return json.parsed as T;

  const output = Array.isArray(json?.output) ? json.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (block?.parsed) return block.parsed as T;
      if (typeof block?.json === 'object' && block.json) return block.json as T;
      if (typeof block?.text === 'string') {
        const parsed = firstJsonIn(block.text);
        if (parsed) return parsed as T;
      }
      if (Array.isArray(block?.annotations)) {
        for (const a of block.annotations) {
          if (typeof a?.text === 'string') {
            const parsed = firstJsonIn(a.text);
            if (parsed) return parsed as T;
          }
        }
      }
    }
  }

  if (typeof json?.output_text === 'string') {
    const fx = firstJsonIn(json.output_text);
    if (fx) return fx as T;
  }

  const cmsg = json?.choices?.[0]?.message;
  if (typeof cmsg?.content === 'string') {
    const fx = firstJsonIn(cmsg.content);
    if (fx) return fx as T;
  }
  if (Array.isArray(cmsg?.content)) {
    for (const part of cmsg.content) {
      if (typeof part?.text === 'string') {
        const fx = firstJsonIn(part.text);
        if (fx) return fx as T;
      }
    }
  }
  return null;
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([Promise.resolve(p), timeout]); } finally { clearTimeout(timer); }
}

// --- main client (ported as-is) ---
export async function openAIJson<T>(
  schema: Record<string, any>,
  instruction: string,
  input: string,
  timeoutMs = 30000,
  maxOutputTokens = 900,
  model = 'gpt-4.1-mini'
): Promise<T> {
  const baseReq = {
    model,
    instructions: instruction,
    input,
    temperature: 0.1,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: 'fragment', schema, strict: true } }
  };

  // Responses API (first try)
  try {
    const resp = await withTimeout(fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baseReq),
    }), timeoutMs, 'OpenAI API call');
    const body = await resp.json();
    if (!resp.ok) throw new Error(body?.error?.message || `OpenAI error ${resp.status}`);
    const parsed = extractStructured<T>(body);
    const incomplete = body?.status === 'incomplete' || !!body?.incomplete_details;
    if (parsed && !incomplete) return parsed;
  } catch {}

  // Responses API (tighter retry)
  try {
    const tightReq = {
      ...baseReq,
      max_output_tokens: Math.max(600, Math.floor(maxOutputTokens * 0.8)),
      instructions: baseReq.instructions + ' Reply ONLY with valid JSON. Keep wording compact.'
    };
    const resp2 = await withTimeout(fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(tightReq),
    }), timeoutMs + 10000, 'OpenAI API call(tight)');
    const body2 = await resp2.json();
    if (!resp2.ok) throw new Error(body2?.error?.message || `OpenAI error ${resp2.status}`);
    const parsed2 = extractStructured<T>(body2);
    if (parsed2) return parsed2;
  } catch {}

  // Chat fallback
  const chatReq = {
    model, temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: { name: 'fragment', schema, strict: true } },
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: input },
      { role: 'system', content: 'Reply ONLY with a single JSON object matching the schema.' },
    ],
    max_tokens: Math.ceil(maxOutputTokens * 1.1),
  };

  const chatResp = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(chatReq),
  }), timeoutMs + 10000, 'OpenAI Chat');
  const chatBody = await chatResp.json();
  if (!chatResp.ok) throw new Error(chatBody?.error?.message || `OpenAI chat error ${chatResp.status}`);
  const parsedChat = extractStructured<T>(chatBody);
  if (!parsedChat) throw new Error('No model output');
  return parsedChat;
}
