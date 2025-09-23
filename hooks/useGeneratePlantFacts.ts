// hooks/useGeneratePlantFacts.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY } from '@env';

// ================== Config ==================
const OPENAI_MODEL = 'gpt-4.1-mini';

// ================== Types ===================
type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available';
type Rarity       = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare';

type Difficulty = 'easy' | 'moderate' | 'challenging' | 'very_challenging';
type PropTechnique = {
  method: string;       // normalized later to: cuttings | division | leaf | offsets | seed | air_layering
  difficulty: Difficulty;
  description: string;
};

type Result = {
  description: string;
  availability_status: Availability;
  rarity_level: Rarity;
  propagation_techniques: PropTechnique[];
  soil_description: string;
  suggested_common_name: string | null; // always computed by the "name" query
};

type Args = {
  plantsTableId: string;
  commonName?: string | null;     // current display/common name from UI (may be nickname)
  scientificName?: string | null; // canonical, do not “correct”
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

// ========= Availability/Rarity maps =========
const AVAIL: Record<Availability, Availability> = {
  unknown: 'unknown',
  not_in_trade: 'not_in_trade',
  rarely_available: 'rarely_available',
  seasonal: 'seasonal',
  commonly_available: 'commonly_available',
};
const RARITY: Record<Rarity, Rarity> = {
  unknown: 'unknown',
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  very_rare: 'very_rare',
  ultra_rare: 'ultra_rare',
};

// ======= Normalize method label to canonical set =======
type CanonMethod = 'cuttings' | 'division' | 'leaf' | 'offsets' | 'seed' | 'air_layering';
function normalizeMethodLabel(raw: string): CanonMethod {
  const k = raw.trim().toLowerCase();
  if (k.includes('air')) return 'air_layering';
  if (k.includes('leaf')) return 'leaf';
  if (k.includes('division') || k.includes('divide') || k.includes('rhizome')) return 'division';
  if (k.includes('offset') || k.includes('pup')) return 'offsets';
  if (k.includes('seed')) return 'seed';
  return 'cuttings';
}

// ================== Schemas =================
// (A) Common-name-only (always run)
const SCHEMA_NAME_ONLY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggested_common_name: {
      type: ['string', 'null'],
      description:
        'Return a more widely used common name if one clearly exists. Return null if the provided common name is already best.'
    },
  },
  required: ['suggested_common_name']
} as const;

// (B) Description + meta (conditional)
const SCHEMA_DESC_META = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: {
      type: 'string',
      maxLength: 900,
      description:
        'Exactly two concise paragraphs about the plant itself (morphology, habitat, taxonomy). No care/cultivation tips.'
    },
    rarity_level: {
      type: 'string',
      enum: ['unknown', 'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare']
    },
    availability_status: {
      type: 'string',
      enum: ['unknown', 'not_in_trade', 'rarely_available', 'seasonal', 'commonly_available']
    },
  },
  required: ['description', 'rarity_level', 'availability_status']
} as const;

// (C) Propagation (conditional)
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
          description: { type: 'string', maxLength: 500 }
        }
      }
    }
  },
  required: ['propagation_techniques']
} as const;

// (D) Soil (conditional)
const SCHEMA_SOIL = {
  type: 'object',
  additionalProperties: false,
  properties: {
    soil_description: {
      type: 'string',
      maxLength: 500,
      description: 'One concise paragraph describing ideal soil properties and a best-practice mix.'
    }
  },
  required: ['soil_description']
} as const;

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
      max_output_tokens: Math.max(700, Math.floor(maxTokens * 0.8)),
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
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon. Do NOT correct, substitute, or question it. You MAY suggest a more widely used COMMON name if clearly appropriate.';

const makeInput = (commonName?: string | null, scientificName?: string | null) => {
  const norm = (s?: string | null) => (s?.trim() ? s.trim() : '(unknown)');
  return `Provided common name: ${norm(commonName)}
Scientific name (canonical): ${norm(scientificName)}
Write in a neutral, factual tone. Keep paragraphs short.`;
};

