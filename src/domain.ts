import naturesJson from "./data/ptu-natures.json";
import {
  type AppSettingsV1,
  type EncounterGender,
  type EncounterOutcome,
  type Nature,
  type PokemonCatalogEntry,
  type Rarity,
  type Terrain,
  type TerrainPokemon,
  rarities,
} from "./types";

const natures = naturesJson as Nature[];
const natureStats = ["HP", "Attack", "Defense", "Special Attack", "Special Defense", "Speed"] as const;

export interface RandomSource {
  next(): number;
  intInclusive(min: number, max: number): number;
}

export class SecureRandomSource implements RandomSource {
  next(): number {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
  }

  intInclusive(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new Error("Intervalo aleatório inválido.");
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

export class SequenceRandomSource implements RandomSource {
  private index = 0;

  constructor(private readonly values: number[]) {}

  next(): number {
    const value = this.values[this.index++];
    if (value === undefined || value < 0 || value >= 1) throw new Error("Sequência RNG inválida ou esgotada.");
    return value;
  }

  intInclusive(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

export function calculateEncounterProbability(distanceM: number, baseProbability: number, intervalM: number): number {
  if (distanceM <= 0 || baseProbability <= 0) return 0;
  if (baseProbability >= 1) return 1;
  if (!Number.isFinite(intervalM) || intervalM <= 0) throw new Error("O intervalo de encontro deve ser maior que zero.");
  return 1 - Math.pow(1 - baseProbability, distanceM / intervalM);
}

export function effectiveLevels(entry: TerrainPokemon, terrain: Terrain): [number, number] {
  return [entry.min_lvl ?? terrain.min_lvl ?? 1, entry.max_lvl ?? terrain.max_lvl ?? 100];
}

export function rollNature(rng: RandomSource): Nature {
  const raised = natureStats[rng.intInclusive(1, 6) - 1];
  const lowered = natureStats[rng.intInclusive(1, 6) - 1];
  return natures.find((nature) => nature.raises === raised && nature.lowers === lowered)!;
}

export function rollGender(entry: TerrainPokemon, pokemon: PokemonCatalogEntry, rng: RandomSource): EncounterGender {
  if (pokemon.genderless || !entry.gender_enabled) return "genderless";
  const malePercent = entry.male_percent ?? pokemon.male_percent;
  if (malePercent === null) return "unknown";
  return rng.next() < malePercent / 100 ? "male" : "female";
}

export function rollShiny(allowed: boolean, terrainRate: number | null, globalRate: number, rng: RandomSource): boolean {
  return allowed && rng.next() < (terrainRate ?? globalRate);
}

function weightedRarity(available: Set<Rarity>, weights: Record<Rarity, number>, rng: RandomSource): Rarity {
  const candidates = rarities.filter((rarity) => available.has(rarity) && weights[rarity] > 0);
  const total = candidates.reduce((sum, rarity) => sum + weights[rarity], 0);
  if (total <= 0) throw new Error("As raridades elegíveis precisam ter ao menos um peso maior que zero.");
  let roll = rng.next() * total;
  for (const rarity of candidates) {
    roll -= weights[rarity];
    if (roll < 0) return rarity;
  }
  return candidates[candidates.length - 1];
}

export function generateEncounter(input: {
  terrain: Terrain;
  distanceM: number;
  allowShiny: boolean;
  settings: AppSettingsV1;
  catalog: Map<number, PokemonCatalogEntry>;
  rng: RandomSource;
  resultId: string;
  createdAt: string;
}): EncounterOutcome {
  const { terrain, distanceM, settings, catalog, rng } = input;
  const probability = calculateEncounterProbability(
    distanceM,
    settings.encounter_frequencies[terrain.encounter_frequency],
    settings.encounter_check_distance_m,
  );
  if (rng.next() >= probability) return { occurred: false, probability };

  const eligible = terrain.pokemon_table.filter((entry) => {
    const [min, max] = effectiveLevels(entry, terrain);
    return catalog.has(entry.national_dex) && min <= max;
  });
  if (!eligible.length) throw new Error("Este terreno não possui Pokémon elegíveis.");

  const rarity = weightedRarity(new Set(eligible.map((entry) => entry.rarity)), settings.rarity_weights, rng);
  const bucket = eligible.filter((entry) => entry.rarity === rarity);
  const entry = bucket[rng.intInclusive(0, bucket.length - 1)];
  const pokemon = catalog.get(entry.national_dex)!;
  const [minLevel, maxLevel] = effectiveLevels(entry, terrain);
  const level = rng.intInclusive(minLevel, maxLevel);
  const gender = rollGender(entry, pokemon, rng);
  const nature = rollNature(rng);
  const shiny = rollShiny(input.allowShiny, terrain.shiny_rate, settings.global_shiny_rate, rng);

  return {
    occurred: true,
    probability,
    result: {
      id: input.resultId,
      created_at: input.createdAt,
      terrain_id: terrain.id,
      terrain_name: terrain.name,
      travelled_distance_m: distanceM,
      encounter_probability: probability,
      national_dex: pokemon.national_dex,
      pokemon_name: pokemon.name,
      display_name: pokemon.display_name,
      types: pokemon.types,
      rarity,
      level,
      gender,
      nature,
      shiny,
      image_cached_path: null,
      image_remote_url: shiny ? pokemon.sprite_shiny_url ?? pokemon.sprite_default_url : pokemon.sprite_default_url,
    },
  };
}

export function eligiblePokemonCount(terrain: Terrain, catalog: Map<number, PokemonCatalogEntry>): number {
  return terrain.pokemon_table.filter((entry) => {
    const [min, max] = effectiveLevels(entry, terrain);
    return catalog.has(entry.national_dex) && min <= max;
  }).length;
}
