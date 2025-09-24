// hooks/useGeneratePlantFacts.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY } from '@env';

const OPENAI_MODEL = 'gpt-4.1-mini';

type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available';
type Rarity       = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare';

type Result = {
  description: string;
  availability_status: Availability;
  rarity_level: Rarity;
  suggested_common_name: string | null;
};

type Args = {
  plantsTableId: string;
  commonName?: string | null;
  scientificName?: string | null;
};

async function withTimeout<T>(p: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([Promise.resolve(p), timeout]); }
  finally { clearTimeout(timer); }
}

type SBErr = { message: string; code?: string; details?: string; hint?: string } | null;
type SBResp<T = any> = { data: T | null; error: SBErr; status?: number };

function looksLikeJson(s: string) { if (!s) return false; const t = s.trim(); return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')); }
function firstJsonIn(text?: string): any | null {
  if (!text) return null;
  const s = text.trim();
  if (looksLikeJson(s)) { try { return JSON.parse(s); } catch {} }
  const match = s.match(/[{\[][\s\S]*[}\]]/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}
function extractStructured<T = any>(json: any): T | null {
  if (json?.output_parsed) return json.output_parsed as T;
  if (json?.parsed)        return json.parsed as T;
  const output = Array.isArray(json?.output) ? json.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (c?.parsed) return c.parsed as T;
      if (typeof c?.json === 'object' && c.json) return c.json as T;
      if (typeof c?.text === 'string') { const fx = firstJsonIn(c.text); if (fx) return fx as T; }
      if (Array.isArray(c?.annotations)) for (const a of c.annotations) if (typeof a?.text === 'string') { const fx = firstJsonIn(a.text); if (fx) return fx as T; }
    }
  }
  if (typeof json?.output_text === 'string') { const fx = firstJsonIn(json.output_text); if (fx) return fx as T; }
  const cmsg = json?.choices?.[0]?.message;
  if (typeof cmsg?.content === 'string') { const fx = firstJsonIn(cmsg.content); if (fx) return fx as T; }
  if (Array.isArray(cmsg?.content)) for (const part of cmsg.content) if (typeof part?.text === 'string') { const fx = firstJsonIn(part.text); if (fx) return fx as T; }
  return null;
}

async function openAIJson<T>(schema: any, instructions: string, input: string, maxTokens: number): Promise<T> {
  const baseReq = { model: OPENAI_MODEL, instructions, input, temperature: 0.1, max_output_tokens: maxTokens,
    text: { format: { type: 'json_schema', name: 'fragment', schema, strict: true } } };

  try {
    const resp = await withTimeout(fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(baseReq),
    }), 45_000, 'OpenAI Responses');
    const body = await resp.json();
    if (!resp.ok) throw new Error(body?.error?.message || `OpenAI error ${resp.status}`);
    const parsed = extractStructured<T>(body);
    const incomplete = body?.status === 'incomplete' || !!body?.incomplete_details;
    if (parsed && !incomplete) return parsed;
  } catch {}

  try {
    const tightReq = { ...baseReq, max_output_tokens: Math.max(700, Math.floor(maxTokens * 0.8)),
      instructions: baseReq.instructions + ' Reply ONLY with valid JSON. Keep wording compact.' };
    const resp2 = await withTimeout(fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(tightReq),
    }), 55_000, 'OpenAI Responses(tight)');
    const body2 = await resp2.json();
    if (!resp2.ok) throw new Error(body2?.error?.message || `OpenAI error ${resp2.status}`);
    const parsed2 = extractStructured<T>(body2);
    if (parsed2) return parsed2;
  } catch {}

  const chatReq = {
    model: OPENAI_MODEL, temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: { name: 'fragment', schema, strict: true } },
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: input },
      { role: 'system', content: 'Reply ONLY with a single JSON object matching the schema.' },
    ],
    max_tokens: Math.ceil(maxTokens * 1.1),
  };

  const chatResp = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(chatReq),
  }), 55_000, 'OpenAI Chat');
  const chatBody = await chatResp.json();
  if (!chatResp.ok) throw new Error(chatBody?.error?.message || `OpenAI chat error ${chatResp.status}`);
  const parsedChat = extractStructured<T>(chatBody);
  if (!parsedChat) throw new Error('No model output');
  return parsedChat;
}

const sharedNameNote =
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon. Do NOT correct, substitute, or question it. You MAY suggest a more widely used COMMON name if clearly appropriate.';

