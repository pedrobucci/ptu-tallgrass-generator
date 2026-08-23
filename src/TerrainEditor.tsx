import { useMemo, useState } from "react";
import { confirm as askConfirmation } from "@tauri-apps/plugin-dialog";
import { pokemonCatalog, pokemonCatalogSnapshot } from "./catalog";
import { previewTerrain } from "./terrain-service";
import { encounterFrequencies, rarities, type EncounterFrequency, type Rarity, type Terrain, type TerrainFileV1 } from "./types";

const frequencyLabels: Record<EncounterFrequency, string> = { uneventful: "Tranquila", rare: "Rara", normal: "Normal", frequent: "Frequente", eventful: "Agitada" };
const rarityLabels: Record<Rarity, string> = { common: "Comum", unusual: "Incomum", rare: "Raro", super_rare: "Super-raro", legendary: "Lendário" };
type Entry = TerrainFileV1["terrain"]["pokemon_table"][number];
type ShinyMode = "global" | "never" | "custom";

const numberOrNull = (value: string) => value === "" ? null : Number(value);
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function initialFile(terrain: Terrain | null): TerrainFileV1 {
  if (terrain) return {
    schema_version: "1.0", background_image_url: terrain.background_source,
    terrain: { name: terrain.name, min_lvl: terrain.min_lvl, max_lvl: terrain.max_lvl, encounter_frequency: terrain.encounter_frequency, shiny_rate: terrain.shiny_rate,
      pokemon_table: terrain.pokemon_table.map((entry) => ({ number: entry.national_dex, rarity: entry.rarity, gender: entry.gender_enabled, male_odd: entry.male_percent, min_lvl: entry.min_lvl, max_lvl: entry.max_lvl })) },
  };
  return { schema_version: "1.0", background_image_url: null, terrain: { name: "", min_lvl: 1, max_lvl: 10, encounter_frequency: "normal", shiny_rate: null, pokemon_table: [] } };
}

