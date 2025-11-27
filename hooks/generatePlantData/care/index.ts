// hooks/generatePlantData/care/index.ts
import { openAIJson } from '@/services/openaiJson';
import { savePlantsRow } from '@/services/supabasePlants';
import type { CareResult, CanonMethod, Difficulty, StageKey } from '../types';
import { SCHEMA_PROFILE, SCHEMA_TEMP_HUM, SCHEMA_FERT, SCHEMA_PRUNE, SCHEMA_SOIL, SCHEMA_PROP } from './schemas';
import { Profile, HARD_RULES, profileInstructions, renderLightFromProfile, sanitizeProfile } from './profile';
import { renderWaterFromProfile, fixContradictions } from './render';

const unitsNote = 'Use U.S. customary units ONLY (inches, °F). Do NOT include metric equivalents or units in parentheses.';
const sharedNameNote =
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon…';

function normalizeMethodLabel(method: string): CanonMethod {
  const k = method.trim().toLowerCase();
  if (k.includes('air')) return 'air_layering';
  if (k.includes('leaf')) return 'leaf';
  if (k.includes('division') || k.includes('divide') || k.includes('rhizome')) return 'division';
  if (k.includes('offset') || k.includes('pup')) return 'offsets';
  if (k.includes('seed')) return 'seed';
  return 'cuttings';
}