const makeInput = (commonName?: string | null, scientificName?: string | null) => {
  const norm = (s?: string | null) => (s?.trim() ? s.trim() : '(unknown)');
  return `Provided common name: ${norm(commonName)}
Scientific name (canonical): ${norm(scientificName)}
Write in a neutral, factual tone. Keep paragraphs short.`;
};

// ----- Schemas (only the two we keep) -----
const SCHEMA_NAME_ONLY = {
  type: 'object',
  additionalProperties: false,
  properties: { suggested_common_name: { type: ['string', 'null'] } },
  required: ['suggested_common_name'],
} as const;

const SCHEMA_DESC_META = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string', maxLength: 900 },
    rarity_level: { type: 'string', enum: ['unknown', 'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare'] },
    availability_status: { type: 'string', enum: ['unknown', 'not_in_trade', 'rarely_available', 'seasonal', 'commonly_available'] },
  },
  required: ['description', 'rarity_level', 'availability_status'],
} as const;

const AVAIL = { unknown:'unknown', not_in_trade:'not_in_trade', rarely_available:'rarely_available', seasonal:'seasonal', commonly_available:'commonly_available' } as const;
const RARITY = { unknown:'unknown', common:'common', uncommon:'uncommon', rare:'rare', very_rare:'very_rare', ultra_rare:'ultra_rare' } as const;

export function useGeneratePlantFacts() {
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<Result | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const run = useCallback(async ({ plantsTableId, commonName, scientificName }: Args) => {
    setLoading(true); setError(null);
    try {
      const pre = (await supabase
        .from('plants')
        .select('id, plant_name, description, availability, rarity')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{ id:string; plant_name:string|null; description:string|null; availability:Availability|null; rarity:Rarity|null }>;
      if (pre.error) throw pre.error;
      const db = pre.data;

      const hasDesc   = !!db?.description?.trim();
      const hasAvail  = !!db?.availability;
      const hasRarity = !!db?.rarity;
      const hasName   = !!db?.plant_name?.trim();

      const nameOnly = await openAIJson<{ suggested_common_name: string | null }>(
        SCHEMA_NAME_ONLY,
        ['You are a precise botany writer.', sharedNameNote, 'Return only JSON.'].join(' '),
        makeInput(db?.plant_name || commonName, scientificName),
        200
      );

      const toTitle = (s: string) => s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      const nameToSet = !hasName ? toTitle(nameOnly.suggested_common_name?.trim() || (commonName?.trim() ?? '')) : '';

      let descMeta: { description: string; availability_status: Availability; rarity_level: Rarity } | null = null;
      if (!hasDesc || !hasAvail || !hasRarity) {
        const descMetaInstr = [
          'You are a precise botany writer.',
          sharedNameNote,
          'Output MUST match the JSON schema exactly.',
          'description: exactly two SHORT paragraphs about the plant itself (morphology, habitat, taxonomy). No care tips.',
          'Return JSON only.',
        ].join(' ');
        descMeta = await openAIJson<{ description:string; availability_status:Availability; rarity_level:Rarity }>(
          SCHEMA_DESC_META,
          descMetaInstr,
          makeInput(db?.plant_name || commonName, scientificName),
          900
        );
      }

      const payload: Record<string, any> = {};
      if (nameToSet) payload.plant_name = nameToSet;
      if (descMeta) {
        payload.description = descMeta.description;
        payload.availability = AVAIL[descMeta.availability_status] ?? 'unknown';
        payload.rarity = RARITY[descMeta.rarity_level] ?? 'unknown';
      }

      if (Object.keys(payload).length > 0) {
        let upd = await withTimeout<SBResp>(supabase.from('plants').update(payload).eq('id', plantsTableId) as any, 15_000, 'Supabase update(plants)');
        if (upd.error && payload.plant_name) {
          const { plant_name, ...rest } = payload;
          upd = await withTimeout<SBResp>(supabase.from('plants').update(rest).eq('id', plantsTableId) as any, 15_000, 'Supabase update(plants, retryWithoutName)');
        }
        if (upd.error) throw upd.error;
      }

      const final: Result = {
        description: (descMeta?.description ?? db?.description ?? '') as string,
        availability_status: (descMeta?.availability_status ?? db?.availability ?? 'unknown') as Availability,
        rarity_level: (descMeta?.rarity_level ?? db?.rarity ?? 'unknown') as Rarity,
        suggested_common_name: nameOnly.suggested_common_name ? toTitle(nameOnly.suggested_common_name) : null,
      };
      setData(final);
      return final;
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate plant facts');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, run };
}
