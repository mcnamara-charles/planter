export type Plant = {
  id: string;
  name: string;
  scientificName: string;
  imageUri: string;
  location?: string;
  genus?: string;
  speciesTaxonId?: string | null;
  lineage?: string | null;
  lightType?: 'grow_light' | 'sunlight' | null;
  systemType?: 'normal' | 'reservoir' | null;
  scheduleSameYearRound?: boolean | null;
  waterDelay?: number | null;
  hasActivePest?: boolean;
};


