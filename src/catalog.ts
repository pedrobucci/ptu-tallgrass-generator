import snapshotJson from "./data/pokemon-catalog.v1.json";
import type { PokemonCatalogEntry, PokemonCatalogSnapshot } from "./types";

const snapshot = snapshotJson as PokemonCatalogSnapshot;

if (snapshot.schema_version !== "1.0" || !Array.isArray(snapshot.entries) || !snapshot.entries.length) {
  throw new Error("O snapshot local do catálogo Pokémon é inválido.");
}

export const pokemonCatalogSnapshot = snapshot;
export const pokemonCatalog = new Map<number, PokemonCatalogEntry>(
  snapshot.entries.map((entry) => [entry.national_dex, entry]),
);

