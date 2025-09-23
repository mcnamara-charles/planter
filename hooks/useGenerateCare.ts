// hooks/useGenerateCare.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY } from '@env';

// ================== Config ==================
const OPENAI_MODEL = 'gpt-4.1-mini';

// ================== Types ===================
type CareResult = {
  care_light: string;
  care_water: string;
  care_temp_humidity: string;
  care_fertilizer: string;
  care_pruning: string;
};

type Args = {
  plantsTableId: string;
  commonName?: string | null;
  scientificName?: string | null; // canonical, do not correct
};

// =============== Tiny helpers ===============
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

// =============== JSON parsing ===============
function looksLikeJson(s: string) {
  if (!s) return false;
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}
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
      if (Array.isArray(c?.annotations)) {
        for (const a of c.annotations) { if (typeof a?.text === 'string') { const fx = firstJsonIn(a.text); if (fx) return fx as T; } }
      }
    }
  }
  if (typeof json?.output_text === 'string') { const fx = firstJsonIn(json.output_text); if (fx) return fx as T; }
  const cmsg = json?.choices?.[0]?.message;
  if (typeof cmsg?.content === 'string') { const fx = firstJsonIn(cmsg.content); if (fx) return fx as T; }
  if (Array.isArray(cmsg?.content)) {
    for (const part of cmsg.content) { if (typeof part?.text === 'string') { const fx = firstJsonIn(part.text); if (fx) return fx as T; } }
  }
  return null;
}

// ========== OpenAI minimal helper ==========
async function openAIJson<T>(
  schema: any,
  instructions: string,
  input: string,
  maxTokens: number
): Promise<T> {
  const baseReq = {
    model: OPENAI_MODEL,
    instructions,
    input,
    temperature: 0.1,
    max_output_tokens: maxTokens,
    text: { format: { type: 'json_schema', name: 'fragment', schema, strict: true } },
  };

  // Try Responses API
  try {
    const resp = await withTimeout(
      fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(baseReq),
      }),
      45_000,
      'OpenAI Responses'
    );
    const body = await resp.json();
    if (!resp.ok) throw new Error(body?.error?.message || `OpenAI error ${resp.status}`);
    const parsed = extractStructured<T>(body);
    const incomplete = body?.status === 'incomplete' || !!body?.incomplete_details;
    if (parsed && !incomplete) return parsed;
  } catch (_) { /* fall through */ }

  // Retry tighter
  try {
    const tightReq = {
      ...baseReq,
      max_output_tokens: Math.max(600, Math.floor(maxTokens * 0.8)),
      instructions: baseReq.instructions + ' Reply ONLY with valid JSON. Keep wording compact.',
    };
    const resp2 = await withTimeout(
      fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tightReq),
      }),
      55_000,
      'OpenAI Responses(tight)'
    );
    const body2 = await resp2.json();
    if (!resp2.ok) throw new Error(body2?.error?.message || `OpenAI error ${resp2.status}`);
    const parsed2 = extractStructured<T>(body2);
    if (parsed2) return parsed2;
  } catch (_) { /* fall through */ }

  // Chat fallback
  const chatReq = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: { name: 'fragment', schema, strict: true } },
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: input },
      { role: 'system', content: 'Reply ONLY with a single JSON object matching the schema.' },
    ],
    max_tokens: Math.ceil(maxTokens * 1.1),
  };

  const chatResp = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatReq),
    }),
    55_000,
    'OpenAI Chat'
  );
  const chatBody = await chatResp.json();
  if (!chatResp.ok) throw new Error(chatBody?.error?.message || `OpenAI chat error ${chatResp.status}`);
  const parsedChat = extractStructured<T>(chatBody);
  if (!parsedChat) throw new Error('No model output');
  return parsedChat;
}

const sharedNameNote =
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon. Do NOT correct, substitute, or question it. You MAY use or suggest a more widely used COMMON name, but do not alter the scientific name.';

