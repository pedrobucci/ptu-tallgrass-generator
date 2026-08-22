import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { terrainFileSchema } from "../src/schemas/terrain";

const output = resolve("src/schemas/terrain.schema.json");
const schema = z.toJSONSchema(terrainFileSchema, { target: "draft-2020-12", io: "input" });
const content = `${JSON.stringify({ $id: "https://ptu-encounter-generator.local/schemas/terrain/1.0", ...schema }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== content) throw new Error("terrain.schema.json está desatualizado; execute npm run schema:generate");
} else {
  await writeFile(output, content, "utf8");
}

