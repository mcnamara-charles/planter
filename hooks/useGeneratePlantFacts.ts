// hooks/useGeneratePlantFacts.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } from '@env';

// ================== Config ==================
const VERBOSE_DEBUG = true;              // flip to false to quiet logs
const OPENAI_MODEL  = 'gpt-4.1-mini';    // per your request

// ================== Types ===================
type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available';
type Rarity       = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare';

type Difficulty = 'easy' | 'moderate' | 'challenging' | 'very_challenging';
type PropTechnique = {
  method: string;       // will be normalized to: cuttings | division | leaf | offsets | seed | air_layering
  difficulty: Difficulty;
  description: string;
};

type Result = {
  description: string;
  availability_status: Availability;
  rarity_level: Rarity;
  propagation_techniques: PropTechnique[];
  soil_description: string;
};

type Args = {
  plantsTableId: string;
  commonName?: string | null;
  scientificName?: string | null;
};

// =============== Tiny helpers ===============
const now = () => Date.now();
const dur = (t0: number) => `${Date.now() - t0}ms`;
const hash = (s?: string) => (s ? String(s).slice(0, 6) + '…' + String(s).slice(-6) : '(missing)');
const red = (s?: string) => (s ? s.slice(0, 4) + '…' + s.slice(-4) : '(missing)');

const j = (x: any, max = 1200) => {
  try {
    const s = JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    return s.length > max ? s.slice(0, max) + ' …(truncated)' : s;
  } catch {
    return String(x);
  }
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

async function rpcSetMeta(id: string, availability: Availability, rarity: Rarity) {
  log('🧪 RPC.set_plant_meta.begin', { id, availability, rarity });
  const r = (await supabase.rpc('set_plant_meta', {
    p_id: id, p_availability: availability, p_rarity: rarity,
  })) as SBResp;
  log('🧪 RPC.set_plant_meta.end', { status: r.status, error: r.error?.message });
  return r;
}

// ========== Logging helpers ==========
function log(label: string, obj?: any) {
  if (!VERBOSE_DEBUG) return;
  if (obj === undefined) console.log(label);
  else console.log(label, typeof obj === 'string' ? obj : j(obj));
}

function outlineBody(body: any) {
  if (!VERBOSE_DEBUG) return;
  const outLen  = Array.isArray(body?.output) ? body.output.length : 0;
  const c0      = outLen ? body.output[0] : null;
  const c0Kinds = c0?.content ? c0.content.map((x: any) => Object.keys(x)) : null;
  log('🧩 Body outline', {
    object: body?.object,
    status: body?.status,
    incomplete_details: body?.incomplete_details,
    output_len: outLen,
    output0_content_len: Array.isArray(c0?.content) ? c0.content.length : 0,
    output0_content0_keys: c0Kinds?.[0],
    keys: body ? Object.keys(body) : null,
  });
}

function outlineHeaders(resp: Response) {
  if (!VERBOSE_DEBUG) return;
  const h = resp.headers;
  const rl = {
    'x-ratelimit-limit-requests': h.get('x-ratelimit-limit-requests'),
    'x-ratelimit-remaining-requests': h.get('x-ratelimit-remaining-requests'),
    'x-ratelimit-reset-requests': h.get('x-ratelimit-reset-requests'),
    'x-request-id': h.get('x-request-id'),
  };
  log('📬 OpenAI headers (subset)', rl);
}

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
  return 'cuttings'; // default for variations of "cutting(s)"
}

