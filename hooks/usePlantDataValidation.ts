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
const REQUIRED_CARE_FIELDS = ['care_light', 'care_water', 'care_temp_humidity', 'care_fertilizer', 'care_pruning', 'soil_description', 'propagation_methods_json'] as const;

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

  data_response_version: number | null;
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
        .select(`
          description, availability, rarity, plant_name,
          care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning, soil_description, propagation_methods_json,
          data_response_version
        `)
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

      const needsGeneration = missingFacts.length > 0 || missingCare.length > 0 || forced.length > 0;

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

  return { validationResult, validatePlantData, hideModal };
}
