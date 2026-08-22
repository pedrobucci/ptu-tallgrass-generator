import { z } from "zod";
import { encounterFrequencies, rarities, type TerrainFileV1 } from "../types";

const level = z.number().int().min(0).max(100).nullable().optional();

export const terrainFileSchema = z
  .object({
    schema_version: z.literal("1.0"),
    background_image_url: z.url().nullable().optional(),
    terrain: z.object({
      name: z.string().trim().min(1).max(120),
      min_lvl: level,
      max_lvl: level,
      encounter_frequency: z.enum(encounterFrequencies),
      shiny_rate: z.number().min(0).max(1).nullable().optional(),
      pokemon_table: z.array(
        z.object({
          number: z.number().int().positive(),
          rarity: z.enum(rarities),
          gender: z.boolean(),
          male_odd: z.number().min(0).max(100).nullable().optional(),
          min_lvl: level,
          max_lvl: level,
        }),
      ),
    }),
  })
  .superRefine((file, context) => {
    const terrainMin = file.terrain.min_lvl ?? 1;
    const terrainMax = file.terrain.max_lvl ?? 100;
    if (terrainMin > terrainMax) {
      context.addIssue({ code: "custom", path: ["terrain", "min_lvl"], message: "deve ser menor ou igual a terrain.max_lvl" });
    }
    const seen = new Set<number>();
    file.terrain.pokemon_table.forEach((pokemon, index) => {
      if (seen.has(pokemon.number)) {
        context.addIssue({ code: "custom", path: ["terrain", "pokemon_table", index, "number"], message: "está duplicado neste terreno" });
      }
      seen.add(pokemon.number);
      const min = pokemon.min_lvl ?? terrainMin;
      const max = pokemon.max_lvl ?? terrainMax;
      if (min > max) {
        context.addIssue({ code: "custom", path: ["terrain", "pokemon_table", index, "min_lvl"], message: "resulta em intervalo de nível inválido" });
      }
    });
  });

export function parseTerrainFile(value: unknown): TerrainFileV1 {
  return terrainFileSchema.parse(value) as TerrainFileV1;
}

export function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "arquivo"}: ${issue.message}`);
}

