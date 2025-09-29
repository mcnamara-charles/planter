// hooks/generatePlantData/care/profile.ts
export type WindowAspect = 'south' | 'west' | 'east' | 'north';
export type LightClass   = 'direct_sun' | 'high_light' | 'bright_indirect' | 'medium' | 'low';
export type Watering     = 'soak_and_dry' | 'top_inch_dry' | 'evenly_moist' | 'boggy_never';

export type Profile = {
  growth_form: 'succulent-stem' | 'succulent-leaf' | 'cactus' | 'tropical-foliage' | 'woody-shrub' | 'herb';
  is_succulent: boolean;
  light_class: LightClass;
  watering_strategy: Watering;
  window_best: WindowAspect;
  window_ok: WindowAspect[];
  summer_note: string;
};

export const HARD_RULES: Record<string, Partial<Profile>> = {
  'kalanchoe fedtschenkoi': {
    growth_form: 'succulent-leaf', is_succulent: true,
    light_class: 'direct_sun', watering_strategy: 'soak_and_dry',
    window_best: 'south', window_ok: ['west','east'],
    summer_note: 'In very hot, dry summers, give light afternoon shade to prevent leaf scorch.'
  },
  'euphorbia mammillaris': {
    growth_form: 'succulent-stem', is_succulent: true,
    light_class: 'direct_sun', watering_strategy: 'soak_and_dry',
    window_best: 'south', window_ok: ['west','east'],
    summer_note: 'Acclimate gradually when moving into stronger sun.'
  }
};

const WINDOW_ORDER: WindowAspect[] = ['south','west','east','north'];

function articleFor(aspect: WindowAspect) { return aspect === 'east' ? 'an' : 'a'; }
function prettyList(items: WindowAspect[]) { return items.join('/'); }

export function sanitizeProfile(p: Profile): Profile {
  const okSet = new Set((p.window_ok ?? []).filter(w => w !== p.window_best));
  const okSorted = WINDOW_ORDER.filter(w => okSet.has(w));
  return { ...p, window_ok: okSorted };
}

const sharedNameNote =
  'IMPORTANT: Treat the provided scientific name as canonical and correct even if uncommon. Do NOT correct, substitute, or question it. You MAY use or suggest a more widely used COMMON name, but do not alter the scientific name.';
const unitsNote =
  'Use U.S. customary units ONLY (inches, °F). Do NOT include metric equivalents or units in parentheses.';

export function profileInstructions() {
  return [
    'You are classifying horticultural traits for the EXACT species provided.',
    sharedNameNote, unitsNote,
    'If the plant is a succulent (Euphorbia/Kalanchoe/Aloe/Haworthia/Crassula/etc.), prefer light_class=direct_sun or high_light and watering_strategy=soak_and-dry unless the species is explicitly shade-adapted.',
    'Output JSON ONLY matching the schema.'
  ].join(' ');
}

export function renderLightFromProfile(p0: Profile): string {
  const p = sanitizeProfile(p0);
  const desc: Record<LightClass,string> = {
    direct_sun:     'Thrives in bright light with several hours of direct sun daily.',
    high_light:     'Prefers very bright light and benefits from some direct sun.',
    bright_indirect:'Prefers bright, indirect light with minimal direct sun.',
    medium:         'Tolerates medium light but growth will slow and may stretch.',
    low:            'Tolerates low light poorly; expect sparse, weak growth.'
  };
  const art = articleFor(p.window_best);
  const ok  = p.window_ok.length ? `; ${prettyList(p.window_ok)} are acceptable with slower growth` : '';
  const windows = `Indoors, ${art} ${p.window_best}-facing window is best${ok}.`;
  return [desc[p.light_class], windows, p.summer_note].filter(Boolean).join(' ');
}