// ================== Schemas =================
const SCHEMA_DESC_META = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: {
      type: 'string',
      maxLength: 900,
      description: 'Exactly two concise paragraphs about the plant itself (morphology, habitat, taxonomy). No care/cultivation tips.'
    },
    rarity_level: {
      type: 'string',
      enum: ['unknown', 'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare']
    },
    availability_status: {
      type: 'string',
      enum: ['unknown', 'not_in_trade', 'rarely_available', 'seasonal', 'commonly_available']
    }
  },
  required: ['description', 'rarity_level', 'availability_status']
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
          description: { type: 'string', maxLength: 500 }
        }
      }
    }
  },
  required: ['propagation_techniques']
} as const;

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
  if (looksLikeJson(s)) {
    try { return JSON.parse(s); } catch {}
  }
  const match = s.match(/[{\[][\s\S]*[}\]]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function extractStructuredWithTrace<T = any>(json: any, trace: string[]): T | null {
  const push = (m: string) => { if (VERBOSE_DEBUG) trace.push(m); };

  if (json?.output_parsed) { push('✓ output_parsed present'); return json.output_parsed as T; }
  if (json?.parsed)        { push('✓ parsed present');        return json.parsed as T; }

  const output = Array.isArray(json?.output) ? json.output : [];
  push(`scan output array len=${output.length}`);
  for (let i = 0; i < output.length; i++) {
    const item = output[i];
    const content = Array.isArray(item?.content) ? item.content : [];
    push(`  item[${i}].content len=${content.length}`);
    for (let k = 0; k < content.length; k++) {
      const c = content[k];
      if (c?.parsed) { push(`    ✓ content[${k}].parsed`); return c.parsed as T; }
      if (typeof c?.json === 'object' && c.json) { push(`    ✓ content[${k}].json object`); return c.json as T; }
      if (typeof c?.text === 'string') {
        const snippet = c.text.slice(0, 400);
        push(`    · content[${k}].text first400="${snippet.replace(/\n/g, ' ')}"`);
        const fx = firstJsonIn(c.text);
        if (fx) { push(`    ✓ content[${k}].text -> firstJsonIn OK`); return fx as T; }
      }
      if (Array.isArray(c?.annotations)) {
        push(`    · content[${k}].annotations len=${c.annotations.length}`);
        for (let a = 0; a < c.annotations.length; a++) {
          const ann = c.annotations[a];
          if (typeof ann?.text === 'string') {
            const sn = ann.text.slice(0, 400);
            push(`      · annotation[${a}].text first400="${sn.replace(/\n/g, ' ')}"`);
            const fx = firstJsonIn(ann.text);
            if (fx) { push(`      ✓ annotation[${a}].text -> firstJsonIn OK`); return fx as T; }
          }
        }
      }
    }
  }

  if (typeof json?.output_text === 'string') {
    push(`scan output_text first400="${json.output_text.slice(0, 400).replace(/\n/g, ' ')}"`);
    const fx = firstJsonIn(json.output_text);
    if (fx) { push('✓ output_text -> firstJsonIn OK'); return fx as T; }
  }

  const cmsg = json?.choices?.[0]?.message;
  if (typeof cmsg?.content === 'string') {
    push(`scan choices[0].message.content first400="${cmsg.content.slice(0, 400).replace(/\n/g, ' ')}"`);
    const fx = firstJsonIn(cmsg.content);
    if (fx) { push('✓ choices[0].message.content -> firstJsonIn OK'); return fx as T; }
  }
  if (Array.isArray(cmsg?.content)) {
    push(`scan choices[0].message.content array len=${cmsg.content.length}`);
    for (let z = 0; z < cmsg.content.length; z++) {
      const part = cmsg.content[z];
      if (typeof part?.text === 'string') {
        const sn = part.text.slice(0, 400);
        push(`  · part[${z}].text first400="${sn.replace(/\n/g, ' ')}"`);
        const fx = firstJsonIn(part.text);
        if (fx) { push(`  ✓ part[${z}].text -> firstJsonIn OK`); return fx as T; }
      }
    }
  }

  push('✗ no JSON found');
  return null;
}

// ========== OpenAI helpers with deep debug ==========
let REQ_SEQ = 0;

async function openAIJson<T>(
  schema: any,
  instructions: string,
  input: string,
  maxTokens: number
): Promise<T> {
  const seq = ++REQ_SEQ;
  const model = OPENAI_MODEL;

  const baseReq = {
    model,
    instructions,
    input,
    temperature: 0.1,
    max_output_tokens: maxTokens,
    text: { format: { type: 'json_schema', name: 'fragment', schema, strict: true } },
  };

  const attemptResponses = async (label: string, req: any, timeoutMs: number) => {
    log(`🚀 [${seq}] ResponsesAPI ${label} begin`, {
      model: req?.model,
      max_output_tokens: req?.max_output_tokens,
      instr_len: typeof req.instructions === 'string' ? req.instructions.length : null,
      input_len: typeof req.input === 'string' ? req.input.length : null,
      api_key: red(OPENAI_API_KEY),
    });

    const resp = await withTimeout(
      fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
      timeoutMs,
      `OpenAI ${label}`
    );

    outlineHeaders(resp);

    let body: any = null;
    try { body = await resp.json(); } catch (e: any) {
      log(`❗ [${seq}] ResponsesAPI ${label} JSON parse error`, e?.message || String(e));
    }

    log(`✅ [${seq}] ResponsesAPI ${label} end`, { ok: resp.ok, status: resp.status });
    if (body) outlineBody(body);

    if (!resp.ok) {
      log(`❌ [${seq}] ResponsesAPI ${label} error body`, body);
      throw new Error(body?.error?.message || `OpenAI error ${resp.status}`);
    }
    return body;
  };

  try {
    const body1 = await attemptResponses('attempt#1', baseReq, 45_000);
    const trace1: string[] = [];
    let parsed = extractStructuredWithTrace<T>(body1, trace1);
    log(`🔎 [${seq}] parse trace #1`, trace1.join('\n'));
    const incomplete = body1?.status === 'incomplete' || !!body1?.incomplete_details;

    if (!parsed || incomplete) {
      log(`↻ [${seq}] retry with tighter JSON`, { parsed: !!parsed, incomplete });
      const tightReq = {
        ...baseReq,
        max_output_tokens: Math.max(700, Math.floor(maxTokens * 0.8)),
        instructions: instructions + ' Reply ONLY with valid JSON. Keep wording compact.',
      };
      const body2 = await attemptResponses('attempt#2(tight)', tightReq, 55_000);
      const trace2: string[] = [];
      parsed = extractStructuredWithTrace<T>(body2, trace2);
      log(`🔎 [${seq}] parse trace #2`, trace2.join('\n'));
      if (parsed) return parsed;
      log(`⚠️ [${seq}] still no parsed JSON after ResponsesAPI retry; falling back to Chat API`);
    } else {
      return parsed;
    }
  } catch (e: any) {
    log(`⚠️ [${seq}] ResponsesAPI threw; fallback to Chat API`, e?.message || String(e));
  }

  // Chat fallback
  const chatReq = {
    model,
    temperature: 0.1,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'fragment', schema, strict: true },
    },
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: input },
      { role: 'system', content: 'Reply ONLY with a single JSON object matching the schema.' },
    ],
    max_tokens: Math.ceil(maxTokens * 1.1),
  };

  log(`💬 [${seq}] ChatAPI begin`, {
    model: chatReq.model,
    max_tokens: chatReq.max_tokens,
    sys_len: (chatReq.messages[0].content as string).length,
    user_len: (chatReq.messages[1].content as string).length,
    api_key: red(OPENAI_API_KEY),
  });

  const chatResp = await withTimeout(
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatReq),
    }),
    55_000,
    'ChatCompletions fetch'
  );

  outlineHeaders(chatResp);

  let chatBody: any = null;
  try { chatBody = await chatResp.json(); } catch (e: any) {
    log(`❗ [${seq}] ChatAPI JSON parse error`, e?.message || String(e));
  }

  log(`✅ [${seq}] ChatAPI end`, { ok: chatResp.ok, status: chatResp.status });
  if (chatBody) outlineBody(chatBody);

  if (!chatResp.ok) {
    log(`❌ [${seq}] ChatAPI error body`, chatBody);
    throw new Error(chatBody?.error?.message || `OpenAI chat error ${chatResp.status}`);
  }

  const traceChat: string[] = [];
  const parsedChat = extractStructuredWithTrace<T>(chatBody, traceChat);
  log(`🔎 [${seq}] parse trace (chat)`, traceChat.join('\n'));
  if (!parsedChat) throw new Error('No model output');
  return parsedChat;
}

