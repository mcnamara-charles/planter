// hooks/generatePlantData/types.ts
export type Difficulty = 'easy' | 'moderate' | 'challenging' | 'very_challenging';
export type CanonMethod = 'cuttings' | 'division' | 'leaf' | 'offsets' | 'seed' | 'air_layering';
export type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available';
export type Rarity = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare';

export type FactsResult = {
  description: string;
  availability_status: Availability;
  rarity_level: Rarity;
  suggested_common_name: string | null;
};

export type CareResult = {
    care_light: string;
    care_water: string;
    care_temp_humidity: string;
    care_fertilizer: string;
    care_pruning: string;
    soil_description: string; // ← required
    propagation_techniques: { method: CanonMethod; difficulty: Difficulty; description: string }[]; // ← required
};

export type CareFragment = {
    care_light?: string;
    care_water?: string;
    care_temp_humidity?: string;
    care_fertilizer?: string;
    care_pruning?: string;
    soil_description?: string;
    propagation_techniques?: { method: CanonMethod; difficulty: Difficulty; description: string }[];
  };

  export type CareResultView = {
    care_light: string;
    care_water: string;
    care_temp_humidity: string;
    care_fertilizer: string;
    care_pruning: string;
    soil_description: string;
    propagation_techniques: { method: CanonMethod; difficulty: Difficulty; description: string }[];
  };

export type RowShape = {
  id: string;
  plant_name: string | null;
  description: string | null;
  availability: Availability | null;
  rarity: Rarity | null;
  care_light: string | null;
  care_water: string | null;
  care_temp_humidity: string | null;
  care_fertilizer: string | null;
  care_pruning: string | null;
  soil_description: string | null;
  propagation_methods_json: { method: CanonMethod; difficulty: Difficulty; description: string }[] | null;
  data_response_version: number | null;
};

export type CombinedResult = FactsResult & CareResult;

export type Args = {
  plantsTableId: string;
  commonName?: string | null;
  scientificName?: string | null;
};

export type StageKey =
  | 'db_read' | 'facts_generation' | 'facts_db_write'
  | 'stage1_parallel' | 'stage2_light' | 'stage3_water'
  | 'profile' | 'care_light' | 'care_water' | 'care_temp_humidity'
  | 'care_fertilizer' | 'care_pruning' | 'care_soil_description'
  | 'care_propagation' | 'care_db_write' | 'done';

export type ProgressStatus = 'pending' | 'running' | 'success' | 'error';

export type ProgressEvent = {
  key: StageKey;
  label: string;
  status: ProgressStatus;
  startedAt?: number;
  endedAt?: number;
  percent?: number;
};
