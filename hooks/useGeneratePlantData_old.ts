// hooks/useGeneratePlantData.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY } from '@env';
import { computeForcedFieldsSince, CURRENT_RULESET_VERSION } from '@/utils/lib/plantRuleset';

const OPENAI_MODEL = 'gpt-4.1-mini';

// ================== Types ===================
type Difficulty = 'easy' | 'moderate' | 'challenging' | 'very_challenging';
type CanonMethod = 'cuttings' | 'division' | 'leaf' | 'offsets' | 'seed' | 'air_layering';
type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available';
type Rarity       = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare';

type FactsResult = {
  description: string;
  availability_status: Availability;
  rarity_level: Rarity;
  suggested_common_name: string | null;
};

type CareResult = {
  care_light: string;
  care_water: string;
  care_temp_humidity: string;
  care_fertilizer: string;
  care_pruning: string;
  soil_description?: string;
  propagation_techniques?: { method: CanonMethod; difficulty: Difficulty; description: string }[];
};

type RowShape = {
  id: string;
  plant_name: string | null;
  description: string | null;
  availability: Availability | null;
  rarity: Rarity | null;
  care_light: string | null;
  care_water: string | null;
  care_temp_humidity: string | null;
  care_fertilizer: string | null;
  care_pruning: string | null;
  soil_description: string | null;
  propagation_methods_json: { method: CanonMethod; difficulty: Difficulty; description: string }[] | null;
  data_response_version: number | null;
};

type CombinedResult = FactsResult & CareResult;

type Args = {
  plantsTableId: string;
  commonName?: string | null;
  scientificName?: string | null;
};

// Progress reporting
type StageKey =
  | 'db_read'
  | 'facts_generation'
  | 'facts_db_write'
  | 'profile'
  | 'care_light'
  | 'care_water'
  | 'care_temp_humidity'
  | 'care_fertilizer'
  | 'care_pruning'
  | 'care_soil_description'
  | 'care_propagation'
  | 'care_db_write'
  | 'done';

const STAGE_ORDER: StageKey[] = [
  'db_read',
  'facts_generation',
  'facts_db_write',
  'profile',
  'care_light',
  'care_water',
  'care_temp_humidity',
  'care_fertilizer',
  'care_pruning',
  'care_soil_description',
  'care_propagation',
  'care_db_write',
  'done',
];

const STAGE_LABELS: Record<StageKey, string> = {
  db_read: 'Reading plant record',
  facts_generation: 'Generating plant facts',
  facts_db_write: 'Saving plant facts',
  profile: 'Building species profile',
  care_light: 'Generating lighting requirements',
  care_water: 'Generating watering schedule',
  care_temp_humidity: 'Generating temp & humidity',
  care_fertilizer: 'Generating fertilizer plan',
  care_pruning: 'Generating pruning guidance',
  care_soil_description: 'Generating soil & mix',
  care_propagation: 'Generating propagation',
  care_db_write: 'Saving care details',
  done: 'Finished',
};

type ProgressStatus = 'pending' | 'running' | 'success' | 'error';

type ProgressEvent = {
  key: StageKey;
  label: string;
  status: ProgressStatus;
  startedAt?: number;
  endedAt?: number;
  percent?: number;
};

type SBErr = { message: string; code?: string; details?: string; hint?: string } | null;
type SBResp<T = any> = { data: T | null; error: SBErr; status?: number };

// ================== Utils ===================
async function withTimeout<T>(p: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([Promise.resolve(p), timeout]); } finally { clearTimeout(timer); }
}

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

