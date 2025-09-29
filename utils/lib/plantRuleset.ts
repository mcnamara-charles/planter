// utils/lib/plantRuleset.ts

export type CareField =
  | 'care_light'
  | 'care_water'
  | 'care_temp_humidity'
  | 'care_fertilizer'
  | 'care_pruning'
  | 'soil_description'
  | 'propagation_methods_json';

export type FactsField = 'description' | 'availability' | 'rarity' | 'plant_name';

// Virtual internal (not persisted) upstream node(s)
export type VirtualField = 'profile';

export type ForceField = CareField | FactsField | VirtualField;

export type ForceRule = {
  version: number;
  force_update_fields: ForceField[];
};

// ⚠ Set this to your current bump value
export const CURRENT_RULESET_VERSION = 2;

// Example: you say "only care_light" in the rule…
export const FORCE_RULES: ForceRule[] = [
  { version: 1, force_update_fields: ['care_light'] },
  { version: 2, force_update_fields: ['care_light'] },
];

// ------- Dependency graphs -------

// DOWNSTREAM graph (cause → effects). Keep if you want light to also refresh water.
const DOWNSTREAM_GRAPH: Record<ForceField, ForceField[]> = {
  profile: ['care_light', 'care_water'], // optional; profile changes fan out
  care_light: ['care_water'],            // optional; light change nudges water
  care_water: [],
  care_temp_humidity: [],
  care_fertilizer: [],
  care_pruning: [],
  soil_description: [],
  propagation_methods_json: [],
  description: [],
  availability: [],
  rarity: [],
  plant_name: [],
};

// UPSTREAM graph (effect → prerequisites). This is the key bit you asked for.
const UPSTREAM_GRAPH: Record<ForceField, ForceField[]> = {
  // if we force light, we must recompute profile upstream
  care_light: ['profile'],
  // if we force water directly, we also want profile
  care_water: ['profile'],

  // other leaves don’t need the profile by default
  care_temp_humidity: [],
  care_fertilizer: [],
  care_pruning: [],
  soil_description: [],
  propagation_methods_json: [],

  // facts are independent of profile in your flow
  description: [],
  availability: [],
  rarity: [],
  plant_name: [],

  // profile has no upstream parents
  profile: [],
};

export function computeForcedFieldsSince(
  rowVersion: number,
  targetVersion = CURRENT_RULESET_VERSION
): Set<ForceField> {
  const out = new Set<ForceField>();

  // 1) collect explicit fields from rules between (rowVersion, targetVersion]
  for (const rule of FORCE_RULES) {
    if (rule.version > rowVersion && rule.version <= targetVersion) {
      rule.force_update_fields.forEach(f => out.add(f));
    }
  }

  // 2) add UPSTREAM prerequisites (what must be recomputed first)
  const upQueue = [...out];
  while (upQueue.length) {
    const f = upQueue.pop()!;
    for (const parent of UPSTREAM_GRAPH[f] ?? []) {
      if (!out.has(parent)) {
        out.add(parent);
        upQueue.push(parent);
      }
    }
  }

  // 3) (optional) add DOWNSTREAM effects (what should be refreshed because parent changed)
  const downQueue = [...out];
  while (downQueue.length) {
    const f = downQueue.pop()!;
    for (const child of DOWNSTREAM_GRAPH[f] ?? []) {
      if (!out.has(child)) {
        out.add(child);
        downQueue.push(child);
      }
    }
  }

  return out;
}
 