const makeInput = (commonName?: string | null, scientificName?: string | null) => {
  const norm = (s?: string | null) => (s?.trim() ? s.trim() : '(unknown)');
  return `Provided common name: ${norm(commonName)}
Scientific name (canonical): ${norm(scientificName)}
Write in a neutral, factual tone. Keep paragraphs short.`;
};

// ================== Schemas =================
const SCHEMA_LIGHT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    care_light: {
      type: 'string',
      maxLength: 500,
      description: 'Exactly three sentences on light: ideal intensity/placement, risks of too much/too little, seasonal or indoor positioning nuance.'
    }
  },
  required: ['care_light']
} as const;

const SCHEMA_WATER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    care_water: {
      type: 'string',
      maxLength: 800,
      description: 'One concise paragraph on watering only (frequency cues, soil dryness cues, potting considerations). Do NOT discuss humidity.'
    }
  },
  required: ['care_water']
} as const;

const SCHEMA_TEMP_HUM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    care_temp_humidity: {
      type: 'string',
      maxLength: 800,
      description: 'One paragraph: thriving temperature range and humidity range, and thresholds where cold/heat or low/high humidity cause damage (give numbers).'
    }
  },
  required: ['care_temp_humidity']
} as const;

const SCHEMA_FERT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    care_fertilizer: {
      type: 'string',
      maxLength: 400,
      description: 'Two sentences: fertilizer type/NPK or formulation, dilution/concentration, frequency/seasonality.'
    }
  },
  required: ['care_fertilizer']
} as const;

const SCHEMA_PRUNE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    care_pruning: {
      type: 'string',
      maxLength: 500,
      description: 'Two to three sentences: when to prune, why (shape, vigor, flowering), and how (where to cut) for this species.'
    }
  },
  required: ['care_pruning']
} as const;

