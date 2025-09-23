import type { Availability, Rarity } from './types';

export const labelAvailability = (a: Availability) =>
  a && a !== 'unknown'
    ? ({
        not_in_trade: 'Not in trade',
        rarely_available: 'Rarely available',
        seasonal: 'Seasonal',
        commonly_available: 'Commonly available',
      } as const)[a] ?? null
    : null;

export const labelRarity = (r: Rarity) =>
  r && r !== 'unknown'
    ? ({ common: 'Common', uncommon: 'Uncommon', rare: 'Rare', very_rare: 'Very rare', ultra_rare: 'Ultra rare' } as const)[r] ?? null
    : null;
