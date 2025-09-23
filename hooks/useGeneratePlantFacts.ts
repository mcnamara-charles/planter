// hooks/useGeneratePlantFacts.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } from '@env';

type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available';
type Rarity = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare';

type Result = {
  description: string;
  availability_status: Availability;
  rarity_level: Rarity;
};

type Args = {
  plantsTableId: string;
  commonName?: string | null;
  scientificName?: string | null;
};

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: {
      type: 'string',
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
    }
  },
  required: ['description', 'rarity_level', 'availability_status']
} as const;

// ---- tiny helpers ----
const now = () => Date.now();
const dur = (t0: number) => `${Date.now() - t0}ms`;
const hash = (s?: string) => (s ? String(s).slice(0, 6) + '…' + String(s).slice(-6) : '(missing)');
const j = (x: any, max = 1200) => {
  try {
    const s = JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
    return s.length > max ? s.slice(0, max) + ' …(truncated)' : s;
  } catch {
    return String(x);
  }
};

// Accept PromiseLike (Supabase builders are thenables)
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

// ===== Fallback RPC to set availability/rarity server-side =====
async function rpcSetMeta(id: string, availability: Availability, rarity: Rarity) {
  console.log('🧪 RPC.set_plant_meta.begin', { id, availability, rarity });
  const r = (await supabase.rpc('set_plant_meta', {
    p_id: id,
    p_availability: availability,
    p_rarity: rarity,
  })) as SBResp;
  console.log('🧪 RPC.set_plant_meta.end', { status: r.status, error: r.error?.message });
  return r;
}