export function TerrainEditor({ terrain, terrains, onSave, onCancel, onDirtyChange }: { terrain: Terrain | null; terrains: Terrain[]; onSave: (file: TerrainFileV1) => Promise<void>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const original = useMemo(() => initialFile(terrain), [terrain]);
  const [file, setFile] = useState(original);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [saving, setSaving] = useState(false);
  const shinyMode: ShinyMode = file.terrain.shiny_rate == null ? "global" : file.terrain.shiny_rate === 0 ? "never" : "custom";
  const shinyDenominator = shinyMode === "custom" ? Math.round(1 / (file.terrain.shiny_rate as number)) : 4096;
  const dirty = JSON.stringify(file) !== JSON.stringify(original);
  const update = (next: TerrainFileV1) => { setFile(next); onDirtyChange(JSON.stringify(next) !== JSON.stringify(original)); };
  const updateTerrain = (values: Partial<TerrainFileV1["terrain"]>) => update({ ...file, terrain: { ...file.terrain, ...values } });
  const results = useMemo(() => {
    const query = normalize(search.trim());
    if (!query) return [];
    return pokemonCatalogSnapshot.entries.filter((entry) => !file.terrain.pokemon_table.some((item) => item.number === entry.national_dex) && (String(entry.national_dex).includes(query) || normalize(entry.display_name).includes(query) || entry.name.includes(query))).slice(0, 12);
  }, [search, file.terrain.pokemon_table]);

  function updateEntry(index: number, values: Partial<Entry>) {
    updateTerrain({ pokemon_table: file.terrain.pokemon_table.map((entry, position) => position === index ? { ...entry, ...values } : entry) });
  }
  function addPokemon(number: number) {
    const pokemon = pokemonCatalog.get(number);
    updateTerrain({ pokemon_table: [...file.terrain.pokemon_table, { number, rarity: pokemon?.is_legendary || pokemon?.is_mythical ? "legendary" : "common", gender: !pokemon?.genderless, male_odd: null, min_lvl: null, max_lvl: null }] });
    setSearch("");
  }
  async function submit() {
    const preview = previewTerrain(JSON.stringify(file), terrains.filter((item) => item.id !== terrain?.id));
    const errors = [...preview.errors];
    if (file.background_image_url) {
      try { if (!["http:", "https:"].includes(new URL(file.background_image_url).protocol)) errors.push("background_image_url: use um endereço HTTP ou HTTPS."); }
      catch { errors.push("background_image_url: informe uma URL válida."); }
    }
    if (preview.existingTerrain) errors.push(`terrain.name: já existe um terreno chamado ${preview.existingTerrain.name}.`);
    setMessages({ errors, warnings: preview.warnings });
    if (!preview.file || errors.length) return;
    if (preview.warnings.length && !await askConfirmation(`O terreno possui ${preview.warnings.length} aviso(s). Deseja salvar mesmo assim?`, { title: "Salvar terreno", kind: "warning" })) return;
    setSaving(true);
    try { await onSave(preview.file); onDirtyChange(false); }
    catch (error) { setMessages({ errors: [error instanceof Error ? error.message : String(error)], warnings: preview.warnings }); }
    finally { setSaving(false); }
  }
  async function cancel() {
    if (!dirty || await askConfirmation("Descartar as alterações deste terreno?", { title: "Alterações não salvas", kind: "warning" })) { onDirtyChange(false); onCancel(); }
  }

  return <section className="panel terrain-editor">
    <div className="section-heading"><div><p className="eyebrow">{terrain ? "Editar terreno" : "Novo terreno"}</p><h2>{file.terrain.name || "Terreno sem nome"}</h2></div><div className="inline-actions"><button className="button ghost" onClick={() => void cancel()}>Cancelar</button><button className="button primary" disabled={saving} onClick={() => void submit()}>{saving ? "Salvando…" : "Salvar"}</button></div></div>
    {messages.errors.length > 0 && <div className="validation errors"><strong>Corrija antes de salvar</strong><ul>{messages.errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
    {messages.warnings.length > 0 && <div className="validation warnings"><strong>Avisos</strong><ul>{messages.warnings.map((message) => <li key={message}>{message}</li>)}</ul></div>}
    <div className="editor-grid">
      <label>Nome<input maxLength={120} value={file.terrain.name} onChange={(event) => updateTerrain({ name: event.target.value })} /></label>
      <label>Frequência<select value={file.terrain.encounter_frequency} onChange={(event) => updateTerrain({ encounter_frequency: event.target.value as EncounterFrequency })}>{encounterFrequencies.map((value) => <option key={value} value={value}>{frequencyLabels[value]}</option>)}</select></label>
      <label>Nível mínimo<input type="number" min="0" max="100" value={file.terrain.min_lvl ?? ""} onChange={(event) => updateTerrain({ min_lvl: numberOrNull(event.target.value) })} /></label>
      <label>Nível máximo<input type="number" min="0" max="100" value={file.terrain.max_lvl ?? ""} onChange={(event) => updateTerrain({ max_lvl: numberOrNull(event.target.value) })} /></label>
      <label>Shiny<select value={shinyMode} onChange={(event) => { const mode = event.target.value as ShinyMode; updateTerrain({ shiny_rate: mode === "global" ? null : mode === "never" ? 0 : 1 / 4096 }); }}><option value="global">Usar taxa global</option><option value="never">Nunca</option><option value="custom">Probabilidade 1 em N</option></select></label>
      {shinyMode === "custom" && <label>Um shiny em<input type="number" min="1" step="1" value={shinyDenominator} onChange={(event) => updateTerrain({ shiny_rate: 1 / Math.max(1, Number(event.target.value)) })} /></label>}
      <label className="editor-wide">URL da imagem de fundo (opcional)<input type="url" placeholder="https://…" value={file.background_image_url ?? ""} onChange={(event) => update({ ...file, background_image_url: event.target.value || null })} /></label>
    </div>
    <div className="pokemon-editor-heading"><div><h3>Tabela de Pokémon</h3><p>{file.terrain.pokemon_table.length} entrada(s)</p></div><label>Buscar por nome ou Pokédex<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ex.: Pikachu ou 25" /></label></div>
    {results.length > 0 && <div className="pokemon-results">{results.map((pokemon) => <button key={pokemon.national_dex} onClick={() => addPokemon(pokemon.national_dex)}><b>#{String(pokemon.national_dex).padStart(4, "0")}</b> {pokemon.display_name}<span>Adicionar</span></button>)}</div>}
    <div className="pokemon-editor-list">{file.terrain.pokemon_table.map((entry, index) => { const pokemon = pokemonCatalog.get(entry.number); return <article key={entry.number}><header><strong>#{String(entry.number).padStart(4, "0")} {pokemon?.display_name}</strong><button className="button danger" onClick={() => updateTerrain({ pokemon_table: file.terrain.pokemon_table.filter((_, position) => position !== index) })}>Remover</button></header><div className="entry-grid"><label>Raridade<select value={entry.rarity} onChange={(event) => updateEntry(index, { rarity: event.target.value as Rarity })}>{rarities.map((value) => <option key={value} value={value}>{rarityLabels[value]}</option>)}</select></label><label>Nível mínimo<input type="number" min="0" max="100" placeholder="Do terreno" value={entry.min_lvl ?? ""} onChange={(event) => updateEntry(index, { min_lvl: numberOrNull(event.target.value) })} /></label><label>Nível máximo<input type="number" min="0" max="100" placeholder="Do terreno" value={entry.max_lvl ?? ""} onChange={(event) => updateEntry(index, { max_lvl: numberOrNull(event.target.value) })} /></label><label className="checkbox"><input type="checkbox" checked={entry.gender} onChange={(event) => updateEntry(index, { gender: event.target.checked, male_odd: event.target.checked ? entry.male_odd : null })} /><span>Sortear gênero</span></label>{entry.gender && !pokemon?.genderless && <label>% de machos<input type="number" min="0" max="100" placeholder={pokemon?.male_percent == null ? "Desconhecida" : `Padrão: ${pokemon.male_percent}%`} value={entry.male_odd ?? ""} onChange={(event) => updateEntry(index, { male_odd: numberOrNull(event.target.value) })} /></label>}</div></article>; })}{!file.terrain.pokemon_table.length && <p className="empty">Busque e adicione ao menos um Pokémon.</p>}</div>
  </section>;
}
