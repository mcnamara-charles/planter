// hooks/generatePlantData/schedule/index.ts
import { openAIJson } from '@/services/openaiJson';
import { savePlantsRow } from '@/services/supabasePlants';
import { SCHEMA_SCHEDULE, SCHEMA_CLASSIFY } from './schemas';

const SYSTEM_CLASSIFY = [
  'You are a precise horticulture taxonomy assistant.',
  'Return ONLY JSON that matches the provided schema.',
  'Infer growth_form, climate_archetype, indoor_suitability, dormancy, evergreen.',
  'If species is a bulb/tuber/corm OR a temperate herbaceous perennial, it almost certainly has a seasonal dormancy.',
  'Treat “houseplant” assumptions as FALSE unless species is commonly evergreen tropical foliage.',
].join(' ');

const SYSTEM_SCHEDULE = [
  'You are a precise horticulture scheduling assistant.',
  'Return ONLY JSON that matches the provided schema.',
  // IMPORTANT: remove the indoor bias here
  'Do NOT assume indoor care unless indoor_suitability is "indoor-only" or "indoor-possible"; otherwise assume outdoor temperate conditions.',
  // Floors become archetype-specific, not universal:
  'DEFAULT FLOORS by archetype:',
  '- evergreen tropical foliage: water interval >= 5 days; fert interval >= 28 days',
  '- succulent/cactus: water >= 10 days; fert >= 30 days',
  '- bulb/tuber/corm or temperate herbaceous: MUST have inactive season; water inactive >= 21–60 days (or null when dry storage); fert inactive = null',
  'If has_true_dormancy=true, set schedule_same_year_round=false and provide reasonable MM-DD bounds for a temperate Northern Hemisphere (USDA 5–7) cycle.',
  'Active dates should be realistic for the species archetype; do not return a year-round schedule for temperate bulbs.',
  'Intervals are species-level defaults (days), not user-personalized.',
].join(' ');

function normalizationNotes(commonName?: string|null, scientificName?: string|null) {
  const norm = (s?: string|null) => (s?.trim() ? s.trim() : '(unknown)');
  return [
    `Common name: ${norm(commonName)}`,
    `Scientific name (canonical): ${norm(scientificName)}`,
    'Store month/day as MM-DD (e.g., 03-15).',
  ].join('\n');
}

function toYear2000(mmdd: string) { return `2000-${mmdd}`; }

export async function generateSchedule({
  plantId, commonName, scientificName, stage, onProgress
}: {
  plantId: string;
  commonName?: string|null;
  scientificName?: string|null;
  stage: <T>(key: any, label: string, fn: () => Promise<T>, onProgress?: any) => Promise<T>;
  onProgress?: (e:any)=>void;
}) {
  const classify = await stage('taxonomy_classify', 'Classifying plant archetype', async () => {
    return openAIJson<{
      growth_form: string;
      climate_archetype: string;
      indoor_suitability: 'indoor-only'|'indoor-possible'|'outdoor-primarily';
      has_true_dormancy: boolean;
      evergreen: boolean;
    }>(
      SCHEMA_CLASSIFY,
      SYSTEM_CLASSIFY,
      normalizationNotes(commonName, scientificName),
      400,
      400
    );
  }, onProgress);

  const schedule = await stage('schedule_generation', 'Generating schedule defaults', async () => {
    const hints = [
      `growth_form=${classify.growth_form}`,
      `climate_archetype=${classify.climate_archetype}`,
      `indoor_suitability=${classify.indoor_suitability}`,
      `has_true_dormancy=${classify.has_true_dormancy}`,
      `evergreen=${classify.evergreen}`,
    ].join('\n');

    return openAIJson<{
      schedule_same_year_round: boolean;
      active_season_start_mmdd: string;
      active_season_end_mmdd: string;
      water_interval_days_active: number;
      water_interval_days_inactive: number | null;
      fert_interval_days_active: number;
      fert_interval_days_inactive: number | null;
    }>(
      SCHEMA_SCHEDULE,
      SYSTEM_SCHEDULE,
      normalizationNotes(commonName, scientificName) + '\n' + hints,
      400,
      400
    );
  }, onProgress);

  // Safety normalization
  let s = schedule;
  if (classify.has_true_dormancy) {
    s.schedule_same_year_round = false;
    // If the model ignored dormancy, enforce inactive season defaults
    if (!s.active_season_start_mmdd || !s.active_season_end_mmdd) {
      s.active_season_start_mmdd = '04-15';
      s.active_season_end_mmdd   = '09-30';
    }
    // Bulbs: inactive fert should be null; inactive water >= 21 or null for dry storage
    if (classify.growth_form === 'bulb/tuber/corm') {
      s.fert_interval_days_inactive = null;
      if (s.water_interval_days_inactive !== null && s.water_interval_days_inactive < 21) {
        s.water_interval_days_inactive = 21;
      }
    }
  }

  const dbRow = {
    schedule_same_year_round: s.schedule_same_year_round,
    active_season_start_date: toYear2000(s.active_season_start_mmdd),
    active_season_end_date:   toYear2000(s.active_season_end_mmdd),
    water_interval_days_active:   s.water_interval_days_active,
    water_interval_days_inactive: s.schedule_same_year_round ? (s.water_interval_days_active ?? null) : s.water_interval_days_inactive,
    fert_interval_days_active:    s.fert_interval_days_active,
    fert_interval_days_inactive:  s.schedule_same_year_round ? (s.fert_interval_days_active  ?? null) : s.fert_interval_days_inactive,
  };

  await stage('schedule_db_write', 'Saving schedule defaults', async () =>
    savePlantsRow(plantId, dbRow)
  );

  return { payload: dbRow, meta: { classify } };
}
