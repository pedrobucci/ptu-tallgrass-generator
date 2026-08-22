import { describe, expect, it } from "vitest";
import { previewTerrain } from "./terrain-service";

const valid = {
  schema_version: "1.0",
  terrain: {
    name: "Bosque",
    min_lvl: 1,
    max_lvl: 10,
    encounter_frequency: "normal",
    shiny_rate: null,
    pokemon_table: [{ number: 1, rarity: "common", gender: true, male_odd: null, min_lvl: null, max_lvl: null }],
  },
};

describe("prévia de importação", () => {
  it("aceita fixture válida sem depender de rede", () => {
    const preview = previewTerrain(JSON.stringify(valid), []);
    expect(preview.file?.terrain.name).toBe("Bosque");
    expect(preview.errors).toEqual([]);
  });

  it("rejeita JSON quebrado", () => {
    expect(previewTerrain("{quebrado", []).errors[0]).toMatch(/JSON válido/);
  });

  it("rejeita Pokémon inexistente no catálogo", () => {
    const missing = { ...valid, terrain: { ...valid.terrain, pokemon_table: [{ ...valid.terrain.pokemon_table[0], number: 99999 }] } };
    expect(previewTerrain(JSON.stringify(missing), []).errors[0]).toMatch(/não existe no catálogo local/);
  });
});
