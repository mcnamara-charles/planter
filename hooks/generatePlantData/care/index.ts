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
    const promises: Promise<any>[] = [];
    
    // Profile (needed for light/water)
    let profilePromise: Promise<Profile | null> = Promise.resolve(null);
    if (!hasLight || !hasWater) {
      profilePromise = (async () => {
        const sciKey = (scientificName || '').trim().toLowerCase();
        const hard = HARD_RULES[sciKey] || null;
        if (hard) {
          const filled = await openAIJson<Profile>(
            SCHEMA_PROFILE, profileInstructions(),
            `${baseInput}\n${unitsNote}\nUse these fixed defaults if sensible: ${JSON.stringify(hard)}\nOnly output JSON.`, 500, 500
          );
          return sanitizeProfile({ ...filled, ...hard } as Profile);
        }
        const filled = await openAIJson<Profile>(
          SCHEMA_PROFILE, profileInstructions(),
          `${baseInput}\n${unitsNote}\nOnly output JSON.`, 500, 500
        );
        return sanitizeProfile(filled);
      })();
    }

    // Independent care fields
    if (!hasTempHum) {
      promises.push(openAIJson<{ care_temp_humidity: string }>(
        SCHEMA_TEMP_HUM,
        ['You are a precise botany/cultivation writer.', sharedNameNote, unitsNote, 'Return ONLY JSON.',
         'One paragraph with numeric temperature ranges in °F, humidity ranges in %, and damage thresholds for THIS species.',
         'Do not include metric equivalents or parentheticals.'].join(' '),
        baseInput, 800, 800
      ));
    }

    if (!hasFert) {
      promises.push(openAIJson<{ care_fertilizer: string }>(
        SCHEMA_FERT,
        ['You are a precise botany/cultivation writer.', sharedNameNote, unitsNote, 'Return ONLY JSON.',
         'Two sentences: formulation/dilution, then frequency/seasonality. Use inches and °F if any units arise.',
         'Do not include metric equivalents or parentheses.'].join(' '),
        baseInput, 400, 400
      ));
    }

    if (!hasPrune) {
      promises.push(openAIJson<{ care_pruning: string }>(
        SCHEMA_PRUNE,
        ['You are a precise botany/cultivation writer.', sharedNameNote, unitsNote, 'Return ONLY JSON.',
         '2–3 sentences: when/why/how to prune THIS species; tie to plant form.',
         'Do not include metric equivalents or parentheses.'].join(' '),
        baseInput, 500, 500
      ));
    }

    if (!hasSoil) {
      promises.push(openAIJson<{ soil_description: string }>(
        SCHEMA_SOIL,
        ['You are a precise botany/cultivation writer.', sharedNameNote, unitsNote, 'Return ONLY JSON.',
         'Three sentences: ideal soil properties + best-practice mix for THIS species.',
         'Use inches and °F only if you mention units; do not include metric equivalents or parentheses.'].join(' '),
        baseInput, 500, 500
      ));
    }

    if (!hasProp) {
      promises.push(openAIJson<{ propagation_techniques: { method: CanonMethod; difficulty: Difficulty; description: string }[] }>(
        SCHEMA_PROP,
        ['You are a precise botany writer.', sharedNameNote, unitsNote,
         'Output MUST match the JSON schema exactly and return ONLY JSON.',
         'Techniques MUST be realistic for THIS species; include concrete anatomy cues and counts/timings.',
         'Use inches and °F only; do not include metric equivalents or parentheses.',
         'One compact paragraph per technique; 1–3 techniques total.'].join(' '),
        baseInput, 800, 800
      ));
    }

    const [profile, ...careResults] = await Promise.all([profilePromise, ...promises]);
    
    return {
      profile,
      tempHum: careResults[0] || { care_temp_humidity: existing.care_temp_humidity },
      fert: careResults[1] || { care_fertilizer: existing.care_fertilizer },
      prune: careResults[2] || { care_pruning: existing.care_pruning },
      soil: careResults[3] || { soil_description: existing.soil_description },
      prop: careResults[4] || { propagation_techniques: existing.propagation_techniques }
    };
  }, onProgress);

  // Stage 2: Light (depends on profile)
  const light = await stage('stage2_light', 'Stage 2: Light requirements', async () => {
    if (hasLight) {
      return { care_light: existing.care_light };
    }
    if (!stage1Results.profile) throw new Error('Profile required to render care_light');
    return { care_light: renderLightFromProfile(stage1Results.profile) };
  }, onProgress);

  // Stage 3: Water (depends on profile and light)
  const water = await stage('stage3_water', 'Stage 3: Water schedule', async () => {
    if (hasWater) {
      return { care_water: existing.care_water };
    }
    if (!stage1Results.profile) throw new Error('Profile required to render care_water');
    const templatedWater = fixContradictions(light.care_light, renderWaterFromProfile(stage1Results.profile));
    return { care_water: templatedWater };
  }, onProgress);

  // Handle propagation method normalization
  if (stage1Results.prop && !hasProp) {
    stage1Results.prop.propagation_techniques = stage1Results.prop.propagation_techniques.map((p: any) => ({ 
      ...p, 
      method: normalizeMethodLabel(p.method) 
    }));
  }

  const result: CareResult = {
    care_light: light.care_light,
    care_water: water.care_water,
    care_temp_humidity: stage1Results.tempHum.care_temp_humidity,
    care_fertilizer: stage1Results.fert.care_fertilizer,
    care_pruning: stage1Results.prune.care_pruning,
    soil_description: stage1Results.soil.soil_description,
    propagation_techniques: stage1Results.prop.propagation_techniques
  };

  const payload: Record<string, any> = {};
  if (!hasLight)   payload.care_light = result.care_light;
  if (!hasWater)   payload.care_water = result.care_water;
  if (!hasTempHum) payload.care_temp_humidity = result.care_temp_humidity;
  if (!hasFert)    payload.care_fertilizer = result.care_fertilizer;
  if (!hasPrune)   payload.care_pruning = result.care_pruning;
  if (!hasSoil)    payload.soil_description = result.soil_description;
  if (!hasProp)    payload.propagation_methods_json = result.propagation_techniques;

  if (Object.keys(payload).length) {
    await stage('care_db_write','Saving care details', async () => savePlantsRow(plantId, payload));
  }

  return { result, payload };
}
