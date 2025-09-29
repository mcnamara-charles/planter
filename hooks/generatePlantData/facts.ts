// hooks/generatePlantData/facts.ts
import { openAIJson } from '@/services/openaiJson';
import { savePlantsRow } from '@/services/supabasePlants';
import type { Availability, FactsResult, Rarity, StageKey } from './types';

const SCHEMA_NAME_ONLY = {
  type: 'object',
  additionalProperties: false,
  properties: { suggested_common_name: { type: ['string', 'null'] } },
  required: ['suggested_common_name'],
} as const;

const SCHEMA_DESC_META = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: { type: 'string', maxLength: 900 },
    rarity_level: { type: 'string', enum: ['unknown', 'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare'] },
    availability_status: { type: 'string', enum: ['unknown', 'not_in_trade', 'rarely_available', 'seasonal', 'commonly_available'] },
  },
  required: ['description', 'rarity_level', 'availability_status'],
} as const;

const AVAIL = { unknown:'unknown', not_in_trade:'not_in_trade', rarely_available:'rarely_available', seasonal:'seasonal', commonly_available:'commonly_available' } as const;
const RARITY = { unknown:'unknown', common:'common', uncommon:'uncommon', rare:'rare', very_rare:'very_rare', ultra_rare:'ultra_rare' } as const;

export function makeInput(commonName?: string | null, scientificName?: string | null): string {
  const norm = (s?: string | null) => (s?.trim() ? s.trim() : '(unknown)');
  return `Provided common name: ${norm(commonName)}
Scientific name (canonical): ${norm(scientificName)}
Write in a neutral, factual tone. Keep paragraphs short.`;
}

export async function generateFacts({
  plantId, hasDesc, hasAvail, hasRarity, hasName,
  existing, commonName, scientificName,
  stage, onProgress
}: {
  plantId: string;
  hasDesc: boolean; hasAvail: boolean; hasRarity: boolean; hasName: boolean;
  existing: { description?: string|null; availability?: Availability|null; rarity?: Rarity|null };
  commonName?: string|null; scientificName?: string|null;
  stage: <T>(key: StageKey, label: string, fn: () => Promise<T>, onProgress?: any) => Promise<T>;
  onProgress?: (e:any)=>void;
}): Promise<FactsResult> {
  const baseInput = makeInput(existing?.description ? (commonName ?? null) : commonName, scientificName);

  const factsResults = await stage('facts_generation','Generating plant facts', async () => {
    const promises: Promise<any>[] = [];
    
    // Always generate name
    promises.push(openAIJson<{ suggested_common_name: string | null }>(
      SCHEMA_NAME_ONLY,
      'You are a precise botany writer. Return only JSON.',
      baseInput,
      200,
      200
    ));

    // Generate meta only if needed
    if (!hasDesc || !hasAvail || !hasRarity) {
      promises.push(openAIJson<{ description: string; availability_status: Availability; rarity_level: Rarity }>(
        SCHEMA_DESC_META,
        [
          'You are a precise botany writer.',
          'Output MUST match the JSON schema exactly.',
          'description: exactly two SHORT paragraphs about the plant itself (morphology, habitat, taxonomy). No care tips.',
          'Return JSON only.',
        ].join(' '),
        baseInput,
        900,
        900
      ));
    }

    const [nameOnly, meta] = await Promise.all(promises);
    
    return { nameOnly, meta };
  }, onProgress);

  if (hasDesc && hasAvail && hasRarity && hasName) {
    return {
      description: existing.description || '',
      availability_status: (existing.availability ?? 'unknown') as Availability,
      rarity_level: (existing.rarity ?? 'unknown') as Rarity,
      suggested_common_name: factsResults.nameOnly.suggested_common_name ? toTitle(factsResults.nameOnly.suggested_common_name) : null,
    };
  }

  const payload: Record<string, any> = {};
  if (!hasDesc)  payload.description = factsResults.meta.description;
  if (!hasAvail) payload.availability = AVAIL[factsResults.meta.availability_status as keyof typeof AVAIL] ?? 'unknown';
  if (!hasRarity)payload.rarity = RARITY[factsResults.meta.rarity_level as keyof typeof RARITY] ?? 'unknown';

  if (Object.keys(payload).length) {
    await stage('facts_db_write','Saving plant facts', async () => savePlantsRow(plantId, payload));
  }

  return {
    description: factsResults.meta.description,
    availability_status: factsResults.meta.availability_status,
    rarity_level: factsResults.meta.rarity_level,
    suggested_common_name: factsResults.nameOnly.suggested_common_name ? toTitle(factsResults.nameOnly.suggested_common_name) : null,
  };
}

function toTitle(s: string) {
  return s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
