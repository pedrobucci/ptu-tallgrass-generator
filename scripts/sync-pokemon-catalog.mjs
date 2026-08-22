import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const API = "https://pokeapi.co/api/v2";
const cacheDir = resolve(".catalog-cache");
const outputPath = resolve("src/data/pokemon-catalog.v1.json");
const overridesPath = resolve("src/data/pokemon-catalog.overrides.json");
const concurrency = 12;

await mkdir(cacheDir, { recursive: true });

async function cachedJson(url) {
  const path = resolve(cacheDir, `${createHash("sha1").update(url).digest("hex")}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const body = await response.text();
        await writeFile(path, body, "utf8");
        return JSON.parse(body);
      } catch (error) {
        lastError = error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** attempt));
      }
    }
    throw new Error(`Falha ao consultar ${url}: ${lastError}`);
  }
}

async function mapLimit(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
        if ((index + 1) % 50 === 0 || index + 1 === items.length) {
          process.stdout.write(`\rCatálogo: ${index + 1}/${items.length}`);
        }
      }
    }),
  );
  process.stdout.write("\n");
  return results;
}

const list = await cachedJson(`${API}/pokemon-species?limit=10000`);
const overrides = JSON.parse(await readFile(overridesPath, "utf8"));
const generatedAt = new Date().toISOString();
const dataVersion = generatedAt.slice(0, 10);

const entries = await mapLimit(list.results, async ({ url }) => {
  const species = await cachedJson(url);
  const defaultVariety = species.varieties.find((item) => item.is_default)?.pokemon;
  if (!defaultVariety) throw new Error(`Espécie #${species.id} sem variedade padrão.`);
  const pokemon = await cachedJson(defaultVariety.url);
  const englishName = species.names.find((item) => item.language.name === "en")?.name ?? species.name;
  const artwork = pokemon.sprites.other?.["official-artwork"];
  const generation = Number(species.generation?.url?.match(/\/(\d+)\/$/)?.[1]) || null;
  const entry = {
    national_dex: species.id,
    name: species.name,
    display_name: englishName,
    generation,
    types: pokemon.types.sort((a, b) => a.slot - b.slot).map((item) => item.type.name),
    genderless: species.gender_rate === -1,
    male_percent: species.gender_rate === -1 ? null : ((8 - species.gender_rate) / 8) * 100,
    is_legendary: species.is_legendary,
    is_mythical: species.is_mythical,
    sprite_default_url: artwork?.front_default ?? pokemon.sprites.front_default ?? null,
    sprite_shiny_url: artwork?.front_shiny ?? pokemon.sprites.front_shiny ?? null,
    data_source: "PokéAPI v2",
    data_version: dataVersion,
  };
  return { ...entry, ...(overrides[String(species.id)] ?? {}) };
});

entries.sort((a, b) => a.national_dex - b.national_dex);
for (const entry of entries) {
  if (!Number.isInteger(entry.national_dex) || !entry.name || !entry.display_name || !Array.isArray(entry.types)) {
    throw new Error(`Entrada inválida no catálogo: ${JSON.stringify(entry)}`);
  }
}

const snapshot = {
  schema_version: "1.0",
  catalog_version: dataVersion,
  generated_at: generatedAt,
  source: `${API}/pokemon-species`,
  entries,
};
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Snapshot ${dataVersion}: ${entries.length} espécies em ${outputPath}`);

