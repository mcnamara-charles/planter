export type Availability = 'unknown' | 'not_in_trade' | 'rarely_available' | 'seasonal' | 'commonly_available' | '';
export type Rarity = 'unknown' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare' | '';

export type RouteParams = { id: string };

export type SoilRowDraft = { id: string; name: string; parts: string };

export interface PotShape {
  type: string;
  heightIn: number | null;
  diameterIn: number | null;
  drainage: string;
}