// ================== Hook ====================
export function useGenerateCare() {
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<CareResult | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const run = useCallback(async ({ plantsTableId, commonName, scientificName }: Args) => {
    setLoading(true);
    setError(null);

    try {
      // Try to read existing values (skip if columns don’t exist)
      let db: {
        id: string;
        care_light?: string | null;
        care_water?: string | null;
        care_temp_humidity?: string | null;
        care_fertilizer?: string | null;
        care_pruning?: string | null;
        plant_name?: string | null;
      } | null = null;

      let hasLight = false, hasWater = false, hasTH = false, hasFert = false, hasPrune = false;

      try {
        const pre = (await supabase
          .from('plants')
          .select('id, plant_name, care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning')
          .eq('id', plantsTableId)
          .maybeSingle()) as SBResp<typeof db>;
        if (pre.error) throw pre.error;

        type CareCols = {
            care_light?: string | null;
            care_water?: string | null;
            care_temp_humidity?: string | null;
            care_fertilizer?: string | null;
            care_pruning?: string | null;
        };
        
        db = pre.data;
        const care = (db ?? {}) as CareCols;

        hasLight = !!care.care_light?.trim();
        hasWater = !!care.care_water?.trim();
        hasTH    = !!care.care_temp_humidity?.trim();
        hasFert  = !!care.care_fertilizer?.trim();
        hasPrune = !!care.care_pruning?.trim();
      } catch {
        // Columns might not exist; continue with null db and generate everything.
        db = { id: plantsTableId, plant_name: commonName ?? null };
      }

      const baseInput = makeInput(db?.plant_name || commonName, scientificName);

      // 1) Light — exactly 3 sentences
      const lightInstr = [
        'You are a precise botany/cultivation writer.',
        sharedNameNote,
        'Return ONLY JSON.',
        'Exactly three sentences describing light for THIS species:',
        '- sentence 1: ideal light intensity/placement (indoors or outdoors as typical).',
        '- sentence 2: risks of too little or too much.',
        '- sentence 3: any seasonal/window-direction nuance or acclimation notes.',
      ].join(' ');
      const light = hasLight ? { care_light: db!.care_light! } :
        await openAIJson<{ care_light: string }>(SCHEMA_LIGHT, lightInstr, baseInput, 300);

      // 2) Water — one paragraph, no humidity
      const waterInstr = [
        'You are a precise botany/cultivation writer.',
        sharedNameNote,
        'Return ONLY JSON.',
        'One concise paragraph explaining how to water THIS species.',
        'Include substrate moisture cues, potting/drainage considerations, and seasonal adjustments.',
        'Do NOT discuss humidity in this section.',
      ].join(' ');
      const water = hasWater ? { care_water: db!.care_water! } :
        await openAIJson<{ care_water: string }>(SCHEMA_WATER, waterInstr, baseInput, 500);

      // 3) Temperature & Humidity — one paragraph with numeric ranges + thresholds
      const thInstr = [
        'You are a precise botany/cultivation writer.',
        sharedNameNote,
        'Return ONLY JSON.',
        'One paragraph for THIS species with:',
        '- a thriving temperature range (°C/°F ok to pick one, but be consistent),',
        '- a thriving relative humidity range (%), and',
        '- explicit thresholds where cold/heat or low/high humidity cause stress/damage.',
      ].join(' ');
      const th = hasTH ? { care_temp_humidity: db!.care_temp_humidity! } :
        await openAIJson<{ care_temp_humidity: string }>(SCHEMA_TEMP_HUM, thInstr, baseInput, 550);

      // 4) Fertilizer — two sentences
      const fertInstr = [
        'You are a precise botany/cultivation writer.',
        sharedNameNote,
        'Return ONLY JSON.',
        'Two sentences on fertilizer for THIS species:',
        '- sentence 1: recommended fertilizer type or NPK/formulation and dilution/concentration.',
        '- sentence 2: frequency and seasonal timing; note when to pause.',
      ].join(' ');
      const fert = hasFert ? { care_fertilizer: db!.care_fertilizer! } :
        await openAIJson<{ care_fertilizer: string }>(SCHEMA_FERT, fertInstr, baseInput, 300);

      // 5) Pruning — 2–3 sentences
      const pruneInstr = [
        'You are a precise botany/cultivation writer.',
        sharedNameNote,
        'Return ONLY JSON.',
        'Two to three sentences on pruning THIS species: when, why (shape, vigor, flowering), and how (where to cut).',
        'Avoid generic advice; tie guidance to plant form where known.',
      ].join(' ');
      const prune = hasPrune ? { care_pruning: db!.care_pruning! } :
        await openAIJson<{ care_pruning: string }>(SCHEMA_PRUNE, pruneInstr, baseInput, 350);

      const result: CareResult = {
        care_light: light.care_light,
        care_water: water.care_water,
        care_temp_humidity: th.care_temp_humidity,
        care_fertilizer: fert.care_fertilizer,
        care_pruning: prune.care_pruning,
      };

      // Try to persist if any were missing originally
      const needsUpdate = !hasLight || !hasWater || !hasTH || !hasFert || !hasPrune;
      if (needsUpdate) {
        try {
          const payload: Record<string,string> = {};
          if (!hasLight) payload.care_light = result.care_light;
          if (!hasWater) payload.care_water = result.care_water;
          if (!hasTH)    payload.care_temp_humidity = result.care_temp_humidity;
          if (!hasFert)  payload.care_fertilizer = result.care_fertilizer;
          if (!hasPrune) payload.care_pruning = result.care_pruning;

          if (Object.keys(payload).length > 0) {
            const upd = await withTimeout<SBResp>(
              supabase.from('plants').update(payload).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
              15_000,
              'Supabase update(plants care)'
            );
            // If table/columns don’t exist, ignore and continue returning the data
            // (upd.error?.message may include 'column ... does not exist')
          }
        } catch {
          // swallow; we still return the generated care data
        }
      }

      setData(result);
      return result;

    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate care info');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, run };
}
