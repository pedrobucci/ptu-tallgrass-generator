import { describe, expect, it } from "vitest";
import { calculateEncounterProbability, effectiveLevels, generateEncounter, rollGender, rollNature, rollShiny, SequenceRandomSource } from "./domain";
import { DEFAULT_SETTINGS, type AppSettingsV1, type PokemonCatalogEntry, type Terrain } from "./types";

const ditto: PokemonCatalogEntry = {
  national_dex: 132,
  name: "ditto",
  display_name: "Ditto",
  generation: 1,
  types: ["normal"],
  genderless: true,
  male_percent: null,
  is_legendary: false,
  is_mythical: false,
  sprite_default_url: null,
  sprite_shiny_url: null,
  data_source: "test",
  data_version: "1",
};

const terrain: Terrain = {
  id: "terrain-1",
  name: "Campo",
  min_lvl: 5,
  max_lvl: 5,
  encounter_frequency: "normal",
  shiny_rate: null,
  background_source: null,
  background_cached_path: null,
  schema_version: "1.0",
  pokemon_table: [{ id: "entry-1", national_dex: 132, rarity: "common", gender_enabled: true, male_percent: null, min_lvl: null, max_lvl: null }],
};

const gendered: PokemonCatalogEntry = { ...ditto, national_dex: 25, name: "pikachu", display_name: "Pikachu", genderless: false, male_percent: 50 };
const guaranteedSettings: AppSettingsV1 = {
  ...DEFAULT_SETTINGS,
  encounter_frequencies: { ...DEFAULT_SETTINGS.encounter_frequencies, normal: 1 },
};

function generate(testTerrain: Terrain, catalog: Map<number, PokemonCatalogEntry>, values: number[], settings = guaranteedSettings) {
  return generateEncounter({
    terrain: testTerrain,
    distanceM: 1000,
    allowShiny: false,
    settings,
    catalog,
    rng: new SequenceRandomSource(values),
    resultId: "result-1",
    createdAt: "2026-08-21T00:00:00.000Z",
  });
}

describe("probabilidade por distância", () => {
  it("cobre limites e intervalos fracionários", () => {
    expect(calculateEncounterProbability(0, 0.3, 1000)).toBe(0);
    expect(calculateEncounterProbability(1000, 0, 1000)).toBe(0);
    expect(calculateEncounterProbability(1000, 1, 1000)).toBe(1);
    expect(calculateEncounterProbability(1000, 0.3, 1000)).toBeCloseTo(0.3);
    expect(calculateEncounterProbability(2000, 0.3, 1000)).toBeCloseTo(0.51);
    expect(calculateEncounterProbability(500, 0.3, 1000)).toBeCloseTo(1 - Math.sqrt(0.7));
  });
});

