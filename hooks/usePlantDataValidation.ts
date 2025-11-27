// hooks/usePlantDataValidation.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/services/supabaseClient';
import { computeForcedFieldsSince, CURRENT_RULESET_VERSION } from '@/utils/lib/plantRuleset';

type ValidationResult = {
  needsGeneration: boolean;
  missingFacts: string[];
  missingCare: string[];
  forcedUpdates: string[];       // <— NEW: fields we will overwrite due to version bump
  targetVersion: number;         // <— NEW: display to user / logging
  currentRowVersion: number;     // <— NEW
  showModal: boolean;
};

const REQUIRED_FACTS_FIELDS = ['description', 'availability', 'rarity', 'plant_name'] as const;

const REQUIRED_CARE_FIELDS = [
  'care_light', 
  'care_water', 
  'care_temp_humidity', 
  'care_fertilizer', 
  'care_pruning', 
  'soil_description', 
  'propagation_methods_json'
] as const;

const REQUIRED_SCHEDULE_FIELDS = [
  'schedule_same_year_round',
  'active_season_start_date',
  'active_season_end_date',
  'water_interval_days_active',
  // inactive may equal active; still require one of inactive or same_year_round=true
  'fert_interval_days_active',
] as const;

type PlantData = {
  description: string | null;
  availability: string | null;
  rarity: string | null;
  plant_name: string | null;

  care_light: string | null;
  care_water: string | null;
  care_temp_humidity: string | null;
  care_fertilizer: string | null;
  care_pruning: string | null;
  soil_description: string | null;
  propagation_methods_json: any[] | null;

  schedule_same_year_round: boolean | null;
  active_season_start_date: string | null; // stored as '2000-MM-DD'
  active_season_end_date: string | null;
  water_interval_days_active: number | null;
  water_interval_days_inactive: number | null;
  fert_interval_days_active: number | null;
  fert_interval_days_inactive: number | null;

  data_response_version: number | null;
};


const REQUIRED_SELECT = `
  description, availability, rarity, plant_name,
  care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning, soil_description, propagation_methods_json,
  schedule_same_year_round, active_season_start_date, active_season_end_date,
  water_interval_days_active, water_interval_days_inactive,
  fert_interval_days_active,  fert_interval_days_inactive,
  data_response_version
`;

const needsScheduleBlock = (p: PlantData) => {
  const isPos = (n: number | null | undefined) => typeof n === 'number' && n > 0;

  const hasSameFlag   = typeof p.schedule_same_year_round === 'boolean';
  const hasActiveDates =
    !!p.active_season_start_date && !!p.active_season_end_date;

  const hasActiveWater = isPos(p.water_interval_days_active);
  const hasActiveFert  = isPos(p.fert_interval_days_active);

  // If same-year-round, inactive fields are irrelevant.
  // Otherwise: accept NULL as a valid "no action during dormancy".
  const inactiveOK = p.schedule_same_year_round === true
    ? true
    : (
        (p.water_interval_days_inactive === null || isPos(p.water_interval_days_inactive)) &&
        (p.fert_interval_days_inactive  === null || isPos(p.fert_interval_days_inactive))
      );

  // Must have: flag, dates, active water/fert, and valid inactive setup.
  return !(hasSameFlag && hasActiveDates && hasActiveWater && hasActiveFert && inactiveOK);
};

export function usePlantDataValidation() {
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    needsGeneration: false,
    missingFacts: [],
    missingCare: [],
    forcedUpdates: [],
    targetVersion: CURRENT_RULESET_VERSION,
    currentRowVersion: 0,
    showModal: false,
  });

  const validatePlantData = useCallback(async (plantsTableId: string): Promise<ValidationResult> => {
    try {
      const { data, error } = await supabase
        .from('plants')
        .select(REQUIRED_SELECT)
        .eq('id', plantsTableId)
        .maybeSingle();
      if (error) throw error;

      const plant = data as PlantData | null;
      if (!plant) {
        const r: ValidationResult = {
          needsGeneration: true,
          missingFacts: [...REQUIRED_FACTS_FIELDS],
          missingCare: [...REQUIRED_CARE_FIELDS],
          forcedUpdates: [],
          targetVersion: CURRENT_RULESET_VERSION,
          currentRowVersion: 0,
          showModal: true,
        };
        setValidationResult(r);
        return r;
      }

      const missingFacts: string[] = [];
      const missingCare: string[] = [];

      if (!plant.description?.trim()) missingFacts.push('description');
      if (!plant.availability?.trim()) missingFacts.push('availability');
      if (!plant.rarity?.trim()) missingFacts.push('rarity');
      if (!plant.plant_name?.trim()) missingFacts.push('plant_name');

      if (!plant.care_light?.trim()) missingCare.push('care_light');
      if (!plant.care_water?.trim()) missingCare.push('care_water');
      if (!plant.care_temp_humidity?.trim()) missingCare.push('care_temp_humidity');
      if (!plant.care_fertilizer?.trim()) missingCare.push('care_fertilizer');
      if (!plant.care_pruning?.trim()) missingCare.push('care_pruning');
      if (!plant.soil_description?.trim()) missingCare.push('soil_description');
      if (!Array.isArray(plant.propagation_methods_json) || plant.propagation_methods_json.length === 0) {
        missingCare.push('propagation_methods_json');
      }

      const rowVersion = plant.data_response_version ?? 0;
      const forced = Array.from(computeForcedFieldsSince(rowVersion, CURRENT_RULESET_VERSION));
      console.log('[plantRuleset DEBUG]', {
        rowVersion,
        seenTargetVersion: CURRENT_RULESET_VERSION,
        forced
      });

      const scheduleForced = forced.includes('schedule');
      const needsSchedule = !plant || scheduleForced || needsScheduleBlock(plant);

      const needsGeneration = missingFacts.length > 0 || missingCare.length > 0 || forced.length > 0 || needsSchedule;

      const result: ValidationResult = {
        needsGeneration,
        missingFacts,
        missingCare,
        forcedUpdates: forced,
        targetVersion: CURRENT_RULESET_VERSION,
        currentRowVersion: rowVersion,
        showModal: needsGeneration,
      };

      setValidationResult(result);
      return result;
    } catch (error) {
      console.error('Error validating plant data:', error);
      const r: ValidationResult = {
        needsGeneration: true,
        missingFacts: [...REQUIRED_FACTS_FIELDS],
        missingCare: [...REQUIRED_CARE_FIELDS],
        forcedUpdates: [],
        targetVersion: CURRENT_RULESET_VERSION,
        currentRowVersion: 0,
        showModal: true,
      };
      setValidationResult(r);
      return r;
    }
  }, []);

  const hideModal = useCallback(() => {
    setValidationResult(prev => ({ ...prev, showModal: false }));
  }, []);

  const resetValidation = useCallback(() => {
    setValidationResult({
      needsGeneration: false,
      missingFacts: [],
      missingCare: [],
      forcedUpdates: [],
      targetVersion: CURRENT_RULESET_VERSION,
      currentRowVersion: 0,
      showModal: false,
    });
  }, []);

  return { validationResult, validatePlantData, hideModal, resetValidation };
}