export async function generateCare({
  plantId, hasLight, hasWater, hasTempHum, hasFert, hasPrune, hasSoil, hasProp,
  baseInput, scientificName, existing,
  stage, onProgress
}: {
  plantId: string;
  hasLight: boolean; hasWater: boolean; hasTempHum: boolean; hasFert: boolean; hasPrune: boolean; hasSoil: boolean; hasProp: boolean;
  baseInput: string; scientificName?: string|null;
  existing: {
    care_light: string;
    care_water: string;
    care_temp_humidity: string;
    care_fertilizer: string;
    care_pruning: string;
    soil_description: string;
    propagation_techniques: any[];
  };
  stage: <T>(key: StageKey, label: string, fn: () => Promise<T>, onProgress?: any) => Promise<T>;
  onProgress?: (e:any)=>void;
}): Promise<{ result: CareResult; payload: Record<string, any> }> {

  // Stage 1: Parallel generation (profile + independent care fields)
  const stage1Results = await stage('stage1_parallel', 'Stage 1: Parallel generation', async () => {
    // ----- PROFILE (needed for light/water) -----
    let profilePromise: Promise<Profile | null> = Promise.resolve(null);
    if (!hasLight || !hasWater) {
      profilePromise = (async () => {
        const sciKey = (scientificName || '').trim().toLowerCase();
        const hard = HARD_RULES[sciKey] || null;
        if (hard) {
          const filled = await openAIJson<Profile>(
            SCHEMA_PROFILE,
            profileInstructions(),
            `${baseInput}\n${unitsNote}\nUse these fixed defaults if sensible: ${JSON.stringify(hard)}\nOnly output JSON.`,
            500, 500
          );
          return sanitizeProfile({ ...filled, ...hard } as Profile);
        }
        const filled = await openAIJson<Profile>(
          SCHEMA_PROFILE,
          profileInstructions(),
          `${baseInput}\n${unitsNote}\nOnly output JSON.`,
          500, 500
        );
        return sanitizeProfile(filled);
      })();
    }

    // ----- INDEPENDENT FIELDS (track by key, not by index) -----
    const tasks: {
      tempHum?: Promise<{ care_temp_humidity: string }>;
      fert?: Promise<{ care_fertilizer: string }>;
      prune?: Promise<{ care_pruning: string }>;
      soil?: Promise<{ soil_description: string }>;
      prop?: Promise<{ propagation_techniques: { method: CanonMethod; difficulty: Difficulty; description: string; min_days: number; max_days: number }[] }>;
    } = {};

    if (!hasTempHum) {
      tasks.tempHum = openAIJson<{ care_temp_humidity: string }>(
        SCHEMA_TEMP_HUM,
        [
          'You are a precise botany/cultivation writer.',
          sharedNameNote, unitsNote, 'Return ONLY JSON.',
          'One paragraph with numeric temperature ranges in °F, humidity ranges in %, and damage thresholds for THIS species.',
          'Do not include metric equivalents or parentheticals.'
        ].join(' '),
        baseInput, 800, 800
      );
    }

    if (!hasFert) {
      tasks.fert = openAIJson<{ care_fertilizer: string }>(
        SCHEMA_FERT,
        [
          'You are a precise botany/cultivation writer.',
          sharedNameNote, unitsNote, 'Return ONLY JSON.',
          'Two sentences: formulation/dilution, then frequency/seasonality. Use inches and °F if any units arise.',
          'Do not include metric equivalents or parentheses.'
        ].join(' '),
        baseInput, 400, 400
      );
    }

    if (!hasPrune) {
      tasks.prune = openAIJson<{ care_pruning: string }>(
        SCHEMA_PRUNE,
        [
          'You are a precise botany/cultivation writer.',
          sharedNameNote, unitsNote, 'Return ONLY JSON.',
          '2–3 sentences: when/why/how to prune THIS species; tie to plant form.',
          'Do not include metric equivalents or parentheses.'
        ].join(' '),
        baseInput, 500, 500
      );
    }

    if (!hasSoil) {
      tasks.soil = openAIJson<{ soil_description: string }>(
        SCHEMA_SOIL,
        [
          'You are a precise botany/cultivation writer.',
          sharedNameNote, unitsNote, 'Return ONLY JSON.',
          'Three sentences: ideal soil properties + best-practice mix for THIS species.',
          'Use inches and °F only if you mention units; do not include metric equivalents or parentheses.'
        ].join(' '),
        baseInput, 500, 500
      );
    }

    if (!hasProp) {
      tasks.prop = openAIJson<{
        propagation_techniques: {
          method: CanonMethod;
          difficulty: Difficulty;
          description: string;
          min_days: number;
          max_days: number;
        }[];
      }>(
        SCHEMA_PROP,
        [
          'CRITICAL: Each propagation technique MUST include exactly these 5 fields: method, difficulty, description, min_days (number), max_days (number). Missing any field will cause the response to be rejected.',
          'You are a precise botany writer.',
          sharedNameNote,
          unitsNote,
          'Output MUST match the JSON schema exactly and return ONLY JSON.',
          'Techniques MUST be realistic for THIS species; include concrete anatomy cues and counts/timings.',
          'Difficulty MUST reflect estimated success rates UNDER IDEAL CONDITIONS:',
          'easy = >90% success, moderate = >60% success, challenging = >20% success, very_challenging = 5–20% success.',
          'Exclude techniques with <5% success probability (these are NOT valid options).',
          'min_days and max_days MUST reflect realistic timeframes for THIS species under ideal conditions.',
          'Use inches and °F only; do not include metric equivalents or parentheses.',
          'One compact paragraph per technique; 1–3 techniques total.'
        ].join(' '),
        baseInput, 800, 800
      );
    }

    // Resolve everything deterministically by key
    const [profile, resolved] = await Promise.all([
      profilePromise,
      (async () => {
        const entries = await Promise.all(
          Object.entries(tasks).map(async ([k, p]) => [k, await p] as const)
        );
        return Object.fromEntries(entries) as {
          tempHum?: { care_temp_humidity: string };
          fert?: { care_fertilizer: string };
          prune?: { care_pruning: string };
          soil?: { soil_description: string };
          prop?: { propagation_techniques: { method: CanonMethod; difficulty: Difficulty; description: string; min_days: number; max_days: number }[] };
        };
      })()
    ]);

    // Build result with safe fallbacks
    const result = {
      profile,
      tempHum: resolved.tempHum ?? { care_temp_humidity: existing.care_temp_humidity },
      fert:    resolved.fert    ?? { care_fertilizer:   existing.care_fertilizer   },
      prune:   resolved.prune   ?? { care_pruning:      existing.care_pruning      },
      soil:    resolved.soil    ?? { soil_description:  existing.soil_description  },
      prop:    resolved.prop    ?? { propagation_techniques: existing.propagation_techniques ?? [] }
    };

    // Normalize methods if we generated them this run
    if (resolved.prop) {
      result.prop.propagation_techniques = (result.prop.propagation_techniques ?? []).map((p: any) => ({
        ...p,
        method: normalizeMethodLabel(p.method)
      }));
    }

    return result;
  }, onProgress);

  // Stage 2: Light (depends on profile)
  const light = await stage('stage2_light', 'Stage 2: Light requirements', async () => {
    if (hasLight) return { care_light: existing.care_light };
    if (!stage1Results.profile) throw new Error('Profile required to render care_light');
    return { care_light: renderLightFromProfile(stage1Results.profile) };
  }, onProgress);

  // Stage 3: Water (depends on profile and light)
  const water = await stage('stage3_water', 'Stage 3: Water schedule', async () => {
    if (hasWater) return { care_water: existing.care_water };
    if (!stage1Results.profile) throw new Error('Profile required to render care_water');
    const templatedWater = fixContradictions(light.care_light, renderWaterFromProfile(stage1Results.profile));
    return { care_water: templatedWater };
  }, onProgress);

  // Assemble final care result
  const result: CareResult = {
    care_light: light.care_light,
    care_water: water.care_water,
    care_temp_humidity: stage1Results.tempHum.care_temp_humidity,
    care_fertilizer: stage1Results.fert.care_fertilizer,
    care_pruning: stage1Results.prune.care_pruning,
    soil_description: stage1Results.soil.soil_description,
    propagation_techniques: stage1Results.prop.propagation_techniques ?? []
  };

  // Build payload of only the fields we generated this run
  const payload: Record<string, any> = {};
  if (!hasLight)   payload.care_light = result.care_light;
  if (!hasWater)   payload.care_water = result.care_water;
  if (!hasTempHum) payload.care_temp_humidity = result.care_temp_humidity;
  if (!hasFert)    payload.care_fertilizer = result.care_fertilizer;
  if (!hasPrune)   payload.care_pruning = result.care_pruning;
  if (!hasSoil)    payload.soil_description = result.soil_description;

  // Write propagation methods if we *need* them (db empty or forced) and we have a non-empty array
  if (!hasProp && (result.propagation_techniques?.length ?? 0) > 0) {
    payload.propagation_methods_json = result.propagation_techniques;
  }

  if (Object.keys(payload).length) {
    await stage('care_db_write','Saving care details', async () => savePlantsRow(plantId, payload));
  }

  return { result, payload };
}