async function openAIJson<T = any>(
  schema: Record<string, any>,
  instruction: string,
  input: string,
  timeoutMs = 30000,
  maxOutputTokens = 900
): Promise<T> {
  const baseReq = {
    model: OPENAI_MODEL,
    instructions: instruction,
    input,
    temperature: 0.1,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: 'fragment', schema, strict: true } }
  };

  // Responses API
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

  // Tighter retry
  try {
    const tightReq = { ...baseReq, max_output_tokens: Math.max(600, Math.floor(maxOutputTokens * 0.8)),
      instructions: baseReq.instructions + ' Reply ONLY with valid JSON. Keep wording compact.' };
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
    model: OPENAI_MODEL, temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: { name: 'fragment', schema, strict: true } },
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: input },
      { role: 'system', content: 'Reply ONLY with a single JSON object matching the schema.' },
    ],
    max_tokens: Math.ceil(maxOutputTokens * 1.1),
  };

  const chatResp = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(chatReq),
  }), timeoutMs + 10000, 'OpenAI Chat');
  const chatBody = await chatResp.json();
  if (!chatResp.ok) throw new Error(chatBody?.error?.message || `OpenAI chat error ${chatResp.status}`);
  const parsedChat = extractStructured<T>(chatBody);
  if (!parsedChat) throw new Error('No model output');
  return parsedChat;
}

// ================== Schemas =================
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

// Care fragments
const SCHEMA_LIGHT    = { type:'object', additionalProperties:false, properties:{ care_light:{ type:'string', maxLength:500 } }, required:['care_light'] } as const;
const SCHEMA_WATER    = { type:'object', additionalProperties:false, properties:{ care_water:{ type:'string', maxLength:800 } }, required:['care_water'] } as const;
const SCHEMA_TEMP_HUM = { type:'object', additionalProperties:false, properties:{ care_temp_humidity:{ type:'string', maxLength:800 } }, required:['care_temp_humidity'] } as const;
const SCHEMA_FERT     = { type:'object', additionalProperties:false, properties:{ care_fertilizer:{ type:'string', maxLength:400 } }, required:['care_fertilizer'] } as const;
const SCHEMA_PRUNE    = { type:'object', additionalProperties:false, properties:{ care_pruning:{ type:'string', maxLength:500 } }, required:['care_pruning'] } as const;
const SCHEMA_SOIL = {
  type: 'object',
  additionalProperties: false,
  properties: { soil_description: { type: 'string', maxLength: 500 } },
  required: ['soil_description']
} as const;
const SCHEMA_PROP = {
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
        properties: {
          method: { type: 'string', enum: ['cuttings', 'division', 'leaf', 'offsets', 'seed', 'air_layering'] },
          difficulty: { type: 'string', enum: ['easy', 'moderate', 'challenging', 'very_challenging'] },
          description: { type: 'string', maxLength: 500 }
        },
        required: ['method', 'difficulty', 'description']
      }
    }
  },
  required: ['propagation_techniques'],
} as const;

const AVAIL = { unknown:'unknown', not_in_trade:'not_in_trade', rarely_available:'rarely_available', seasonal:'seasonal', commonly_available:'commonly_available' } as const;
const RARITY = { unknown:'unknown', common:'common', uncommon:'uncommon', rare:'rare', very_rare:'very_rare', ultra_rare:'ultra_rare' } as const;

// ================== Profile (for deterministic light/water) ==================
type WindowAspect = 'south' | 'west' | 'east' | 'north';
type LightClass   = 'direct_sun' | 'high_light' | 'bright_indirect' | 'medium' | 'low';
type Watering     = 'soak_and_dry' | 'top_inch_dry' | 'evenly_moist' | 'boggy_never';

const WINDOW_ORDER: WindowAspect[] = ['south','west','east','north'];

function articleFor(aspect: WindowAspect) {
  // “an east-facing”, “a south-facing”
  return aspect === 'east' ? 'an' : 'a';
}

function prettyList(items: WindowAspect[]) {
  // "west/east", "west/east/north" → keep your slash style
  return items.join('/');
}

function sanitizeProfile(p: Profile): Profile {
  // 1) de-dup window_ok and remove window_best
  const okSet = new Set((p.window_ok ?? []).filter(w => w !== p.window_best));
  // 2) sort ok windows into a stable, sensible order
  const okSorted = WINDOW_ORDER.filter(w => okSet.has(w));
  return { ...p, window_ok: okSorted };
}



type Profile = {
  growth_form: 'succulent-stem' | 'succulent-leaf' | 'cactus' | 'tropical-foliage' | 'woody-shrub' | 'herb';
  is_succulent: boolean;
  light_class: LightClass;
  watering_strategy: Watering;
  window_best: WindowAspect;
  window_ok: WindowAspect[];
  summer_note: string;
};