const sharedNameNote =
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon. Do NOT correct, substitute, or question it.';

const makeInput = (commonName?: string | null, scientificName?: string | null) => {
  const norm = (s?: string | null) => (s?.trim() ? s.trim() : '(unknown)');
  return `Common name: ${norm(commonName)}
Scientific name: ${norm(scientificName)}
Write in a neutral, factual tone. Keep paragraphs short.`;
};

// ================== Hook ====================
export function useGeneratePlantFacts() {
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<Result | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const run = useCallback(async ({ plantsTableId, commonName, scientificName }: Args) => {
    const t0 = now();
    setLoading(true);
    setError(null);

    try {
      log('🧭 useGeneratePlantFacts.start', {
        plantsTableId, commonName, scientificName,
        supabaseUrlHash: hash(SUPABASE_URL),
        supabaseKeyHash: hash(SUPABASE_ANON_KEY),
        hasOpenAIKey: !!OPENAI_API_KEY,
      });

      const me = await supabase.auth.getUser();
      log('👤 auth.getUser', me.error ? { error: me.error.message } : { userId: me.data.user?.id });

      const tPre = now();
      const preSel = (await supabase
        .from('plants')
        .select('id, description, availability, rarity')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{ id: string; description: string | null; availability: string | null; rarity: string | null }>;
      log('🔎 pre-select', { took: dur(tPre), error: preSel.error?.message, dataPresent: !!preSel.data });

      const input = makeInput(commonName, scientificName);

      // 1) Description + Meta
      const descMetaInstr = [
        'You are a precise botany writer.',
        sharedNameNote,
        'Output MUST match the JSON schema exactly.',
        'description: exactly two SHORT paragraphs about the plant itself (morphology, habitat, taxonomy). No care tips.',
        'Reply ONLY with a single JSON object that matches the schema exactly. No prose.',
      ].join(' ');
      log('🚀 OpenAI (desc+meta)');
      const part1 = await openAIJson<{ description: string; rarity_level: Rarity; availability_status: Availability }>(
        SCHEMA_DESC_META, descMetaInstr, input, 900
      );

      // 2) Propagation
      const propInstr = [
        'You are a precise botany writer.',
        sharedNameNote,
        'Output MUST match the JSON schema exactly.',
        'Return only realistic methods for THIS species; each item is one concise, actionable paragraph.',
        'Reply ONLY with a single JSON object that matches the schema exactly. No prose.',
      ].join(' ');
      log('🚀 OpenAI (propagation)');
      const part2 = await openAIJson<{ propagation_techniques: PropTechnique[] }>(
        SCHEMA_PROPAGATION, propInstr, input, 800
      );

      // 3) Soil
      const soilInstr = [
        'You are a precise botany writer.',
        sharedNameNote,
        'Output MUST match the JSON schema exactly.',
        'One concise paragraph describing ideal soil properties and a best-practice mix.',
        'Reply ONLY with a single JSON object that matches the schema exactly. No prose.',
      ].join(' ');
      log('🚀 OpenAI (soil)');
      const part3 = await openAIJson<{ soil_description: string }>(
        SCHEMA_SOIL, soilInstr, input, 600
      );

      const merged: Result = {
        description: part1.description,
        availability_status: part1.availability_status,
        rarity_level: part1.rarity_level,
        propagation_techniques: part2.propagation_techniques,
        soil_description: part3.soil_description,
      };

      // Normalize techniques for DB JSONB
      const techniquesNormalized = (merged.propagation_techniques || []).map(t => ({
        method: normalizeMethodLabel(t.method),
        difficulty: t.difficulty,
        description: t.description,
      }));

      const payload = {
        description: merged.description,
        availability: AVAIL[merged.availability_status] ?? 'unknown',
        rarity: RARITY[merged.rarity_level] ?? 'unknown',
        soil_description: merged.soil_description,
        propagation_methods_json: techniquesNormalized, // << JSONB column
      };
      log('📝 update payload', { ...payload, description: payload.description.slice(0, 60) + '…' });

      const tUpd = now();
      const upd = await withTimeout<SBResp>(
        supabase.from('plants').update(payload).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
        15_000,
        'Supabase update(plants)'
      );
      log('🛠️ update(plants) done', { took: dur(tUpd), error: upd.error?.message, status: upd.status });
      if (upd.error) throw upd.error;

      const post = (await supabase
        .from('plants')
        .select('id, description, availability, rarity, soil_description, propagation_methods_json')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{
          id: string;
          description: string | null;
          availability: string | null;
          rarity: string | null;
          soil_description: string | null;
          propagation_methods_json: { method: CanonMethod; difficulty: Difficulty; description: string }[] | null;
        }>;
      log('🔎 post-select', { error: post.error?.message, dataPresent: !!post.data });

      const metaStuck =
        !!post.data &&
        post.data.description === payload.description &&
        (post.data.availability !== payload.availability || post.data.rarity !== payload.rarity);

      if (metaStuck) {
        log('⚠️ meta did not change with JSON update — trying targeted update / RPC fallback');
        const updCols = (await supabase
          .from('plants')
          .update({ availability: payload.availability, rarity: payload.rarity })
          .eq('id', plantsTableId)
          .select('id, availability, rarity')
          .maybeSingle()) as SBResp<{ id: string; availability: string | null; rarity: string | null }>;
        if (updCols.error) {
          await rpcSetMeta(plantsTableId, payload.availability as Availability, payload.rarity as Rarity);
        }
      }

      setData(merged);
      log('✅ useGeneratePlantFacts.success total', dur(t0));
      return merged;

    } catch (e: any) {
      log('🔥 useGeneratePlantFacts.error', {
        message: e?.message, code: e?.code, details: e?.details, hint: e?.hint,
        stack: e?.stack ? String(e.stack).split('\n').slice(0, 3).join('\n') : undefined,
      });
      setError(e?.message ?? 'Failed to generate plant facts');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, run };
}
