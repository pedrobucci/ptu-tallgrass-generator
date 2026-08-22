export const encounterFrequencies = ["uneventful", "rare", "normal", "frequent", "eventful"] as const;
export const rarities = ["common", "unusual", "rare", "super_rare", "legendary"] as const;

export type EncounterFrequency = (typeof encounterFrequencies)[number];
export type Rarity = (typeof rarities)[number];
export type EncounterGender = "male" | "female" | "genderless" | "unknown";
export type DistanceUnit = "m" | "km";

export interface PokemonCatalogEntry {
  national_dex: number;
  name: string;
  display_name: string;
  generation: number | null;
  types: string[];
  genderless: boolean;
  male_percent: number | null;
  is_legendary: boolean;
  is_mythical: boolean;
  sprite_default_url: string | null;
  sprite_shiny_url: string | null;
  data_source: string;
  data_version: string;
}

export interface PokemonCatalogSnapshot {
  schema_version: "1.0";
  catalog_version: string;
  generated_at: string;
  source: string;
  entries: PokemonCatalogEntry[];
}

export interface TerrainPokemon {
  id: string;
  national_dex: number;
  rarity: Rarity;
  gender_enabled: boolean;
  male_percent: number | null;
  min_lvl: number | null;
  max_lvl: number | null;
}

export interface Terrain {
  id: string;
  name: string;
  min_lvl: number | null;
  max_lvl: number | null;
  encounter_frequency: EncounterFrequency;
  shiny_rate: number | null;
  background_source: string | null;
  background_cached_path: string | null;
  schema_version: string;
  pokemon_table: TerrainPokemon[];
}

export interface TerrainFileV1 {
  schema_version: "1.0";
  background_image_url?: string | null;
  terrain: {
    name: string;
    min_lvl?: number | null;
    max_lvl?: number | null;
    encounter_frequency: EncounterFrequency;
    shiny_rate?: number | null;
    pokemon_table: Array<{
      number: number;
      rarity: Rarity;
      gender: boolean;
      male_odd?: number | null;
      min_lvl?: number | null;
      max_lvl?: number | null;
    }>;
  };
}

export interface AppSettingsV1 {
  schema_version: "1.0";
  encounter_frequencies: Record<EncounterFrequency, number>;
  encounter_check_distance_m: number;
  default_distance_unit: DistanceUnit;
  rarity_weights: Record<Rarity, number>;
  allow_shiny_default: boolean;
  global_shiny_rate: number;
  audio_enabled: boolean;
  encounter_music_path: string | null;
  volume: number;
  selected_terrain_id: string | null;
}

export const DEFAULT_SETTINGS: AppSettingsV1 = {
  schema_version: "1.0",
  encounter_frequencies: { uneventful: 0.05, rare: 0.15, normal: 0.3, frequent: 0.5, eventful: 0.75 },
  encounter_check_distance_m: 1000,
  default_distance_unit: "km",
  rarity_weights: { common: 60, unusual: 25, rare: 10, super_rare: 4, legendary: 1 },
  allow_shiny_default: false,
  global_shiny_rate: 1 / 4096,
  audio_enabled: true,
  encounter_music_path: null,
  volume: 0.8,
  selected_terrain_id: null,
};

export interface Nature {
  id: number;
  name: string;
  raises: string;
  lowers: string;
}

export interface EncounterResult {
  id: string;
  created_at: string;
  terrain_id: string;
  terrain_name: string;
  travelled_distance_m: number;
  encounter_probability: number;
  national_dex: number;
  pokemon_name: string;
  display_name: string;
  types: string[];
  rarity: Rarity;
  level: number;
  gender: EncounterGender;
  nature: Nature;
  shiny: boolean;
  image_cached_path: string | null;
  image_remote_url: string | null;
}

export type EncounterOutcome =
  | { occurred: false; probability: number }
  | { occurred: true; probability: number; result: EncounterResult };