const SCHEMA_PROFILE = {
  type: 'object',
  additionalProperties: false,
  required: ['growth_form','is_succulent','light_class','watering_strategy','window_best','window_ok','summer_note'],
  properties: {
    growth_form: { enum: ['succulent-stem','succulent-leaf','cactus','tropical-foliage','woody-shrub','herb'] },
    is_succulent: { type: 'boolean' },
    light_class: { enum: ['direct_sun','high_light','bright_indirect','medium','low'] },
    watering_strategy: { enum: ['soak_and_dry','top_inch_dry','evenly_moist','boggy_never'] },
    window_best: { enum: ['south','west','east','north'] },
    window_ok: { type: 'array', minItems: 0, maxItems: 3, items: { enum: ['south','west','east','north'] } },
    summer_note: { type: 'string', maxLength: 180 }
  }
} as const;

const HARD_RULES: Record<string, Partial<Profile>> = {
  'kalanchoe fedtschenkoi': {
    growth_form: 'succulent-leaf', is_succulent: true,
    light_class: 'direct_sun', watering_strategy: 'soak_and_dry',
    window_best: 'south', window_ok: ['west','east'],
    summer_note: 'In very hot, dry summers, give light afternoon shade to prevent leaf scorch.'
  },
  'euphorbia mammillaris': {
    growth_form: 'succulent-stem', is_succulent: true,
    light_class: 'direct_sun', watering_strategy: 'soak_and_dry',
    window_best: 'south', window_ok: ['west','east'],
    summer_note: 'Acclimate gradually when moving into stronger sun.'
  }
};

const sharedNameNote =
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon. Do NOT correct, substitute, or question it. You MAY use or suggest a more widely used COMMON name, but do not alter the scientific name.';
const unitsNote =
  'Use U.S. customary units ONLY (inches, °F). Do NOT include metric equivalents or units in parentheses.';

function profileInstructions() {
  return [
    'You are classifying horticultural traits for the EXACT species provided.',
    sharedNameNote, unitsNote,
    'If the plant is a succulent (Euphorbia/Kalanchoe/Aloe/Haworthia/Crassula/etc.), prefer light_class=direct_sun or high_light and watering_strategy=soak_and-dry unless the species is explicitly shade-adapted.',
    'Output JSON ONLY matching the schema.'
  ].join(' ');
}

function renderLightFromProfile(p0: Profile): string {
  const p = sanitizeProfile(p0);

  const desc: Record<LightClass,string> = {
    direct_sun:     'Thrives in bright light with several hours of direct sun daily.',
    high_light:     'Prefers very bright light and benefits from some direct sun.',
    bright_indirect:'Prefers bright, indirect light with minimal direct sun.',
    medium:         'Tolerates medium light but growth will slow and may stretch.',
    low:            'Tolerates low light poorly; expect sparse, weak growth.'
  };

  const art = articleFor(p.window_best);
  const ok = p.window_ok.length ? `; ${prettyList(p.window_ok)} are acceptable with slower growth` : '';
  const windows = `Indoors, ${art} ${p.window_best}-facing window is best${ok}.`;

  return [desc[p.light_class], windows, p.summer_note].filter(Boolean).join(' ');
}

function renderWaterFromProfile(p: Profile): string {
  const w: Record<Watering,string> = {
    soak_and_dry: 'Water deeply, then allow the soil to dry out completely before watering again; reduce frequency in winter.',
    top_inch_dry: 'Water when the top 1 in of soil is dry; empty any saucer to avoid soggy roots.',
    evenly_moist: 'Keep the soil evenly moist but never waterlogged; ensure free drainage.',
    boggy_never:  'Keep the medium consistently wet and never allow it to dry; use a container with no standing water.'
  };
  return w[p.watering_strategy];
}
function fixContradictions(_light: string, water: string) {
  const saysModerate = /\bmoderate watering\b/i.test(water);
  const saysDryOut   = /dry out completely/i.test(water);
  if (saysModerate && saysDryOut) {
    return water.replace(/\bmoderate watering\b/ig, 'Water deeply, then allow the soil to dry out completely');
  }
  return water;
}

