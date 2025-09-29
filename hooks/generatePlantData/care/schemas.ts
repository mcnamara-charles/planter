// hooks/generatePlantData/care/schemas.ts
export const SCHEMA_PROFILE = {
    type: 'object',
    additionalProperties: false,
    required: ['growth_form','is_succulent','light_class','watering_strategy','window_best','window_ok','summer_note'],
    properties: {
      growth_form: { enum: ['succulent-stem','succulent-leaf','cactus','tropical-foliage','woody-shrub','herb'] },
      is_succulent: { type: 'boolean' },
      light_class: { enum: ['direct_sun','high_light','bright_indirect','medium','low'] },
      watering_strategy: { enum: ['soak_and_dry','top_inch_dry','evenly_moist','boggy_never'] },
      window_best: { enum: ['south','west','east','north'] },
      window_ok: { type: 'array', minItems: 0, maxItems: 3, items: { enum: ['south','west','east','north'] } },
      summer_note: { type: 'string', maxLength: 180 }
    }
  } as const;
  
  export const SCHEMA_LIGHT = {
    type:'object', additionalProperties:false,
    properties:{ care_light:{ type:'string', maxLength:500 } },
    required:['care_light']
  } as const;
  
  export const SCHEMA_WATER = {
    type:'object', additionalProperties:false,
    properties:{ care_water:{ type:'string', maxLength:800 } },
    required:['care_water']
  } as const;
  
  export const SCHEMA_TEMP_HUM = {
    type:'object', additionalProperties:false,
    properties:{ care_temp_humidity:{ type:'string', maxLength:800 } },
    required:['care_temp_humidity']
  } as const;
  
  export const SCHEMA_FERT = {
    type:'object', additionalProperties:false,
    properties:{ care_fertilizer:{ type:'string', maxLength:400 } },
    required:['care_fertilizer']
  } as const;
  
  export const SCHEMA_PRUNE = {
    type:'object', additionalProperties:false,
    properties:{ care_pruning:{ type:'string', maxLength:500 } },
    required:['care_pruning']
  } as const;
  
  export const SCHEMA_SOIL = {
    type:'object', additionalProperties:false,
    properties:{ soil_description:{ type:'string', maxLength:500 } },
    required:['soil_description']
  } as const;
  
  export const SCHEMA_PROP = {
    type:'object', additionalProperties:false,
    properties:{
      propagation_techniques:{
        type:'array', minItems:1, maxItems:3,
        items:{
          type:'object', additionalProperties:false,
          properties:{
            method:{ type:'string', enum:['cuttings','division','leaf','offsets','seed','air_layering'] },
            difficulty:{ type:'string', enum:['easy','moderate','challenging','very_challenging'] },
            description:{ type:'string', maxLength:500 }
          },
          required:['method','difficulty','description']
        }
      }
    },
    required:['propagation_techniques']
  } as const;
  