export const SCHEMA_CLASSIFY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    growth_form: { enum: ['bulb/tuber/corm', 'rhizomatous', 'woody shrub/tree', 'herbaceous perennial', 'annual', 'succulent/cactus', 'tropical foliage', 'epiphyte'] },
    climate_archetype: { enum: ['temperate', 'tropical', 'arid', 'subtropical', 'boreal'] },
    indoor_suitability: { enum: ['indoor-only', 'indoor-possible', 'outdoor-primarily'] },
    has_true_dormancy: { type: 'boolean' },
    evergreen: { type: 'boolean' },
  },
  required: ['growth_form', 'climate_archetype', 'indoor_suitability', 'has_true_dormancy', 'evergreen'],
} as const;

export const SCHEMA_SCHEDULE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schedule_same_year_round: { type: 'boolean' },
    active_season_start_mmdd: { type: 'string', pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' },
    active_season_end_mmdd:   { type: 'string', pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' },
    water_interval_days_active:   { type: 'number', minimum: 1, maximum: 365 },
    water_interval_days_inactive: { type: ['number', 'null'], minimum: 1, maximum: 365 },
    fert_interval_days_active:    { type: 'number', minimum: 1, maximum: 365 },
    fert_interval_days_inactive:  { type: ['number', 'null'], minimum: 1, maximum: 365 },
  },
  required: [
    'schedule_same_year_round',
    'active_season_start_mmdd',
    'active_season_end_mmdd',
    'water_interval_days_active',
    'water_interval_days_inactive',
    'fert_interval_days_active',
    'fert_interval_days_inactive',
  ],
} as const;
