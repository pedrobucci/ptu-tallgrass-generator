import { describe, expect, it } from "vitest";
import { terrainFileSchema } from "./terrain";

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

describe("schema de terreno", () => {
  it("aceita o formato canônico", () => expect(terrainFileSchema.safeParse(valid).success).toBe(true));
  it.each([
    ["versão", { ...valid, schema_version: "2.0" }],
    ["enum", { ...valid, terrain: { ...valid.terrain, encounter_frequency: "sometimes" } }],
    ["nível", { ...valid, terrain: { ...valid.terrain, min_lvl: 101 } }],
    ["shiny", { ...valid, terrain: { ...valid.terrain, shiny_rate: 2 } }],
    ["duplicata", { ...valid, terrain: { ...valid.terrain, pokemon_table: [...valid.terrain.pokemon_table, ...valid.terrain.pokemon_table] } }],
  ])("rejeita %s inválido", (_, value) => expect(terrainFileSchema.safeParse(value).success).toBe(false));
});