// ================== Helpers ==================
function makeInput(commonName?: string | null, scientificName?: string | null): string {
  const norm = (s?: string | null) => (s?.trim() ? s.trim() : '(unknown)');
  return `Provided common name: ${norm(commonName)}
Scientific name (canonical): ${norm(scientificName)}
Write in a neutral, factual tone. Keep paragraphs short.`;
}
function toTitle(s: string) {
  return s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function normalizeMethodLabel(method: string): CanonMethod {
  const k = method.trim().toLowerCase();
  if (k.includes('air')) return 'air_layering';
  if (k.includes('leaf')) return 'leaf';
  if (k.includes('division') || k.includes('divide') || k.includes('rhizome')) return 'division';
  if (k.includes('offset') || k.includes('pup')) return 'offsets';
  if (k.includes('seed')) return 'seed';
  return 'cuttings';
}

// ================== DB helper (ensures a real update) ==================
async function savePlantsRow<T extends Record<string, any>>(id: string, payload: T) {
  // Strip undefineds so we don't accidentally null fields
  const clean: Record<string, any> = {};
  for (const k of Object.keys(payload)) {
    const v = (payload as any)[k];
    if (v !== undefined) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return null;

  const { data, error, status } = await supabase
    .from('plants')
    .update(clean)
    .eq('id', id)
    .select(
      'id, plant_name, description, availability, rarity, care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning, soil_description, propagation_methods_json, data_response_version, data_response_meta'
    )
    .single();

  if (error) throw error;
  if (!data) throw new Error(`Update returned no row (status ${status}). Check RLS or id mismatch.`);
  return data;
}

// ================== Main Hook =================
export function useGeneratePlantData() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CombinedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);

  const stage = useCallback(async <T>(
    key: StageKey,
    label: string,
    fn: () => Promise<T>,
    onProgress?: (events: ProgressEvent[]) => void
  ): Promise<T> => {
    const startedAt = Date.now();
    setProgressEvents(prev => {
      const updated = [...prev.filter(e => e.key !== key), { key, label, status: 'running' as ProgressStatus, startedAt, percent: 0 }];
      onProgress?.(updated);
      return updated;
    });

    try {
      const result = await fn();
      const endedAt = Date.now();
      setProgressEvents(prev => {
        const updated = [...prev.filter(e => e.key !== key), { key, label, status: 'success' as ProgressStatus, startedAt, endedAt, percent: 100 }];
        onProgress?.(updated);
        return updated;
      });
      return result;
    } catch (err: any) {
      const endedAt = Date.now();
      setProgressEvents(prev => {
        const updated = [...prev.filter(e => e.key !== key), { key, label, status: 'error' as ProgressStatus, startedAt, endedAt, percent: 0 }];
        onProgress?.(updated);
        return updated;
      });
      throw err;
    }
  }, []);

  const run = useCallback(async (args: Args, onProgress?: (events: ProgressEvent[]) => void): Promise<CombinedResult | null> => {
    try {
      setLoading(true);
      setError(null);
      setProgressEvents([]);
      setData(null);

      // Stage 1: Read existing
      const db = await stage('db_read', 'Reading existing plant data', async () => {
        const pre = (await supabase
          .from('plants')
          .select(`
            id, plant_name, description, availability, rarity,
            care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning,
            soil_description, propagation_methods_json,
            data_response_version
          `)
          .eq('id', args.plantsTableId)
          .maybeSingle()) as SBResp<RowShape>;
        if (pre.error) throw pre.error;
        return pre.data;
      }, onProgress);

      const rowVersion = db?.data_response_version ?? 0;
      const forced = computeForcedFieldsSince(rowVersion, CURRENT_RULESET_VERSION);


      const hasDesc   = !!db?.description?.trim() && !forced.has('description');
      const hasAvail  = !!db?.availability && db.availability !== 'unknown' && !forced.has('availability');
      const hasRarity = !!db?.rarity && db.rarity !== 'unknown' && !forced.has('rarity');
      const hasName   = !!db?.plant_name?.trim() && !forced.has('plant_name');

      const hasLight = !!db?.care_light?.trim() && !forced.has('care_light');
      const hasWater = !!db?.care_water?.trim() && !forced.has('care_water');

      const hasTempHum = !!db?.care_temp_humidity?.trim() && !forced.has('care_temp_humidity');
      const hasFert  = !!db?.care_fertilizer?.trim() && !forced.has('care_fertilizer');
      const hasPrune = !!db?.care_pruning?.trim() && !forced.has('care_pruning');
      const hasSoil  = !!db?.soil_description?.trim() && !forced.has('soil_description');
      const hasProp  = Array.isArray(db?.propagation_methods_json) && db!.propagation_methods_json!.length > 0 && !forced.has('propagation_methods_json');

      const needsFacts = !hasDesc || !hasAvail || !hasRarity || !hasName;
      const needsCare  = !hasLight || !hasWater || !hasTempHum || !hasFert || !hasPrune || !hasSoil || !hasProp;

      let factsResult: FactsResult | null = null;
      let careResult: CareResult | null = null;

      // ===== Facts (always generate suggested name, generate other facts only if missing) =====
      // Always generate suggested name (like original useGeneratePlantFacts)
      const nameOnly = await stage('facts_generation', 'Generating plant facts', async () => {
        const sharedNameNoteFacts = `IMPORTANT: If the user provides a common name, use it as-is. Only suggest alternatives if no common name is given.`;
        return await openAIJson<{ suggested_common_name: string | null }>(
          SCHEMA_NAME_ONLY,
          ['You are a precise botany writer.', sharedNameNoteFacts, 'Return only JSON.'].join(' '),
          makeInput(db?.plant_name || args.commonName, args.scientificName),
          200,
          200
        );
      }, onProgress);

      // Generate other facts only if missing
      if (needsFacts) {
        const descMeta = await openAIJson<{ description: string; availability_status: Availability; rarity_level: Rarity }>(
          SCHEMA_DESC_META,
          [
            'You are a precise botany writer.',
            'Output MUST match the JSON schema exactly.',
            'description: exactly two SHORT paragraphs about the plant itself (morphology, habitat, taxonomy). No care tips.',
            'Return JSON only.',
          ].join(' '),
          makeInput(db?.plant_name || args.commonName, args.scientificName),
          900,
          900
        );

        factsResult = {
          description: descMeta.description,
          availability_status: descMeta.availability_status,
          rarity_level: descMeta.rarity_level,
          suggested_common_name: nameOnly.suggested_common_name ? toTitle(nameOnly.suggested_common_name) : null,
        };
      } else {
        // Still create a facts result with just the suggested name
        factsResult = {
          description: db?.description || '',
          availability_status: db?.availability as Availability || 'unknown',
          rarity_level: db?.rarity as Rarity || 'unknown',
          suggested_common_name: nameOnly.suggested_common_name ? toTitle(nameOnly.suggested_common_name) : null,
        };
      }

      // Always write facts to database if any were generated
      if (factsResult) {
        await stage('facts_db_write', 'Saving plant facts', async () => {
          const payload: Record<string, any> = {};
          // DON'T automatically set plant_name - let the user choose via ConfirmNameModal
          // if (!hasName) {
          //   const candidate = factsResult.suggested_common_name?.trim() || (args.commonName?.trim() ?? '');
          //   if (candidate) payload.plant_name = toTitle(candidate);
          // }
          if (!hasDesc)   payload.description = factsResult.description;
          if (!hasAvail)  payload.availability = AVAIL[factsResult.availability_status] ?? 'unknown';
          if (!hasRarity) payload.rarity = RARITY[factsResult.rarity_level] ?? 'unknown';

          if (Object.keys(payload).length > 0) {
            await savePlantsRow(args.plantsTableId, payload);
          }
        }, onProgress);
      }

      const needsProfile = !hasLight || !hasWater;

      // ===== Care (only missing bits) =====
      if (needsCare) {
        const baseInput = makeInput(db?.plant_name || args.commonName, args.scientificName);

        // Profile stage (feeds deterministic light/water)
        let profile: Profile | null = null;
        if (needsProfile) {
          profile = await stage('profile', 'Building species profile', async () => {
            const sciKey = (args.scientificName || '').trim().toLowerCase();
            const hard = HARD_RULES[sciKey] || null;
            if (hard) {
              const filled = await openAIJson<Profile>(
                SCHEMA_PROFILE,
                profileInstructions(),
                `${baseInput}\n${unitsNote}\nUse these fixed defaults if sensible: ${JSON.stringify(hard)}\nOnly output JSON.`,
                500,
                500
              );
              return { ...filled, ...hard } as Profile;
            }
            return await openAIJson<Profile>(
              SCHEMA_PROFILE,
              profileInstructions(),
              `${baseInput}\n${unitsNote}\nOnly output JSON.`,
              500,
              500
            );
          }, onProgress);
        }

        // Light (deterministic)
        const light = hasLight
          ? { care_light: db!.care_light! }
          : await stage('care_light','Generating lighting requirements', async () => {
              if (!profile) throw new Error('Profile required to render care_light');
              return { care_light: renderLightFromProfile(profile) };
            }, onProgress);

        // Water (deterministic + tiny fixer)
        const water = hasWater
          ? { care_water: db!.care_water! }
          : await stage('care_water','Generating watering schedule', async () => {
              if (!profile) throw new Error('Profile required to render care_water');
              const templatedWater = fixContradictions(light.care_light, renderWaterFromProfile(profile));
              return { care_water: templatedWater };
            }, onProgress);

        const tempHum = hasTempHum
          ? { care_temp_humidity: db!.care_temp_humidity! }
          : await stage('care_temp_humidity', 'Generating temperature & humidity', async () => {
              const result = await openAIJson<{ care_temp_humidity: string }>(
                SCHEMA_TEMP_HUM,
                [
                  'You are a precise botany/cultivation writer.',
                  sharedNameNote, unitsNote,
                  'Return ONLY JSON.',
                  'One paragraph with numeric temperature ranges in °F, humidity ranges in %, and damage thresholds for THIS species.',
                  'Do not include metric equivalents or parentheticals.'
                ].join(' '),
                baseInput,
                800,
                800
              );
              return { care_temp_humidity: result.care_temp_humidity };
            }, onProgress);

        const fert = hasFert
          ? { care_fertilizer: db!.care_fertilizer! }
          : await stage('care_fertilizer', 'Generating fertilizer schedule', async () => {
              const result = await openAIJson<{ care_fertilizer: string }>(
                SCHEMA_FERT,
                [
                  'You are a precise botany/cultivation writer.',
                  sharedNameNote, unitsNote, 'Return ONLY JSON.',
                  'Two sentences: formulation/dilution, then frequency/seasonality. Use inches and °F if any units arise.',
                  'Do not include metric equivalents or parentheses.'
                ].join(' '),
                baseInput,
                400,
                400
              );
              return { care_fertilizer: result.care_fertilizer };
            }, onProgress);

        const prune = hasPrune
          ? { care_pruning: db!.care_pruning! }
          : await stage('care_pruning', 'Generating pruning instructions', async () => {
              const result = await openAIJson<{ care_pruning: string }>(
                SCHEMA_PRUNE,
                [
                  'You are a precise botany/cultivation writer.',
                  sharedNameNote, unitsNote, 'Return ONLY JSON.',
                  '2–3 sentences: when/why/how to prune THIS species; tie to plant form.',
                  'Do not include metric equivalents or parentheses.'
                ].join(' '),
                baseInput,
                500,
                500
              );
              return { care_pruning: result.care_pruning };
            }, onProgress);

        const soil = hasSoil
          ? { soil_description: db!.soil_description! }
          : await stage('care_soil_description', 'Generating soil requirements', async () => {
              const result = await openAIJson<{ soil_description: string }>(
                SCHEMA_SOIL,
                [
                  'You are a precise botany/cultivation writer.',
                  sharedNameNote, unitsNote, 'Return ONLY JSON.',
                  'Three sentences: ideal soil properties + best-practice mix for THIS species.',
                  'Use inches and °F only if you mention units; do not include metric equivalents or parentheses.'
                ].join(' '),
                baseInput,
                500,
                500
              );
              return { soil_description: result.soil_description };
            }, onProgress);

        const prop = hasProp
          ? { propagation_techniques: db!.propagation_methods_json! }
          : await stage('care_propagation', 'Generating propagation methods', async () => {
              const result = await openAIJson<{ propagation_techniques: { method: CanonMethod; difficulty: Difficulty; description: string }[] }>(
                SCHEMA_PROP,
                [
                  'You are a precise botany writer.',
                  sharedNameNote, unitsNote,
                  'Output MUST match the JSON schema exactly and return ONLY JSON.',
                  'Techniques MUST be realistic for THIS species; include concrete anatomy cues and counts/timings.',
                  'Use inches and °F only; do not include metric equivalents or parentheses.',
                  'One compact paragraph per technique; 1–3 techniques total.'
                ].join(' '),
                baseInput,
                800,
                800
              );
              return {
                propagation_techniques: result.propagation_techniques.map((p) => ({
                  method: normalizeMethodLabel(p.method),
                  difficulty: p.difficulty,
                  description: p.description,
                }))
              };
            }, onProgress);

        careResult = {
          care_light: light.care_light,
          care_water: water.care_water,
          care_temp_humidity: tempHum.care_temp_humidity,
          care_fertilizer: fert.care_fertilizer,
          care_pruning: prune.care_pruning,
          soil_description: soil.soil_description,
          propagation_techniques: prop.propagation_techniques,
        };

        const payload: Record<string, any> = {};
        if (!hasLight)   payload.care_light = careResult.care_light;
        if (!hasWater)   payload.care_water = careResult.care_water;
        if (!hasTempHum) payload.care_temp_humidity = careResult.care_temp_humidity;
        if (!hasFert)    payload.care_fertilizer = careResult.care_fertilizer;
        if (!hasPrune)   payload.care_pruning = careResult.care_pruning;
        if (!hasSoil)    payload.soil_description = careResult.soil_description;
        if (!hasProp)    payload.propagation_methods_json = careResult.propagation_techniques;

        if (Object.keys(payload).length > 0) {
          await stage('care_db_write', 'Saving care details', async () => {
            await savePlantsRow(args.plantsTableId, payload);
          }, onProgress);
        }
      }

      const anyWrites = needsFacts || needsCare;

      if (anyWrites && rowVersion < CURRENT_RULESET_VERSION) {
        await savePlantsRow(args.plantsTableId, {
          data_response_version: CURRENT_RULESET_VERSION,
          data_response_meta: {
            model: OPENAI_MODEL,
            run_at: new Date().toISOString(),
          },
        });
      }

      // Combine
      const finalResult: CombinedResult = {
        description: factsResult?.description ?? db?.description ?? '',
        availability_status: factsResult?.availability_status ?? (db?.availability ?? 'unknown'),
        rarity_level: factsResult?.rarity_level ?? (db?.rarity ?? 'unknown'),
        suggested_common_name: factsResult?.suggested_common_name ?? null,

        care_light:        careResult?.care_light        ?? db?.care_light        ?? '',
        care_water:        careResult?.care_water        ?? db?.care_water        ?? '',
        care_temp_humidity:careResult?.care_temp_humidity?? db?.care_temp_humidity?? '',
        care_fertilizer:   careResult?.care_fertilizer   ?? db?.care_fertilizer   ?? '',
        care_pruning:      careResult?.care_pruning      ?? db?.care_pruning      ?? '',
        soil_description:  careResult?.soil_description  ?? db?.soil_description  ?? '',
        propagation_techniques: careResult?.propagation_techniques ?? db?.propagation_methods_json ?? []
      };

      setData(finalResult);

      // Done
      await stage('done', 'Finished', async () => ({} as any), onProgress);
      return finalResult;

    } catch (err: any) {
      setError(err?.message ?? 'Failed to generate plant data');
      return null;
    } finally {
      setLoading(false);
    }
  }, [stage]);

  return { loading, data, error, progressEvents, run };
}
