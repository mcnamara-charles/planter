// hooks/generatePlantData/index.ts
import { useState, useCallback } from 'react';
import { readPlantRow, savePlantsRow } from '@/services/supabasePlants';
import { computeForcedFieldsSince, CURRENT_RULESET_VERSION } from '@/utils/lib/plantRuleset';
import { useStages, STAGE_LABELS } from './stages';
import type { Args, CombinedResult } from './types';
import { generateFacts, makeInput } from './facts';
import { generateCare } from './care';

const OPENAI_MODEL = 'gpt-4.1-mini';

export function useGeneratePlantData() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CombinedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { events: progressEvents, stage } = useStages();

  const run = useCallback(async (args: Args, onProgress?: (e:any)=>void) => {
    try {
      setLoading(true); setError(null); setData(null);

      const db = await stage('db_read', STAGE_LABELS.db_read, () => readPlantRow(args.plantsTableId), onProgress);

      const rowVersion = db?.data_response_version ?? 0;
      const forced = computeForcedFieldsSince(rowVersion, CURRENT_RULESET_VERSION);

      const hasDesc   = !!db?.description?.trim() && !forced.has('description');
      const hasAvail  = !!db?.availability && db.availability !== 'unknown' && !forced.has('availability');
      const hasRarity = !!db?.rarity && db.rarity !== 'unknown' && !forced.has('rarity');
      const hasName   = !!db?.plant_name?.trim() && !forced.has('plant_name');

      const hasLight  = !!db?.care_light?.trim() && !forced.has('care_light');
      const hasWater  = !!db?.care_water?.trim() && !forced.has('care_water');
      const hasTemp   = !!db?.care_temp_humidity?.trim() && !forced.has('care_temp_humidity');
      const hasFert   = !!db?.care_fertilizer?.trim() && !forced.has('care_fertilizer');
      const hasPrune  = !!db?.care_pruning?.trim() && !forced.has('care_pruning');
      const hasSoil   = !!db?.soil_description?.trim() && !forced.has('soil_description');
      const hasProp   = Array.isArray(db?.propagation_methods_json) && db!.propagation_methods_json!.length > 0 && !forced.has('propagation_methods_json');

      const needsFacts = !(hasDesc && hasAvail && hasRarity && hasName);
      const needsCare  = !(hasLight && hasWater && hasTemp && hasFert && hasPrune && hasSoil && hasProp);

      // Facts
      const facts = await generateFacts({
        plantId: args.plantsTableId,
        hasDesc, hasAvail, hasRarity, hasName,
        existing: { description: db?.description ?? '', availability: db?.availability ?? 'unknown', rarity: db?.rarity ?? 'unknown' },
        commonName: db?.plant_name || args.commonName,
        scientificName: args.scientificName,
        stage, onProgress
      });

      // Care
      let careRes = {
        care_light: db?.care_light ?? '',
        care_water: db?.care_water ?? '',
        care_temp_humidity: db?.care_temp_humidity ?? '',
        care_fertilizer: db?.care_fertilizer ?? '',
        care_pruning: db?.care_pruning ?? '',
        soil_description: db?.soil_description ?? '',
        propagation_techniques: db?.propagation_methods_json ?? []
      };

      if (needsCare) {
        const baseInput = makeInput(db?.plant_name || args.commonName, args.scientificName);
        const { result } = await generateCare({
          plantId: args.plantsTableId,
          hasLight, hasWater, hasTempHum: hasTemp, hasFert, hasPrune, hasSoil, hasProp,
          baseInput, scientificName: args.scientificName,
          existing: {
            care_light: db?.care_light ?? '',
            care_water: db?.care_water ?? '',
            care_temp_humidity: db?.care_temp_humidity ?? '',
            care_fertilizer: db?.care_fertilizer ?? '',
            care_pruning: db?.care_pruning ?? '',
            soil_description: db?.soil_description ?? '',
            propagation_techniques: db?.propagation_methods_json ?? []
          },
          stage, onProgress
        });
        careRes = result;
      }

      // bump version if anything changed
      if ((needsFacts || needsCare) && rowVersion < CURRENT_RULESET_VERSION) {
        await savePlantsRow(args.plantsTableId, {
          data_response_version: CURRENT_RULESET_VERSION,
          data_response_meta: { model: OPENAI_MODEL, run_at: new Date().toISOString() }
        });
      }

      const finalResult: CombinedResult = {
        description: facts.description,
        availability_status: facts.availability_status,
        rarity_level: facts.rarity_level,
        suggested_common_name: facts.suggested_common_name,
        ...careRes
      };

      setData(finalResult);
      await stage('done', STAGE_LABELS.done, async () => ({} as any), onProgress);
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
