// hooks/generatePlantData/care/buildProfile.ts
import { openAIJson } from '@/services/openaiJson';
import { SCHEMA_PROFILE } from './schemas';
import { profileInstructions, sanitizeProfile, HARD_RULES } from './profile';
import type { Profile } from './profile';

export async function buildProfile(baseInput: string, scientificName?: string|null): Promise<Profile> {
  const sciKey = (scientificName || '').trim().toLowerCase();
  const hard = HARD_RULES[sciKey] || null;

  if (hard) {
    const filled = await openAIJson<Profile>(
      SCHEMA_PROFILE,
      profileInstructions(),
      `${baseInput}\nUse these fixed defaults if sensible: ${JSON.stringify(hard)}\nOnly output JSON.`,
      500, 500
    );
    return sanitizeProfile({ ...filled, ...hard } as Profile);
  }

  const filled = await openAIJson<Profile>(
    SCHEMA_PROFILE,
    profileInstructions(),
    `${baseInput}\nOnly output JSON.`,
    500, 500
  );
  return sanitizeProfile(filled);
}