describe("regras determinísticas", () => {
  it("mapeia todas as 36 Natures por dois d6", () => {
    const stats = ["HP", "Attack", "Defense", "Special Attack", "Special Defense", "Speed"];
    const ids = new Set<number>();
    for (let raised = 0; raised < 6; raised++) {
      for (let lowered = 0; lowered < 6; lowered++) {
        const nature = rollNature(new SequenceRandomSource([raised / 6, lowered / 6]));
        expect(nature.raises).toBe(stats[raised]);
        expect(nature.lowers).toBe(stats[lowered]);
        ids.add(nature.id);
      }
    }
    expect(ids.size).toBe(36);
    expect([...ids].filter((id) => id >= 31)).toHaveLength(6);
  });

  it("respeita todas as precedências de sexo", () => {
    const entry = terrain.pokemon_table[0];
    expect(rollGender(entry, ditto, new SequenceRandomSource([]))).toBe("genderless");
    expect(rollGender({ ...entry, gender_enabled: false }, gendered, new SequenceRandomSource([]))).toBe("genderless");
    expect(rollGender({ ...entry, male_percent: 100 }, gendered, new SequenceRandomSource([0.999]))).toBe("male");
    expect(rollGender({ ...entry, male_percent: 0 }, gendered, new SequenceRandomSource([0]))).toBe("female");
    expect(rollGender({ ...entry, male_percent: 75 }, { ...gendered, male_percent: 0 }, new SequenceRandomSource([0.5]))).toBe("male");
    expect(rollGender(entry, { ...gendered, male_percent: 100 }, new SequenceRandomSource([0.999]))).toBe("male");
    expect(rollGender(entry, { ...gendered, male_percent: null }, new SequenceRandomSource([]))).toBe("unknown");
  });

  it("respeita checkbox, limites e override de Shiny", () => {
    expect(rollShiny(false, 1, 1, new SequenceRandomSource([]))).toBe(false);
    expect(rollShiny(true, null, 0, new SequenceRandomSource([0]))).toBe(false);
    expect(rollShiny(true, 1, 0, new SequenceRandomSource([0.999]))).toBe(true);
    expect(rollShiny(true, 0, 1, new SequenceRandomSource([0]))).toBe(false);
    expect(rollShiny(true, null, 1, new SequenceRandomSource([0.999]))).toBe(true);
  });

  it("herda e sobrescreve níveis, incluindo os limites", () => {
    const entry = terrain.pokemon_table[0];
    expect(effectiveLevels(entry, { ...terrain, min_lvl: 2, max_lvl: 9 })).toEqual([2, 9]);
    expect(effectiveLevels({ ...entry, min_lvl: 4, max_lvl: 7 }, terrain)).toEqual([4, 7]);

    const overridden = { ...terrain, min_lvl: 1, max_lvl: 100, pokemon_table: [{ ...entry, min_lvl: 4, max_lvl: 7 }] };
    const minimum = generate(overridden, new Map([[132, ditto]]), [0, 0, 0, 0, 0, 0]);
    const maximum = generate(overridden, new Map([[132, ditto]]), [0, 0, 0, 0.999, 0, 0]);
    expect(minimum.occurred && minimum.result.level).toBe(4);
    expect(maximum.occurred && maximum.result.level).toBe(7);

    expect(() => generate({ ...terrain, pokemon_table: [{ ...entry, min_lvl: 8, max_lvl: 4 }] }, new Map([[132, ditto]]), [0])).toThrow(/elegíveis/);
  });

  it("seleciona buckets disponíveis, ignora vazios e aceita pesos relativos", () => {
    const entries = (["common", "unusual", "rare", "super_rare", "legendary"] as const).map((rarity, index) => ({
      ...terrain.pokemon_table[0], id: `entry-${index}`, national_dex: index + 1, rarity,
    }));
    const fullTerrain = { ...terrain, pokemon_table: entries };
    const catalog = new Map(entries.map((entry) => [entry.national_dex, { ...ditto, national_dex: entry.national_dex }]));
    for (const [roll, expected] of [[0, "common"], [0.6, "unusual"], [0.85, "rare"], [0.95, "super_rare"], [0.99, "legendary"]] as const) {
      const outcome = generate(fullTerrain, catalog, [0, roll, 0, 0, 0, 0]);
      expect(outcome.occurred && outcome.result.rarity).toBe(expected);
    }

    const sparseTerrain = { ...terrain, pokemon_table: [entries[0], entries[4]] };
    const relativeSettings = { ...guaranteedSettings, rarity_weights: { common: 0, unusual: 23, rare: 0, super_rare: 0, legendary: 7 } };
    const sparse = generate(sparseTerrain, catalog, [0, 0, 0, 0, 0, 0], relativeSettings);
    expect(sparse.occurred && sparse.result.rarity).toBe("legendary");

    const oneBucket = generate(
      { ...terrain, pokemon_table: [entries[2]] },
      catalog,
      [0, 0.7, 0, 0, 0, 0],
      { ...guaranteedSettings, rarity_weights: { common: 0, unusual: 0, rare: 7, super_rare: 0, legendary: 0 } },
    );
    expect(oneBucket.occurred && oneBucket.result.rarity).toBe("rare");

    const invalidWeights = { ...guaranteedSettings, rarity_weights: { common: 0, unusual: 0, rare: 0, super_rare: 0, legendary: 0 } };
    expect(() => generate(terrain, new Map([[132, ditto]]), [0], invalidWeights)).toThrow(/peso maior que zero/);
  });

  it("gera um encontro completo sem depender de rede", () => {
    const outcome = generateEncounter({
      terrain,
      distanceM: 1000,
      allowShiny: false,
      settings: guaranteedSettings,
      catalog: new Map([[132, ditto]]),
      rng: new SequenceRandomSource([0, 0, 0, 0, 0, 0]),
      resultId: "result-1",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(outcome.occurred).toBe(true);
    if (outcome.occurred) {
      expect(outcome.result).toMatchObject({ national_dex: 132, level: 5, gender: "genderless", shiny: false });
    }
  });
});
