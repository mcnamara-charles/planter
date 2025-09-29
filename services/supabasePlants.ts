// services/supabasePlants.ts
import { supabase } from '@/services/supabaseClient';
import type { RowShape } from '@/hooks/generatePlantData/types';

export async function readPlantRow(id: string) {
  const { data, error } = await supabase
    .from('plants')
    .select(`
      id, plant_name, description, availability, rarity,
      care_light, care_water, care_temp_humidity, care_fertilizer, care_pruning,
      soil_description, propagation_methods_json, data_response_version
    `)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as RowShape | null;
}

export async function savePlantsRow<T extends Record<string, any>>(id: string, payload: T) {
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
