import Database from "@tauri-apps/plugin-sql";
import { z } from "zod";
import naturesJson from "./data/ptu-natures.json";
import { pokemonCatalog } from "./catalog";
import {
  DEFAULT_SETTINGS,
  encounterFrequencies,
  rarities,
  type AppSettingsV1,
  type EncounterResult,
  type Nature,
  type Terrain,
  type TerrainPokemon,
} from "./types";

const DB_URL = "sqlite:ptu-encounter-generator.db";
let databasePromise: Promise<Database> | undefined;

const settingsSchema = z.object({
  schema_version: z.literal("1.0"),
  encounter_frequencies: z.object(Object.fromEntries(encounterFrequencies.map((key) => [key, z.number().min(0).max(1)])) as Record<(typeof encounterFrequencies)[number], z.ZodNumber>),
  encounter_check_distance_m: z.number().positive(),
  default_distance_unit: z.enum(["m", "km"]),
  rarity_weights: z.object(Object.fromEntries(rarities.map((key) => [key, z.number().nonnegative()])) as Record<(typeof rarities)[number], z.ZodNumber>),
  allow_shiny_default: z.boolean(),
  global_shiny_rate: z.number().min(0).max(1),
  audio_enabled: z.boolean(),
  encounter_music_path: z.string().nullable(),
  volume: z.number().min(0).max(1),
  selected_terrain_id: z.string().nullable(),
});

async function db(): Promise<Database> {
  databasePromise ??= Database.load(DB_URL).then(async (database) => {
    await database.execute("PRAGMA foreign_keys = ON");
    return database;
  });
  return databasePromise;
}

interface TerrainRow {
  id: string;
  name: string;
  min_lvl: number | null;
  max_lvl: number | null;
  encounter_frequency: Terrain["encounter_frequency"];
  shiny_rate: number | null;
  background_source: string | null;
  background_cached_path: string | null;
  schema_version: string;
}

interface TerrainPokemonRow {
  id: string;
  terrain_id: string;
  national_dex: number;
  rarity: TerrainPokemon["rarity"];
  gender_enabled: number;
  male_percent: number | null;
  min_lvl: number | null;
  max_lvl: number | null;
}

export async function loadTerrains(): Promise<Terrain[]> {
  const database = await db();
  const [rows, pokemonRows] = await Promise.all([
    database.select<TerrainRow[]>("SELECT id,name,min_lvl,max_lvl,encounter_frequency,shiny_rate,background_source,background_cached_path,schema_version FROM terrains ORDER BY name COLLATE NOCASE"),
    database.select<TerrainPokemonRow[]>("SELECT id,terrain_id,national_dex,rarity,gender_enabled,male_percent,min_lvl,max_lvl FROM terrain_pokemon ORDER BY rowid"),
  ]);
  const byTerrain = new Map<string, TerrainPokemon[]>();
  for (const row of pokemonRows) {
    const list = byTerrain.get(row.terrain_id) ?? [];
    list.push({ ...row, gender_enabled: Boolean(row.gender_enabled) });
    byTerrain.set(row.terrain_id, list);
  }
  return rows.map((row) => ({ ...row, pokemon_table: byTerrain.get(row.id) ?? [] }));
}

export async function deleteTerrain(id: string): Promise<void> {
  await (await db()).execute("DELETE FROM terrains WHERE id = $1", [id]);
}

export async function loadSettings(): Promise<AppSettingsV1> {
  const rows = await (await db()).select<Array<{ value_json: string }>>("SELECT value_json FROM app_settings WHERE id = 1");
  if (rows[0]) {
    const parsed = settingsSchema.safeParse(JSON.parse(rows[0].value_json));
    if (parsed.success) return parsed.data;
  }
  const defaults = structuredClone(DEFAULT_SETTINGS);
  await saveSettings(defaults);
  return defaults;
}

export async function saveSettings(settings: AppSettingsV1): Promise<void> {
  const validated = settingsSchema.parse(settings);
  if (!Object.values(validated.rarity_weights).some((weight) => weight > 0)) {
    throw new Error("Ao menos um peso de raridade deve ser maior que zero.");
  }
  await (await db()).execute(
    "INSERT INTO app_settings(id,schema_version,value_json,updated_at) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,value_json=excluded.value_json,updated_at=excluded.updated_at",
    [validated.schema_version, JSON.stringify(validated), new Date().toISOString()],
  );
}

export async function saveEncounter(result: EncounterResult): Promise<void> {
  await (await db()).execute(
    "INSERT INTO encounter_history(id,created_at,terrain_id,terrain_name,travelled_distance_m,encounter_probability,national_dex,pokemon_name,display_name,rarity,level,gender,nature_id,nature_name,shiny) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [result.id, result.created_at, result.terrain_id, result.terrain_name, result.travelled_distance_m, result.encounter_probability, result.national_dex, result.pokemon_name, result.display_name, result.rarity, result.level, result.gender, result.nature.id, result.nature.name, Number(result.shiny)],
  );
}

interface HistoryRow {
  id: string;
  created_at: string;
  terrain_id: string;
  terrain_name: string;
  travelled_distance_m: number;
  encounter_probability: number;
  national_dex: number;
  pokemon_name: string;
  display_name: string;
  rarity: EncounterResult["rarity"];
  level: number;
  gender: EncounterResult["gender"];
  nature_id: number;
  nature_name: string;
  shiny: number;
}

const natures = naturesJson as Nature[];

export async function loadHistory(limit = 50, offset = 0): Promise<EncounterResult[]> {
  const rows = await (await db()).select<HistoryRow[]>("SELECT * FROM encounter_history ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
  return rows.map((row) => {
    const catalog = pokemonCatalog.get(row.national_dex);
    const nature = natures[row.nature_id - 1] ?? { id: row.nature_id, name: row.nature_name, raises: "?", lowers: "?" };
    return {
      id: row.id,
      created_at: row.created_at,
      terrain_id: row.terrain_id,
      terrain_name: row.terrain_name,
      travelled_distance_m: row.travelled_distance_m,
      encounter_probability: row.encounter_probability,
      national_dex: row.national_dex,
      pokemon_name: row.pokemon_name,
      display_name: row.display_name,
      types: catalog?.types ?? [],
      rarity: row.rarity,
      level: row.level,
      gender: row.gender,
      nature,
      shiny: Boolean(row.shiny),
      image_cached_path: null,
      image_remote_url: row.shiny ? catalog?.sprite_shiny_url ?? catalog?.sprite_default_url ?? null : catalog?.sprite_default_url ?? null,
    };
  });
}

export async function setTerrainBackgroundPath(id: string, path: string | null): Promise<void> {
  await (await db()).execute("UPDATE terrains SET background_cached_path = $1, updated_at = $2 WHERE id = $3", [path, new Date().toISOString(), id]);
}

export async function clearBackgroundPaths(): Promise<void> {
  await (await db()).execute("UPDATE terrains SET background_cached_path = NULL WHERE background_cached_path IS NOT NULL");
}

