// hooks/generatePlantData/care/render.ts
import type { Profile } from './profile';

export function renderWaterFromProfile(p: Profile): string {
  const w = {
    soak_and_dry: 'Water deeply, then allow the soil to dry out completely before watering again; reduce frequency in winter.',
    top_inch_dry: 'Water when the top 1 in of soil is dry; empty any saucer to avoid soggy roots.',
    evenly_moist: 'Keep the soil evenly moist but never waterlogged; ensure free drainage.',
    boggy_never:  'Keep the medium consistently wet and never allow it to dry; use a container with no standing water.'
  } as const;
  return w[p.watering_strategy];
}

export function fixContradictions(_light: string, water: string) {
  const saysModerate = /\bmoderate watering\b/i.test(water);
  const saysDryOut   = /dry out completely/i.test(water);
  return saysModerate && saysDryOut
    ? water.replace(/\bmoderate watering\b/ig, 'Water deeply, then allow the soil to dry out completely')
    : water;
}
