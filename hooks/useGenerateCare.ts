// hooks/useGenerateCare.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY } from '@env';

// ================== Config ==================
const OPENAI_MODEL = 'gpt-4.1-mini';

// ================== Types ===================
type Difficulty = 'easy' | 'moderate' | 'challenging' | 'very_challenging';
type CanonMethod = 'cuttings' | 'division' | 'leaf' | 'offsets' | 'seed' | 'air_layering';

type CareResult = {
  care_light: string;
  care_water: string;
  care_temp_humidity: string;
  care_fertilizer: string;
  care_pruning: string;
  // Additional (moved from facts):
  soil_description?: string;
  propagation_techniques?: { method: CanonMethod; difficulty: Difficulty; description: string }[];
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
// Care
const SCHEMA_LIGHT     = { type:'object', additionalProperties:false, properties:{ care_light:{ type:'string', maxLength:500 } }, required:['care_light'] } as const;
const SCHEMA_WATER     = { type:'object', additionalProperties:false, properties:{ care_water:{ type:'string', maxLength:800 } }, required:['care_water'] } as const;
const SCHEMA_TEMP_HUM  = { type:'object', additionalProperties:false, properties:{ care_temp_humidity:{ type:'string', maxLength:800 } }, required:['care_temp_humidity'] } as const;
const SCHEMA_FERT      = { type:'object', additionalProperties:false, properties:{ care_fertilizer:{ type:'string', maxLength:400 } }, required:['care_fertilizer'] } as const;
const SCHEMA_PRUNE     = { type:'object', additionalProperties:false, properties:{ care_pruning:{ type:'string', maxLength:500 } }, required:['care_pruning'] } as const;

// NEW: Soil + Propagation
const SCHEMA_SOIL = {
  type: 'object',
  additionalProperties: false,
  properties: {
    soil_description: { type: 'string', maxLength: 500 }
  },
  required: ['soil_description']
} as const;

const SCHEMA_PROPAGATION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    propagation_techniques: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['method', 'difficulty', 'description'],
        properties: {
          method: { type: 'string', minLength: 2, maxLength: 60 },
          difficulty: { type: 'string', enum: ['easy', 'moderate', 'challenging', 'very_challenging'] },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
  required: ['propagation_techniques'],
} as const;

function normalizeMethodLabel(raw: string): CanonMethod {
  const k = raw.trim().toLowerCase();
  if (k.includes('air')) return 'air_layering';
  if (k.includes('leaf')) return 'leaf';
  if (k.includes('division') || k.includes('divide') || k.includes('rhizome')) return 'division';
  if (k.includes('offset') || k.includes('pup')) return 'offsets';
  if (k.includes('seed')) return 'seed';
  return 'cuttings';
}

// ================== Hook ====================
export function useGenerateCare() {
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<CareResult | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const run = useCallback(async ({ plantsTableId, commonName, scientificName }: Args) => {
    setLoading(true);
    setError(null);

    try {
      // Read existing columns we care about
      const pre = (await supabase
        .from('plants')
        .select('id, plant_name, care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning, soil_description, propagation_methods_json')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{
          id: string;
          plant_name: string | null;
          care_light: string | null;
          care_water: string | null;
          care_temp_humidity: string | null;
          care_fertilizer: string | null;
          care_pruning: string | null;
          soil_description: string | null;
          propagation_methods_json: { method: CanonMethod; difficulty: Difficulty; description: string }[] | null;
        }>;
      if (pre.error) throw pre.error;
      const db = pre.data || null;

      const hasLight = !!db?.care_light?.trim();
      const hasWater = !!db?.care_water?.trim();
      const hasTH    = !!db?.care_temp_humidity?.trim();
      const hasFert  = !!db?.care_fertilizer?.trim();
      const hasPrune = !!db?.care_pruning?.trim();
      const hasSoil  = !!db?.soil_description?.trim();
      const hasProp  = Array.isArray(db?.propagation_methods_json) && db!.propagation_methods_json!.length > 0;

      const baseInput = makeInput(db?.plant_name || commonName, scientificName);

      // --- Care blocks ---
      const light = hasLight ? { care_light: db!.care_light! } :
        await openAIJson<{ care_light: string }>(
          SCHEMA_LIGHT,
          [
            'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
            'Exactly three sentences on species-specific light: ideal placement, risks of too little/too much, seasonal/window nuance.'
          ].join(' '),
          baseInput, 300);

      const water = hasWater ? { care_water: db!.care_water! } :
        await openAIJson<{ care_water: string }>(
          SCHEMA_WATER,
          [
            'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
            'One concise paragraph on watering THIS species; include moisture cues and drainage. No humidity talk.'
          ].join(' '),
          baseInput, 500);

      const th = hasTH ? { care_temp_humidity: db!.care_temp_humidity! } :
        await openAIJson<{ care_temp_humidity: string }>(
          SCHEMA_TEMP_HUM,
          [
            'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
            'One paragraph with numeric temp range, RH range, and damage thresholds for THIS species.'
          ].join(' '),
          baseInput, 550);

      const fert = hasFert ? { care_fertilizer: db!.care_fertilizer! } :
        await openAIJson<{ care_fertilizer: string }>(
          SCHEMA_FERT,
          [
            'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
            'Two sentences: formulation/dilution, then frequency/seasonality.'
          ].join(' '),
          baseInput, 300);

      const prune = hasPrune ? { care_pruning: db!.care_pruning! } :
        await openAIJson<{ care_pruning: string }>(
          SCHEMA_PRUNE,
          [
            'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
            '2–3 sentences: when/why/how to prune THIS species; tie to plant form.'
          ].join(' '),
          baseInput, 350);

      // --- Soil (moved here) ---
      const soil = hasSoil ? { soil_description: db!.soil_description! } :
        await openAIJson<{ soil_description: string }>(
          SCHEMA_SOIL,
          [
            'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
            'One paragraph: ideal soil properties + best-practice mix for THIS species.'
          ].join(' '),
          baseInput, 600);

      // --- Propagation (moved here) ---
      let prop: { propagation_techniques: { method: string; difficulty: Difficulty; description: string }[] } | null = null;
      if (hasProp) {
        prop = { propagation_techniques: db!.propagation_methods_json! };
      } else {
        const propInstr = [
          'You are a precise botany writer.', sharedNameNote,
          'Output MUST match the JSON schema exactly and return ONLY JSON.',
          'Techniques MUST be realistic for THIS species; include concrete anatomy cues and counts/timings.',
          'One compact paragraph per technique; 1–3 techniques total.'
        ].join(' ');
        prop = await openAIJson(SCHEMA_PROPAGATION, propInstr, baseInput, 800);
      }

      // Compose result
      const result: CareResult = {
        care_light: light.care_light,
        care_water: water.care_water,
        care_temp_humidity: th.care_temp_humidity,
        care_fertilizer: fert.care_fertilizer,
        care_pruning: prune.care_pruning,
        soil_description: soil.soil_description,
        propagation_techniques: (prop?.propagation_techniques || []).map(t => ({
          method: normalizeMethodLabel(t.method),
          difficulty: t.difficulty,
          description: t.description,
        })),
      };

      // Persist any newly generated fields
      const payload: Record<string, any> = {};
      if (!hasLight) payload.care_light = result.care_light;
      if (!hasWater) payload.care_water = result.care_water;
      if (!hasTH)    payload.care_temp_humidity = result.care_temp_humidity;
      if (!hasFert)  payload.care_fertilizer = result.care_fertilizer;
      if (!hasPrune) payload.care_pruning = result.care_pruning;
      if (!hasSoil)  payload.soil_description = result.soil_description;
      if (!hasProp)  payload.propagation_methods_json = result.propagation_techniques;

      if (Object.keys(payload).length > 0) {
        try {
          await withTimeout<SBResp>(
            supabase.from('plants').update(payload).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
            15_000,
            'Supabase update(plants care+extras)'
          );
        } catch {
          // swallow; still return result to UI
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