// ================== Hook ====================
export function useGeneratePlantFacts() {
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<Result | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const run = useCallback(async ({ plantsTableId, commonName, scientificName }: Args) => {
    setLoading(true);
    setError(null);

    try {
      // Read current DB state up-front
      const pre = (await supabase
        .from('plants')
        .select('id, plant_name, description, availability, rarity, soil_description, propagation_methods_json')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{
          id: string;
          plant_name: string | null;
          description: string | null;
          availability: Availability | null;
          rarity: Rarity | null;
          soil_description: string | null;
          propagation_methods_json: { method: CanonMethod; difficulty: Difficulty; description: string }[] | null;
        }>;

      if (pre.error) throw pre.error;
      const db = pre.data;

      const hasDesc   = !!db?.description?.trim();
      const hasAvail  = !!db?.availability;
      const hasRarity = !!db?.rarity;
      const hasSoil   = !!db?.soil_description?.trim();
      const hasProp   = Array.isArray(db?.propagation_methods_json) && db!.propagation_methods_json!.length > 0;
      const hasName   = !!db?.plant_name?.trim();

      // Always run the common-name suggestion query
      const nameInstr = [
        'You are a precise botany writer.',
        sharedNameNote,
        'Return only JSON.',
        'For `suggested_common_name`:',
        '- If the provided common name is already the most widely used / best option for this species, return null.',
        '- Otherwise, return a single alternative common name string that is clearly more widely used.',
      ].join(' ');
      const nameOnly = await openAIJson<{ suggested_common_name: string | null }>(
        SCHEMA_NAME_ONLY,
        nameInstr,
        makeInput(db?.plant_name || commonName, scientificName),
        200
      );

      // If DB lacks plant_name, auto-set it:
      const toTitle = (s: string) => s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      const nameToSet =
        !hasName
          ? toTitle(nameOnly.suggested_common_name?.trim() || (commonName?.trim() ?? ''))
          : '';

      // Conditionally run the other 3 queries
      let descMeta:
        | { description: string; availability_status: Availability; rarity_level: Rarity }
        | null = null;
      if (!hasDesc || !hasAvail || !hasRarity) {
        const descMetaInstr = [
          'You are a precise botany writer.',
          sharedNameNote,
          'Output MUST match the JSON schema exactly.',
          'description: exactly two SHORT paragraphs about the plant itself (morphology, habitat, taxonomy). No care tips.',
          'Return JSON only.',
        ].join(' ');
        descMeta = await openAIJson<{ description: string; availability_status: Availability; rarity_level: Rarity }>(
          SCHEMA_DESC_META,
          descMetaInstr,
          makeInput(db?.plant_name || commonName, scientificName),
          900
        );
      }

      let propData: { propagation_techniques: PropTechnique[] } | null = null;
      if (!hasProp) {
        const propInstr = [
          'You are a precise botany writer.',
          sharedNameNote,
          'Output MUST match the JSON schema exactly and return ONLY JSON.',
          'Write techniques SPECIFIC to THIS species (not generic how-to for the method).',
          'For EACH technique:',
          '- Mention the scientific name or its genus once.',
          '- Refer to at least one relevant anatomical organ (e.g., node, rhizome, stolon, pseudobulb, tuber, offset, crown) and tie the cut/division to that organ.',
          '- Include concrete counts/sizes/timings if applicable (e.g., 2–3 nodes, 1–2 cm segments, callus in 10–14 days).',
          "- Avoid boilerplate openings like 'To propagate, simply…' and avoid care tips.",
          'Only include realistic methods for THIS species; omit seeds unless the species commonly sets viable seed.',
          'One compact, actionable paragraph per technique. 1–3 techniques total.',
        ].join(' ');

        propData = await openAIJson<{ propagation_techniques: PropTechnique[] }>(
          SCHEMA_PROPAGATION,
          propInstr,
          makeInput(db?.plant_name || commonName, scientificName),
          800
        );
      }

      let soilData: { soil_description: string } | null = null;
      if (!hasSoil) {
        const soilInstr = [
          'You are a precise botany writer.',
          sharedNameNote,
          'Output MUST match the JSON schema exactly.',
          'One concise paragraph describing ideal soil properties and a best-practice mix.',
          'Return JSON only.',
        ].join(' ');
        soilData = await openAIJson<{ soil_description: string }>(
          SCHEMA_SOIL,
          soilInstr,
          makeInput(db?.plant_name || commonName, scientificName),
          600
        );
      }

      // Build payload ONLY with fields we need to (and are allowed to) update
      const payload: Record<string, any> = {};
      if (nameToSet) payload.plant_name = nameToSet;

      if (descMeta) {
        payload.description = descMeta.description;
        payload.availability = AVAIL[descMeta.availability_status] ?? 'unknown';
        payload.rarity = RARITY[descMeta.rarity_level] ?? 'unknown';
      }
      if (propData) {
        payload.propagation_methods_json = (propData.propagation_techniques || []).map(t => ({
          method: normalizeMethodLabel(t.method),
          difficulty: t.difficulty,
          description: t.description,
        }));
      }
      if (soilData) {
        payload.soil_description = soilData.soil_description;
      }

      // If nothing to update (e.g., all fields present and plant_name exists), just return merged result
      if (Object.keys(payload).length > 0) {
        let upd = await withTimeout<SBResp>(
          supabase.from('plants').update(payload).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
          15_000,
          'Supabase update(plants)'
        );

        // If setting plant_name fails for any reason, retry once without it
        if (upd.error && payload.plant_name) {
          const { plant_name, ...withoutName } = payload;
          upd = await withTimeout<SBResp>(
            supabase.from('plants').update(withoutName).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
            15_000,
            'Supabase update(plants, retryWithoutName)'
          );
        }
        if (upd.error) throw upd.error;
      }

      // Compose final result using latest known values (DB values if existing, otherwise model outputs)
      const final: Result = {
        description: (descMeta?.description ?? db?.description ?? '') as string,
        availability_status: (descMeta?.availability_status ?? db?.availability ?? 'unknown') as Availability,
        rarity_level: (descMeta?.rarity_level ?? db?.rarity ?? 'unknown') as Rarity,
        propagation_techniques: (propData?.propagation_techniques ??
          (db?.propagation_methods_json as unknown as PropTechnique[]) ??
          []) as PropTechnique[],
        soil_description: (soilData?.soil_description ?? db?.soil_description ?? '') as string,
        // Always surface the suggestion (may be null); UI can prompt if DB already has a different name
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
