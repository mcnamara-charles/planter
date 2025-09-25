// hooks/useGenerateCare.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY } from '@env';

// ================== Config ==================
const OPENAI_MODEL = 'gpt-4.1-mini';

// Unit preference
type UnitPref = 'us' | 'metric';
const DEFAULT_UNITS: UnitPref = 'us';

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

// Progress reporting
type StageKey =
  | 'db_read'
  | 'profile'
  | 'light_water'
  | 'care_temp_humidity'
  | 'care_fertilizer'
  | 'care_pruning'
  | 'soil_description'
  | 'propagation'
  | 'db_write'
  | 'done';

type ProgressStatus = 'pending' | 'running' | 'success' | 'error';

type ProgressEvent = {
  key: StageKey;
  label: string;
  status: ProgressStatus;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  meta?: Record<string, any>;
};

type RunOpts = Args & {
  onProgress?: (evt: ProgressEvent, all: ProgressEvent[]) => void; // optional live updates for parent
  units?: UnitPref; // default 'us'
};

// =============== Tiny helpers ===============
async function withTimeout<T>(p: PromiseLike<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(p), timeout]);
  } finally {
    clearTimeout(timer);
  }
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
  if (looksLikeJson(s)) {
    try {
      return JSON.parse(s);
    } catch {}
  }
  const match = s.match(/[{\[][\s\S]*[}\]]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return null;
}
function extractStructured<T = any>(json: any): T | null {
  if (json?.output_parsed) return json.output_parsed as T;
  if (json?.parsed) return json.parsed as T;
  const output = Array.isArray(json?.output) ? json.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (c?.parsed) return c.parsed as T;
      if (typeof c?.json === 'object' && c.json) return c.json as T;
      if (typeof c?.text === 'string') {
        const fx = firstJsonIn(c.text);
        if (fx) return fx as T;
      }
      if (Array.isArray(c?.annotations)) {
        for (const a of c.annotations) {
          if (typeof a?.text === 'string') {
            const fx = firstJsonIn(a.text);
            if (fx) return fx as T;
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
  } catch (_) {
    /* fall through */
  }

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
  } catch (_) {
    /* fall through */
  }

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

// ================== Structured profile schema + helpers ==================
type WindowAspect = 'south' | 'west' | 'east' | 'north';
type LightClass   = 'direct_sun' | 'high_light' | 'bright_indirect' | 'medium' | 'low';
type Watering     = 'soak_and_dry' | 'top_inch_dry' | 'evenly_moist' | 'boggy_never';

type Profile = {
  growth_form: 'succulent-stem' | 'succulent-leaf' | 'cactus' | 'tropical-foliage' | 'woody-shrub' | 'herb';
  is_succulent: boolean;
  light_class: LightClass;
  watering_strategy: Watering;
  window_best: WindowAspect;
  window_ok: WindowAspect[];
  summer_note: string; // short safety note
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

/** Hard rules for known species (deterministic & cached). Add as you go. */
const HARD_RULES: Record<string, Partial<Profile>> = {
  'kalanchoe fedtschenkoi': {
    growth_form: 'succulent-leaf',
    is_succulent: true,
    light_class: 'direct_sun',
    watering_strategy: 'soak_and_dry',
    window_best: 'south',
    window_ok: ['west','east'],
    summer_note: 'In very hot, dry summers, give light afternoon shade to prevent leaf scorch.'
  },
  'euphorbia mammillaris': {
    growth_form: 'succulent-stem',
    is_succulent: true,
    light_class: 'direct_sun',
    watering_strategy: 'soak_and_dry',
    window_best: 'south',
    window_ok: ['west','east'],
    summer_note: 'Acclimate gradually when moving into stronger sun.'
  }
};

/** Compose a profile prompt with guardrails that prevent generic clichés. */
function profileInstructions() {
  return [
    'You are classifying horticultural traits for the EXACT species provided.',
    sharedNameNote,
    // Guardrails:
    'If the plant is a succulent (Euphorbia/Kalanchoe/Aloe/Haworthia/Crassula/etc.), prefer light_class=direct_sun or high_light and watering_strategy=soak_and_dry unless the species is explicitly shade-adapted.',
    'Do NOT use garden-center clichés. Output JSON matching the schema, nothing else.',
  ].join(' ');
}

/** Deterministic rendering from the profile (no model prose). */
function renderLightFromProfile(p: Profile): string {
  const desc: Record<LightClass,string> = {
    direct_sun:     'Thrives in bright light with several hours of direct sun daily.',
    high_light:     'Prefers very bright light and benefits from some direct sun.',
    bright_indirect:'Prefers bright, indirect light with minimal direct sun.',
    medium:         'Tolerates medium light but growth will slow and may stretch.',
    low:            'Tolerates low light poorly; expect sparse, weak growth.'
  };
  const windows = `Indoors, a ${p.window_best}-facing window is best${p.window_ok.length ? `; ${p.window_ok.join('/')} are acceptable with slower growth` : ''}.`;
  return [desc[p.light_class], windows, p.summer_note].filter(Boolean).join(' ');
}

// Inches-first wording for top_inch_dry
function renderWaterFromProfile(p: Profile): string {
  const w: Record<Watering,string> = {
    soak_and_dry: 'Water deeply, then allow the soil to dry out completely before watering again; reduce frequency in winter.',
    top_inch_dry: 'Water when the top 1 in (2–3 cm) of soil is dry; empty any saucer to avoid soggy roots.',
    evenly_moist: 'Keep the soil evenly moist but never waterlogged; ensure free drainage.',
    boggy_never:  'Keep the medium consistently wet and never allow it to dry; use a container with no standing water.'
  };
  return w[p.watering_strategy];
}

/** Tiny contradiction fixer (paranoia). */
function fixContradictions(_light: string, water: string) {
  const saysModerate = /\bmoderate watering\b/i.test(water);
  const saysDryOut   = /dry out completely/i.test(water);
  if (saysModerate && saysDryOut) {
    return water.replace(/\bmoderate watering\b/ig, 'Water deeply, then allow the soil to dry out completely');
  }
  return water;
}

// ========== Unit conversion helpers (°C→°F, cm→in) ==========
const EN_DASH = /–/g;
const toF = (c: number) => (c * 9) / 5 + 32;
const toIn = (cm: number) => cm / 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;

function convertTemperaturesToF(s: string): string {
  if (!s) return s;
  let t = s.replace(EN_DASH, '-');

  // ranges like "10-15 °C" or "10 to 15C"
  t = t.replace(
    /(?<!°)\b(-?\d+(?:\.\d+)?)\s*(?:to|-)\s*(-?\d+(?:\.\d+)?)\s*°?\s*C(?:elsius)?\b/gi,
    (_, a, b) => `${round1(toF(parseFloat(a)))}–${round1(toF(parseFloat(b)))} °F`
  );
  // singles like "18°C" or "18 C"
  t = t.replace(
    /(?<!°)\b(-?\d+(?:\.\d+)?)\s*°?\s*C(?:elsius)?\b/gi,
    (_, a) => `${round1(toF(parseFloat(a)))} °F`
  );
  return t;
}

function convertCentimetersToInches(s: string): string {
  if (!s) return s;
  let t = s.replace(EN_DASH, '-');

  // ranges like "2-3 cm"
  t = t.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*cm\b/gi,
    (_, a, b) => `${round1(toIn(parseFloat(a)))}–${round1(toIn(parseFloat(b)))} in`
  );
  // singles like "5 cm"
  t = t.replace(
    /\b(\d+(?:\.\d+)?)\s*cm\b/gi,
    (_, a) => `${round1(toIn(parseFloat(a)))} in`
  );
  return t;
}

function applyUnitPreference(text: string, units: UnitPref): string {
  if (!text) return text;
  if (units === 'us') {
    let out = convertTemperaturesToF(text);
    out = convertCentimetersToInches(out);
    return out;
  }
  return text;
}

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

  // Progress state
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<StageKey | null>(null);

  function emit(evt: ProgressEvent, onProgress?: RunOpts['onProgress']) {
    setProgress(prev => {
      const idx = prev.findIndex(p => p.key === evt.key);
      const next = [...prev];
      if (idx >= 0) next[idx] = { ...next[idx], ...evt };
      else next.push(evt);
      onProgress?.(evt, next);
      return next;
    });
    setCurrentStage(evt.key);
  }

  async function stage<T>(
    key: StageKey,
    label: string,
    fn: () => Promise<T>,
    onProgress?: RunOpts['onProgress'],
    meta?: Record<string, any>
  ): Promise<T> {
    const startedAt = Date.now();
    emit({ key, label, status: 'running', startedAt, meta }, onProgress);
    try {
      const result = await fn();
      emit({ key, label, status: 'success', startedAt, endedAt: Date.now(), meta }, onProgress);
      return result;
    } catch (e: any) {
      const err = e?.message ?? String(e);
      emit({ key, label, status: 'error', startedAt, endedAt: Date.now(), error: err, meta }, onProgress);
      throw e;
    }
  }

  const run = useCallback(async (opts: RunOpts): Promise<CareResult> => {
    const { plantsTableId, commonName, scientificName, onProgress, units = DEFAULT_UNITS } = opts;
    setLoading(true);
    setError(null);
    setProgress([]);
    setCurrentStage(null);

    try {
      // DB read
      const pre = await stage('db_read', 'Read plant row', async () => {
        return (await supabase
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
      }, onProgress);

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

      // Profile (hard rules + fill)
      const sciKey = (scientificName || '').trim().toLowerCase();
      const hard = HARD_RULES[sciKey] || null;

      const profile = await stage('profile', 'Build species profile', async () => {
        if (hard) {
          const fillInstr = profileInstructions();
          const filled = await openAIJson<Profile>(
            SCHEMA_PROFILE,
            fillInstr,
            `${baseInput}\nUse these fixed defaults if sensible: ${JSON.stringify(hard)}\nOnly output JSON.`,
            500
          );
          return { ...filled, ...hard } as Profile;
        } else {
          return await openAIJson<Profile>(
            SCHEMA_PROFILE,
            profileInstructions(),
            `${baseInput}\nOnly output JSON.`,
            500
          );
        }
      }, onProgress, { hardRuled: !!hard });

      // Deterministic light/water
      const { care_light: careLight, care_water: careWater } = await stage(
        'light_water',
        'Render light/water from profile',
        async () => {
          const templatedLight  = renderLightFromProfile(profile);
          const templatedWater0 = renderWaterFromProfile(profile);
          const templatedWater  = fixContradictions(templatedLight, templatedWater0);
          return { care_light: templatedLight, care_water: templatedWater };
        },
        onProgress
      );

      const light = hasLight ? { care_light: db!.care_light! } : { care_light: careLight };
      const water = hasWater ? { care_water: db!.care_water! } : { care_water: careWater };

      const th = hasTH ? { care_temp_humidity: db!.care_temp_humidity! } :
        await stage('care_temp_humidity', 'Generate temp & humidity', async () =>
          openAIJson<{ care_temp_humidity: string }>(
            SCHEMA_TEMP_HUM,
            [
              'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
              'One paragraph with numeric temp range, RH range, and damage thresholds for THIS species.'
            ].join(' '),
            baseInput, 550
          ), onProgress);

      const fert = hasFert ? { care_fertilizer: db!.care_fertilizer! } :
        await stage('care_fertilizer', 'Generate fertilizer guidance', async () =>
          openAIJson<{ care_fertilizer: string }>(
            SCHEMA_FERT,
            [
              'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
              'Two sentences: formulation/dilution, then frequency/seasonality.'
            ].join(' '),
            baseInput, 300
          ), onProgress);

      const prune = hasPrune ? { care_pruning: db!.care_pruning! } :
        await stage('care_pruning', 'Generate pruning guidance', async () =>
          openAIJson<{ care_pruning: string }>(
            SCHEMA_PRUNE,
            [
              'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
              '2–3 sentences: when/why/how to prune THIS species; tie to plant form.'
            ].join(' '),
            baseInput, 350
          ), onProgress);

      const soil = hasSoil ? { soil_description: db!.soil_description! } :
        await stage('soil_description', 'Generate soil/mix guidance', async () =>
          openAIJson<{ soil_description: string }>(
            SCHEMA_SOIL,
            [
              'You are a precise botany/cultivation writer.', sharedNameNote, 'Return ONLY JSON.',
              'Three sentences: ideal soil properties + best-practice mix for THIS species.'
            ].join(' '),
            baseInput, 800
          ), onProgress);

      let prop: { propagation_techniques: { method: string; difficulty: Difficulty; description: string }[] } | null = null;
      if (hasProp) {
        prop = { propagation_techniques: db!.propagation_methods_json! };
      } else {
        prop = await stage('propagation', 'Generate propagation techniques', async () => {
          const propInstr = [
            'You are a precise botany writer.', sharedNameNote,
            'Output MUST match the JSON schema exactly and return ONLY JSON.',
            'Techniques MUST be realistic for THIS species; include concrete anatomy cues and counts/timings.',
            'One compact paragraph per technique; 1–3 techniques total.'
          ].join(' ');
          return openAIJson(SCHEMA_PROPAGATION, propInstr, baseInput, 800);
        }, onProgress);
      }

      // Compose result
      let result: CareResult = {
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

      // Apply unit preference (default US) to model-generated strings.
      // Avoid converting our templated water (already "1 in (2–3 cm)") unless it came from DB.
      if (units === 'us') {
        result = {
          ...result,
          care_water: hasWater ? applyUnitPreference(result.care_water, 'us') : result.care_water,
          care_temp_humidity: applyUnitPreference(result.care_temp_humidity, 'us'),
          care_fertilizer: applyUnitPreference(result.care_fertilizer, 'us'),
          care_pruning: applyUnitPreference(result.care_pruning, 'us'),
          soil_description: result.soil_description ? applyUnitPreference(result.soil_description, 'us') : result.soil_description,
          propagation_techniques: result.propagation_techniques?.map(t => ({
            ...t,
            description: applyUnitPreference(t.description, 'us'),
          })),
        };
      }

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
        await stage('db_write', 'Write back to Supabase', async () => {
          return withTimeout<SBResp>(
            supabase.from('plants').update(payload).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
            15_000,
            'Supabase update(plants care+extras)'
          );
        }, onProgress);
      }

      // mark done
      emit({ key: 'done', label: 'Finished', status: 'success', startedAt: Date.now(), endedAt: Date.now() }, onProgress);

      setData(result);
      return result;

    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate care info');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  // Expose progress + current stage too
  return { loading, data, error, progress, currentStage, run };
}
