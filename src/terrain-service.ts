import { invoke } from "@tauri-apps/api/core";
import { error as logError, info } from "@tauri-apps/plugin-log";
import { z } from "zod";
import { pokemonCatalog } from "./catalog";
import { formatZodErrors, terrainFileSchema } from "./schemas/terrain";
import type { Terrain, TerrainFileV1 } from "./types";

export interface ImportPreview {
  file: TerrainFileV1 | null;
  errors: string[];
  warnings: string[];
  existingTerrain: Terrain | null;
}

export function previewTerrain(text: string, terrains: Terrain[]): ImportPreview {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { file: null, errors: ["Arquivo: o conteúdo não é um JSON válido."], warnings: [], existingTerrain: null };
  }
  const parsed = terrainFileSchema.safeParse(value);
  if (!parsed.success) {
    return { file: null, errors: formatZodErrors(parsed.error), warnings: [], existingTerrain: null };
  }
  const file = parsed.data as TerrainFileV1;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const [index, entry] of file.terrain.pokemon_table.entries()) {
    const pokemon = pokemonCatalog.get(entry.number);
    if (!pokemon) errors.push(`terrain.pokemon_table.${index}.number: Pokémon #${entry.number} não existe no catálogo local.`);
    else if (entry.gender && entry.male_odd == null && pokemon.male_percent == null && !pokemon.genderless) {
      warnings.push(`${pokemon.display_name} não possui proporção de sexo conhecida.`);
    }
    if (entry.min_lvl === 0 || entry.max_lvl === 0) warnings.push(`Pokémon #${entry.number} usa nível 0.`);
  }
  if (file.terrain.min_lvl === 0 || file.terrain.max_lvl === 0) warnings.push("O terreno usa nível 0.");
  if (!file.terrain.pokemon_table.length) warnings.push("O terreno não possui Pokémon elegíveis.");
  const present = new Set(file.terrain.pokemon_table.map((entry) => entry.rarity));
  for (const rarity of ["common", "unusual", "rare", "super_rare", "legendary"] as const) {
    if (!present.has(rarity)) warnings.push(`O terreno não possui Pokémon na raridade ${rarity}.`);
  }
  const existingTerrain = terrains.find((terrain) => terrain.name.trim().localeCompare(file.terrain.name.trim(), undefined, { sensitivity: "accent" }) === 0) ?? null;
  return { file, errors, warnings, existingTerrain };
}

export async function importTerrain(file: TerrainFileV1, replaceTerrainId: string | null): Promise<string> {
  const now = new Date().toISOString();
  const payload = {
    id: crypto.randomUUID(),
    name: file.terrain.name.trim(),
    min_lvl: file.terrain.min_lvl ?? null,
    max_lvl: file.terrain.max_lvl ?? null,
    encounter_frequency: file.terrain.encounter_frequency,
    shiny_rate: file.terrain.shiny_rate ?? null,
    background_source: file.background_image_url ?? null,
    background_cached_path: null,
    schema_version: file.schema_version,
    created_at: now,
    updated_at: now,
    pokemon_table: file.terrain.pokemon_table.map((entry) => ({
      id: crypto.randomUUID(),
      national_dex: entry.number,
      rarity: entry.rarity,
      gender_enabled: entry.gender,
      male_percent: entry.male_odd ?? null,
      min_lvl: entry.min_lvl ?? null,
      max_lvl: entry.max_lvl ?? null,
    })),
  };
  try {
    const id = await invoke<string>("import_terrain_atomic", { payload, replaceTerrainId });
    await info(`terrain_imported id=${id}`);
    return id;
  } catch (error) {
    await logError(`terrain_import_failed ${String(error)}`);
    throw new Error("Não foi possível gravar o terreno. Os dados existentes não foram alterados.");
  }
}

export function terrainAsFile(terrain: Terrain): TerrainFileV1 {
  return {
    schema_version: "1.0",
    background_image_url: terrain.background_source,
    terrain: {
      name: terrain.name,
      min_lvl: terrain.min_lvl,
      max_lvl: terrain.max_lvl,
      encounter_frequency: terrain.encounter_frequency,
      shiny_rate: terrain.shiny_rate,
      pokemon_table: terrain.pokemon_table.map((entry) => ({
        number: entry.national_dex,
        rarity: entry.rarity,
        gender: entry.gender_enabled,
        male_odd: entry.male_percent,
        min_lvl: entry.min_lvl,
        max_lvl: entry.max_lvl,
      })),
    },
  };
}

export function isValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}