export function useGeneratePlantFacts() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async ({ plantsTableId, commonName, scientificName }: Args) => {
    const t0 = now();
    setLoading(true);
    setError(null);

    try {
      // ====== ENV + INPUTS ======
      console.log('🧭 useGeneratePlantFacts.start', {
        plantsTableId,
        commonName,
        scientificName,
        supabaseUrlHash: hash(SUPABASE_URL),
        supabaseKeyHash: hash(SUPABASE_ANON_KEY),
        hasOpenAIKey: !!OPENAI_API_KEY,
      });

      const me = await supabase.auth.getUser();
      console.log('👤 auth.getUser', me.error ? { error: me.error.message } : { userId: me.data.user?.id });

      // Pre-select
      const tPre = now();
      const preSel = (await supabase
        .from('plants')
        .select('id, description, availability, rarity')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{ id: string; description: string | null; availability: string | null; rarity: string | null }>;
      console.log('🔎 pre-select', { took: dur(tPre), error: preSel.error?.message, dataPresent: !!preSel.data });

      // ====== OpenAI ======
      const instructions =
        'You are a precise botany writer. Output MUST follow the JSON schema. Do NOT include care instructions.';
      const input =
        `Plant: ${commonName?.trim() || '(unknown common name)'}${scientificName?.trim() ? ` (${scientificName!.trim()})` : ''}.\n` +
        `Write in a neutral, factual tone. Keep description to two short paragraphs.`;

      const reqBody = {
        model: 'gpt-5-mini',
        instructions,
        input,
        max_output_tokens: 800,
        temperature: 0.2,
        text: {
          format: {
            type: 'json_schema',
            name: 'plant_facts',
            schema: JSON_SCHEMA,
            strict: true,
          },
        },
      };

      const tAI = now();
      console.log('🚀 OpenAI.fetch.begin');
      const resp = await withTimeout(
        fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reqBody),
        }),
        20000,
        'OpenAI fetch'
      );
      console.log('✅ OpenAI.fetch.end', dur(tAI), 'ok=', resp.ok, 'status=', resp.status);
      if (!resp.ok) {
        const errBody = await safeJson(resp);
        console.log('❌ OpenAI.error', j(errBody));
        throw new Error(errBody?.error?.message || `OpenAI error ${resp.status}`);
      }
      const body = await resp.json();
      console.log('📦 OpenAI.body (snippet)', j(body));

      const result = extractStructured<Result>(body);
      console.log('🧩 parsed result', result ? {
        types: {
          description: typeof result.description,
          availability_status: typeof result.availability_status,
          rarity_level: typeof result.rarity_level,
        }
      } : { parsed: null });

      if (!result) throw new Error('No model output');
      if (typeof result.description !== 'string' || !result.rarity_level || !result.availability_status) {
        console.log('❌ Model result invalid', j(result));
        throw new Error('Model returned incomplete structured data');
      }

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

      const payload = {
        description: result.description,
        availability: AVAIL[result.availability_status] ?? 'unknown',
        rarity: RARITY[result.rarity_level] ?? 'unknown',
      };
      console.log('📝 update payload', j({ ...payload, description: payload.description.slice(0, 60) + '…' }));

      // ====== UPDATE #1: do the whole JSON (PostgREST may strip columns) ======
      const tUpdAll = now();
      const updAll = await withTimeout<SBResp>(
        supabase.from('plants').update(payload).eq('id', plantsTableId) as unknown as PromiseLike<SBResp>,
        15000,
        'Supabase update(all)'
      );
      console.log('🛠️  update(all) done', { took: dur(tUpdAll), error: updAll.error?.message, status: updAll.status });

      if (updAll.error) {
        console.log('❌ UPDATE(all) error detail', {
          code: updAll.error.code, details: updAll.error.details, hint: updAll.error.hint, message: updAll.error.message,
        });
        throw updAll.error;
      }

      // ====== POST-SELECT 1 ======
      const post1 = (await supabase
        .from('plants')
        .select('id, description, availability, rarity')
        .eq('id', plantsTableId)
        .maybeSingle()) as SBResp<{ id: string; description: string | null; availability: string | null; rarity: string | null }>;
      console.log('🔎 post-select#1', { error: post1.error?.message, data: post1.data });

      // If description moved but meta didn’t, PostgREST likely stripped those columns
      const metaStuck =
        !!post1.data &&
        post1.data.description === payload.description &&
        (post1.data.availability !== payload.availability || post1.data.rarity !== payload.rarity);

      if (metaStuck) {
        console.log('⚠️ availability/rarity did not change with JSON update — likely column UPDATE privilege/RLS check issue.');

        // ====== UPDATE #2 (targeted RETURNING): try each column explicitly
        const tUpdCols = now();
        const updCols = (await supabase
          .from('plants')
          .update({ availability: payload.availability, rarity: payload.rarity })
          .eq('id', plantsTableId)
          .select('id, availability, rarity')
          .maybeSingle()) as SBResp<{ id: string; availability: string | null; rarity: string | null }>;
        console.log('🛠️  update(columns) RETURNING', { took: dur(tUpdCols), error: updCols.error?.message, data: updCols.data });

        // ====== POST-SELECT 2 ======
        const post2 = (await supabase
          .from('plants')
          .select('id, description, availability, rarity')
          .eq('id', plantsTableId)
          .maybeSingle()) as SBResp<{ id: string; description: string | null; availability: string | null; rarity: string | null }>;
        console.log('🔎 post-select#2', { error: post2.error?.message, data: post2.data });

        const stillStuck =
          !!post2.data &&
          (post2.data.availability !== payload.availability || post2.data.rarity !== payload.rarity);

        if (stillStuck) {
          console.log('🧯 Falling back to RPC.set_plant_meta (server-side update)…');
          await rpcSetMeta(plantsTableId, payload.availability as Availability, payload.rarity as Rarity);

          // POST-SELECT 3
          const post3 = (await supabase
            .from('plants')
            .select('id, description, availability, rarity')
            .eq('id', plantsTableId)
            .maybeSingle()) as SBResp<{ id: string; description: string | null; availability: string | null; rarity: string | null }>;
          console.log('🔎 post-select#3', { error: post3.error?.message, data: post3.data });

          if (post3.data?.availability !== payload.availability || post3.data?.rarity !== payload.rarity) {
            console.log('❌ Even RPC did not stick. Almost certainly column GRANT or RLS WITH CHECK is blocking changes.');
          } else {
            console.log('✅ RPC path updated availability/rarity successfully.');
          }
        }
      }

      setData(result);
      console.log('✅ useGeneratePlantFacts.success total', dur(t0));
      return result;

    } catch (e: any) {
      console.log('🔥 useGeneratePlantFacts.error', {
        message: e?.message, code: e?.code, details: e?.details, hint: e?.hint,
        stack: e?.stack ? String(e.stack).split('\n').slice(0, 3).join('\n') : undefined,
      });
      const msg = e?.message ?? 'Failed to generate plant facts';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, data, error, run };
}

// ===== helpers =====

function extractStructured<T = any>(json: any): T | null {
  if (json?.output_parsed) return json.output_parsed as T;
  if (json?.parsed) return json.parsed as T;
  const output = Array.isArray(json?.output) ? json.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (c?.parsed) return c.parsed as T;
      if (typeof c?.text === 'string' && looksLikeJson(c.text)) {
        try { return JSON.parse(c.text) as T; } catch {}
      }
      if (c?.json && typeof c.json === 'object') return c.json as T;
    }
  }
  if (typeof json?.output_text === 'string' && looksLikeJson(json.output_text)) {
    try { return JSON.parse(json.output_text) as T; } catch {}
  }
  if (typeof json?.choices?.[0]?.message?.content === 'string' && looksLikeJson(json.choices[0].message.content)) {
    try { return JSON.parse(json.choices[0].message.content) as T; } catch {}
  }
  return null;
}

function looksLikeJson(s: string) {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

async function safeJson(r: Response) {
  try { return await r.json(); } catch { return null; }
}
