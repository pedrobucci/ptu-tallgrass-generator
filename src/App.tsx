import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { confirm as askConfirmation } from "@tauri-apps/plugin-dialog";
import { error as logError, info } from "@tauri-apps/plugin-log";
import "./App.css";
import { pokemonCatalog, pokemonCatalogSnapshot } from "./catalog";
import { calculateEncounterProbability, eligiblePokemonCount, generateEncounter, SecureRandomSource } from "./domain";
import { clearBackgroundPaths, deleteTerrain, loadHistory, loadSettings, loadTerrains, saveEncounter, saveSettings, setTerrainBackgroundPath } from "./db";
import { appFileUrl, cacheTerrainBackground, clearImageFiles, exportSettings, musicUrl, removeMusic, resolveEncounterImage, storeMusic } from "./media";
import { importTerrain, previewTerrain, terrainAsFile, type ImportPreview } from "./terrain-service";
import { DEFAULT_SETTINGS, encounterFrequencies, rarities, type AppSettingsV1, type EncounterResult, type Rarity, type Terrain } from "./types";

type Page = "home" | "encounter" | "terrains" | "history" | "settings";
const frequencyLabels = { uneventful: "Tranquila", rare: "Rara", normal: "Normal", frequent: "Frequente", eventful: "Agitada" } as const;
const rarityLabels: Record<Rarity, string> = { common: "Comum", unusual: "Incomum", rare: "Raro", super_rare: "Super-raro", legendary: "Lendário" };
const genderLabels = { male: "Macho", female: "Fêmea", genderless: "Sem sexo", unknown: "Desconhecido" } as const;
const typeLabels: Record<string, string> = { normal: "Normal", fire: "Fogo", water: "Água", electric: "Elétrico", grass: "Grama", ice: "Gelo", fighting: "Lutador", poison: "Veneno", ground: "Terra", flying: "Voador", psychic: "Psíquico", bug: "Inseto", rock: "Pedra", ghost: "Fantasma", dragon: "Dragão", dark: "Sombrio", steel: "Aço", fairy: "Fada" };
const navItems: Array<{ id: Page; label: string; glyph: string }> = [
  { id: "home", label: "Início", glyph: "⌂" }, { id: "encounter", label: "Percorrer", glyph: "◈" },
  { id: "terrains", label: "Terrenos", glyph: "≡" }, { id: "history", label: "Histórico", glyph: "◴" },
  { id: "settings", label: "Ajustes", glyph: "⚙" },
];

const formatPercent = (value: number) => new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 }).format(value);
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

function ResultCard({ result, imageUrl, onClose, audio, muted, onMute }: { result: EncounterResult; imageUrl: string | null; onClose: () => void; audio: React.RefObject<HTMLAudioElement | null>; muted: boolean; onMute: () => void }) {
  const toggleAudio = () => {
    const player = audio.current;
    if (!player) return;
    if (player.paused) void player.play(); else player.pause();
  };
  return <dialog open className="encounter-dialog" aria-labelledby="encounter-title">
    <div className="result-art">
      {imageUrl ? <img src={imageUrl} alt={result.display_name} /> : <div className="image-placeholder" aria-label="Imagem indisponível">#{String(result.national_dex).padStart(4, "0")}</div>}
      {result.shiny && <span className="shiny-badge">✦ SHINY</span>}
    </div>
    <div className="result-body">
      <p className="eyebrow">Encontro em {result.terrain_name}</p><h2 id="encounter-title">{result.display_name}</h2>
      <p className="dex-number">National Dex #{String(result.national_dex).padStart(4, "0")}</p>
      <div className="type-row">{result.types.map((type) => <span key={type} className={`type type-${type}`}>{typeLabels[type] ?? type}</span>)}</div>
      <dl className="result-grid"><div><dt>Nível</dt><dd>{result.level}</dd></div><div><dt>Sexo</dt><dd>{genderLabels[result.gender]}</dd></div><div><dt>Raridade</dt><dd>{rarityLabels[result.rarity]}</dd></div><div><dt>Nature</dt><dd>{result.nature.name}</dd></div></dl>
      <p className="nature-detail">{result.nature.raises} ↑ &nbsp; {result.nature.lowers} ↓</p>
      <div className="dialog-actions">{audio.current?.src && <button className="button secondary" onClick={toggleAudio}>Play / Pausa</button>}{audio.current?.src && <button className="button ghost" onClick={onMute}>{muted ? "Música silenciada" : "Não tocar nesta sessão"}</button>}<button className="button primary" onClick={onClose}>Fechar</button></div>
    </div>
  </dialog>;
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null);
  const [history, setHistory] = useState<EncounterResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [validationOnly, setValidationOnly] = useState(false);
  const [distance, setDistance] = useState("1");
  const [unit, setUnit] = useState<"m" | "km">("km");
  const [allowShiny, setAllowShiny] = useState(false);
  const [noEncounter, setNoEncounter] = useState<number | null>(null);
  const [result, setResult] = useState<EncounterResult | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [sessionMuted, setSessionMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const terrainFileInputRef = useRef<HTMLInputElement>(null);
  const musicFileInputRef = useRef<HTMLInputElement>(null);

  const selectedTerrain = useMemo(() => terrains.find((terrain) => terrain.id === settings?.selected_terrain_id) ?? terrains[0] ?? null, [terrains, settings?.selected_terrain_id]);
  const distanceM = Math.max(0, Number(distance) * (unit === "km" ? 1000 : 1));
  const estimatedProbability = selectedTerrain && settings ? calculateEncounterProbability(distanceM, settings.encounter_frequencies[selectedTerrain.encounter_frequency], settings.encounter_check_distance_m) : 0;

  async function refresh() {
    const [nextTerrains, nextHistory] = await Promise.all([loadTerrains(), loadHistory()]);
    setTerrains(nextTerrains); setHistory(nextHistory);
    setSettings((current) => current?.selected_terrain_id && !nextTerrains.some((terrain) => terrain.id === current.selected_terrain_id) ? { ...current, selected_terrain_id: nextTerrains[0]?.id ?? null } : current);
  }

  useEffect(() => { void (async () => {
    try {
      const [loadedSettings, loadedTerrains, loadedHistory] = await Promise.all([loadSettings(), loadTerrains(), loadHistory()]);
      const selectedId = loadedTerrains.some((terrain) => terrain.id === loadedSettings.selected_terrain_id) ? loadedSettings.selected_terrain_id : loadedTerrains[0]?.id ?? null;
      const normalized = { ...loadedSettings, selected_terrain_id: selectedId };
      if (selectedId !== loadedSettings.selected_terrain_id) await saveSettings(normalized);
      setSettings(normalized); setTerrains(loadedTerrains); setHistory(loadedHistory);
      setUnit(normalized.default_distance_unit); setAllowShiny(normalized.allow_shiny_default);
      await info("application_started");
    } catch (error) {
      await logError(`application_start_failed ${String(error)}`).catch(() => undefined);
      setFatalError("Não foi possível abrir os dados locais. Consulte o arquivo de log e tente novamente.");
    } finally { setLoading(false); }
  })(); }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    if (settings?.encounter_music_path && audioRef.current) void musicUrl(settings.encounter_music_path).then((url) => { objectUrl = url; if (audioRef.current) { audioRef.current.src = url; audioRef.current.volume = settings.volume; } }).catch(() => setNotice("O MP3 configurado não está mais disponível."));
    else if (audioRef.current) audioRef.current.removeAttribute("src");
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [settings?.encounter_music_path, settings?.volume]);

  useEffect(() => {
    let active = true, objectUrl: string | null = null;
    if (selectedTerrain?.background_cached_path) void appFileUrl(selectedTerrain.background_cached_path).then((url) => { objectUrl = url; if (active) setBackgroundUrl(url); }).catch(() => setBackgroundUrl(null)); else setBackgroundUrl(null);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedTerrain?.background_cached_path]);

  async function selectTerrain(id: string) { if (settings) { const next = { ...settings, selected_terrain_id: id }; setSettings(next); await saveSettings(next); } }
  function openImport() { terrainFileInputRef.current?.click(); }
  async function readTerrainFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      setValidationOnly(false);
      setImportPreview(previewTerrain(await file.text(), terrains));
    } catch (error) { setNotice(`Não foi possível ler o arquivo: ${String(error)}`); }
  }
  async function confirmImport() {
    if (!importPreview?.file || importPreview.errors.length) return;
    try {
      const id = await importTerrain(importPreview.file, importPreview.existingTerrain?.id ?? null);
      const background = importPreview.file.background_image_url;
      const replaced = Boolean(importPreview.existingTerrain); setImportPreview(null); await refresh();
      if (settings) { const next = { ...settings, selected_terrain_id: id }; setSettings(next); await saveSettings(next); }
      setNotice(replaced ? "Terreno substituído com sucesso." : "Terreno importado com sucesso.");
      if (background) void cacheTerrainBackground(id, background).then(async (path) => { if (path) { await setTerrainBackgroundPath(id, path); await refresh(); } });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  async function removeTerrain(id: string) { if (await askConfirmation("Excluir este terreno? O histórico será preservado.", { title: "Excluir terreno", kind: "warning" })) { await deleteTerrain(id); await refresh(); setNotice("Terreno excluído."); } }
  function validateStored(terrain: Terrain) { setValidationOnly(true); setImportPreview(previewTerrain(JSON.stringify(terrainAsFile(terrain)), terrains.filter((item) => item.id !== terrain.id))); }

  async function walk() {
    if (!settings || !selectedTerrain) return;
    if (!Number.isFinite(Number(distance)) || Number(distance) < 0) { setNotice("Informe uma distância válida, igual ou maior que zero."); return; }
    try {
      const outcome = generateEncounter({ terrain: selectedTerrain, distanceM, allowShiny, settings, catalog: pokemonCatalog, rng: new SecureRandomSource(), resultId: crypto.randomUUID(), createdAt: new Date().toISOString() });
      if (!outcome.occurred) { setNoEncounter(outcome.probability); setResult(null); return; }
      setNoEncounter(null); setResult(outcome.result);
      if (settings.audio_enabled && !sessionMuted && audioRef.current?.src) { audioRef.current.currentTime = 0; void audioRef.current.play().catch(() => setNotice("O encontro ocorreu, mas o sistema bloqueou a reprodução automática.")); }
      void saveEncounter(outcome.result).then(async () => { await info(`encounter_generated id=${outcome.result.id}`); setHistory(await loadHistory()); }).catch(async (error) => { await logError(`database_write_failed ${String(error)}`); setNotice("O encontro foi gerado, mas não pôde ser salvo no histórico."); });
      void resolveEncounterImage(outcome.result).then((image) => { if (image) { setResultImage((current) => { if (current) URL.revokeObjectURL(current); return image.url; }); setResult((current) => current ? { ...current, image_cached_path: image.path } : current); } });
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function persistSettings() { if (settings) try { await saveSettings(settings); if (audioRef.current) audioRef.current.volume = settings.volume; setNotice("Configurações salvas."); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } }
  function pickMusic() { musicFileInputRef.current?.click(); }
  async function readMusicFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !settings) return;
    try {
      const path = await storeMusic(new Uint8Array(await file.arrayBuffer()));
      const next = { ...settings, encounter_music_path: path, audio_enabled: true };
      setSettings(next); await saveSettings(next); setNotice("MP3 copiado para o aplicativo.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  async function clearMusic() { if (settings) { await removeMusic(); const next = { ...settings, encounter_music_path: null, audio_enabled: false }; setSettings(next); await saveSettings(next); } }
  async function clearCache() { await clearImageFiles(); await clearBackgroundPaths(); await refresh(); setNotice("Cache de imagens limpo."); }
  async function restoreDefaults() { if (await askConfirmation("Restaurar configurações e remover o MP3 copiado?", { title: "Restaurar padrões", kind: "warning" })) { await removeMusic(); const next = structuredClone(DEFAULT_SETTINGS); next.selected_terrain_id = terrains[0]?.id ?? null; setSettings(next); setUnit(next.default_distance_unit); setAllowShiny(next.allow_shiny_default); await saveSettings(next); setNotice("Configurações padrão restauradas."); } }
  async function moreHistory() { const next = await loadHistory(50, history.length); setHistory((current) => [...current, ...next]); }

  if (loading) return <main className="splash"><div className="grass-mark">╱╲╱╲</div><p>Carregando dados locais…</p></main>;
  if (fatalError || !settings) return <main className="splash error-state"><h1>Algo deu errado</h1><p>{fatalError}</p><button className="button primary" onClick={() => location.reload()}>Tentar novamente</button></main>;

  return <div className="app-shell" style={backgroundUrl ? { "--terrain-background": `url(${backgroundUrl})` } as React.CSSProperties : undefined}>
    <audio ref={audioRef} preload="auto" />
    <input ref={terrainFileInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => void readTerrainFile(event)} />
    <input ref={musicFileInputRef} hidden type="file" accept="audio/mpeg,.mp3" onChange={(event) => void readMusicFile(event)} />
    <aside className="sidebar"><div className="brand"><div className="brand-mark">╱╲</div><div><strong>PTU</strong><span>Encounter Generator</span></div></div><nav aria-label="Navegação principal">{navItems.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><span aria-hidden>{item.glyph}</span>{item.label}</button>)}</nav><p className="catalog-version">Catálogo {pokemonCatalogSnapshot.catalog_version}<br />{pokemonCatalogSnapshot.entries.length} espécies</p></aside>
    <main className="content">
      {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button></div>}
      {page === "home" && <><header className="page-header"><p className="eyebrow">Bem-vindo à mesa</p><h1>Pronto para explorar?</h1><p>Escolha um terreno, informe a distância e deixe o encontro por nossa conta.</p></header><section className="hero-card"><div><p className="eyebrow">Terreno selecionado</p><h2>{selectedTerrain?.name ?? "Nenhum terreno"}</h2><p>{selectedTerrain ? `${frequencyLabels[selectedTerrain.encounter_frequency]} · ${eligiblePokemonCount(selectedTerrain, pokemonCatalog)} Pokémon elegíveis` : "Importe um arquivo JSON para começar."}</p></div><button className="button primary large" onClick={() => selectedTerrain ? setPage("encounter") : void openImport()}>{selectedTerrain ? "Novo percurso" : "Importar terreno"}</button></section><div className="home-grid"><section className="panel"><div className="section-heading"><h2>Último encontro</h2>{history.length > 0 && <button className="link-button" onClick={() => setPage("history")}>Ver histórico</button>}</div>{history[0] ? <div className="last-encounter"><div className="mini-dex">#{String(history[0].national_dex).padStart(4, "0")}</div><div><strong>{history[0].display_name}</strong><span>Nível {history[0].level} · {history[0].terrain_name}</span><small>{formatDate(history[0].created_at)}</small></div>{history[0].shiny && <span className="shiny-dot">✦</span>}</div> : <p className="empty">Nenhum encontro registrado ainda.</p>}</section><section className="panel quick-actions"><h2>Atalhos</h2><button onClick={() => setPage("terrains")}>Gerenciar terrenos <span>→</span></button><button onClick={() => setPage("settings")}>Ajustar probabilidades <span>→</span></button></section></div></>}
      {page === "encounter" && <><header className="page-header"><p className="eyebrow">Gerar encontro</p><h1>Percorrer terreno</h1><p>Um percurso pode gerar no máximo um encontro.</p></header><section className="panel encounter-form"><label>Terreno<select value={selectedTerrain?.id ?? ""} onChange={(event) => void selectTerrain(event.target.value)} disabled={!terrains.length}>{terrains.length ? terrains.map((terrain) => <option key={terrain.id} value={terrain.id}>{terrain.name}</option>) : <option value="">Importe um terreno</option>}</select></label><div className="field-group"><label>Distância<input type="number" min="0" step="any" value={distance} onChange={(event) => setDistance(event.target.value)} /></label><label>Unidade<select value={unit} onChange={(event) => setUnit(event.target.value as "m" | "km")}><option value="m">metros</option><option value="km">quilômetros</option></select></label></div><label className="checkbox"><input type="checkbox" checked={allowShiny} onChange={(event) => setAllowShiny(event.target.checked)} /><span>Permitir sorteio de Shiny</span></label><div className="encounter-stats"><div><span>Frequência</span><strong>{selectedTerrain ? frequencyLabels[selectedTerrain.encounter_frequency] : "—"}</strong></div><div><span>Chance estimada</span><strong>{formatPercent(estimatedProbability)}</strong></div><div><span>Elegíveis</span><strong>{selectedTerrain ? eligiblePokemonCount(selectedTerrain, pokemonCatalog) : 0}</strong></div></div><button className="button primary journey" onClick={() => void walk()} disabled={!selectedTerrain || eligiblePokemonCount(selectedTerrain, pokemonCatalog) === 0}>PERCORRER</button>{noEncounter !== null && <div className="no-encounter"><strong>Nenhum encontro ocorreu.</strong><span>A chance era {formatPercent(noEncounter)}.</span></div>}</section></>}
      {page === "terrains" && <><header className="page-header actions-header"><div><p className="eyebrow">Biblioteca local</p><h1>Terrenos</h1><p>Importe e revise as tabelas usadas nos encontros.</p></div><button className="button primary" onClick={() => void openImport()}>Importar JSON</button></header>{!terrains.length ? <section className="panel empty-card"><div className="grass-mark">╱╲╱╲</div><h2>Nenhum terreno importado</h2><p>Use um arquivo no schema 1.0 descrito na especificação.</p><button className="button primary" onClick={() => void openImport()}>Escolher arquivo</button></section> : <div className="terrain-layout"><section className="terrain-list">{terrains.map((terrain) => <button key={terrain.id} className={selectedTerrain?.id === terrain.id ? "selected" : ""} onClick={() => void selectTerrain(terrain.id)}><strong>{terrain.name}</strong><span>{frequencyLabels[terrain.encounter_frequency]} · {terrain.pokemon_table.length} entradas</span></button>)}</section>{selectedTerrain && <section className="panel terrain-detail"><div className="section-heading"><div><p className="eyebrow">Schema {selectedTerrain.schema_version}</p><h2>{selectedTerrain.name}</h2></div><div className="inline-actions"><button className="button ghost" onClick={() => validateStored(selectedTerrain)}>Validar</button><button className="button danger" onClick={() => void removeTerrain(selectedTerrain.id)}>Excluir</button></div></div><dl className="terrain-summary"><div><dt>Níveis</dt><dd>{selectedTerrain.min_lvl ?? 1}–{selectedTerrain.max_lvl ?? 100}</dd></div><div><dt>Frequência</dt><dd>{frequencyLabels[selectedTerrain.encounter_frequency]}</dd></div><div><dt>Shiny</dt><dd>{selectedTerrain.shiny_rate == null ? "Global" : formatPercent(selectedTerrain.shiny_rate)}</dd></div></dl><div className="pokemon-table"><div className="table-head"><span>Pokémon</span><span>Raridade</span><span>Nível</span></div>{selectedTerrain.pokemon_table.map((entry) => { const pokemon = pokemonCatalog.get(entry.national_dex); return <div key={entry.id}><span><b>#{String(entry.national_dex).padStart(4, "0")}</b> {pokemon?.display_name ?? "Desconhecido"}</span><span>{rarityLabels[entry.rarity]}</span><span>{entry.min_lvl ?? selectedTerrain.min_lvl ?? 1}–{entry.max_lvl ?? selectedTerrain.max_lvl ?? 100}</span></div>; })}</div></section>}</div>}</>}
      {page === "history" && <><header className="page-header"><p className="eyebrow">Registro local</p><h1>Histórico</h1><p>Encontros bem-sucedidos, mesmo que o terreno seja removido.</p></header><section className="panel history-list">{history.length ? history.map((item) => <article key={item.id}><div className="mini-dex">#{String(item.national_dex).padStart(4, "0")}</div><div className="history-main"><strong>{item.display_name} {item.shiny && <span className="shiny-text">✦ Shiny</span>}</strong><span>{item.terrain_name} · {formatDate(item.created_at)}</span></div><div><span>Nível</span><strong>{item.level}</strong></div><div><span>Nature</span><strong>{item.nature.name}</strong></div><div><span>Chance</span><strong>{formatPercent(item.encounter_probability)}</strong></div></article>) : <p className="empty">Nenhum encontro registrado.</p>}</section>{history.length > 0 && history.length % 50 === 0 && <button className="button secondary centered" onClick={() => void moreHistory()}>Carregar mais</button>}</>}
      {page === "settings" && <><header className="page-header actions-header"><div><p className="eyebrow">Preferências locais</p><h1>Configurações</h1><p>Todas as probabilidades abaixo são configuráveis.</p></div><button className="button primary" onClick={() => void persistSettings()}>Salvar alterações</button></header><div className="settings-grid">
        <section className="panel settings-section"><h2>Encontros</h2><p>Probabilidade base por intervalo.</p>{encounterFrequencies.map((key) => <label key={key}>{frequencyLabels[key]}<div className="input-suffix"><input type="number" min="0" max="100" step="0.1" value={settings.encounter_frequencies[key] * 100} onChange={(event) => setSettings({ ...settings, encounter_frequencies: { ...settings.encounter_frequencies, [key]: Number(event.target.value) / 100 } })} /><span>%</span></div></label>)}<label>Intervalo em metros<input type="number" min="1" value={settings.encounter_check_distance_m} onChange={(event) => setSettings({ ...settings, encounter_check_distance_m: Number(event.target.value) })} /></label><label>Unidade padrão<select value={settings.default_distance_unit} onChange={(event) => setSettings({ ...settings, default_distance_unit: event.target.value as "m" | "km" })}><option value="m">metros</option><option value="km">quilômetros</option></select></label></section>
        <section className="panel settings-section"><h2>Raridade</h2><p>Pesos relativos; não precisam somar 100.</p>{rarities.map((key) => <label key={key}>{rarityLabels[key]}<input type="number" min="0" step="0.1" value={settings.rarity_weights[key]} onChange={(event) => setSettings({ ...settings, rarity_weights: { ...settings.rarity_weights, [key]: Number(event.target.value) } })} /></label>)}</section>
        <section className="panel settings-section"><h2>Shiny</h2><label className="checkbox"><input type="checkbox" checked={settings.allow_shiny_default} onChange={(event) => setSettings({ ...settings, allow_shiny_default: event.target.checked })} /><span>Permitir por padrão</span></label><label>Taxa global (0–1)<input type="number" min="0" max="1" step="0.000001" value={settings.global_shiny_rate} onChange={(event) => setSettings({ ...settings, global_shiny_rate: Number(event.target.value) })} /></label><small>Atual: {formatPercent(settings.global_shiny_rate)} {settings.global_shiny_rate > 0 && `(≈ 1 em ${Math.round(1 / settings.global_shiny_rate).toLocaleString("pt-BR")})`}</small></section>
        <section className="panel settings-section"><h2>Áudio</h2><label className="checkbox"><input type="checkbox" checked={settings.audio_enabled} onChange={(event) => setSettings({ ...settings, audio_enabled: event.target.checked })} /><span>Reproduzir em encontros</span></label><label>Volume<input type="range" min="0" max="1" step="0.01" value={settings.volume} onChange={(event) => setSettings({ ...settings, volume: Number(event.target.value) })} /></label><p className="file-status">{settings.encounter_music_path ? "MP3 armazenado no aplicativo" : "Nenhum MP3 configurado"}</p><div className="inline-actions"><button className="button secondary" onClick={() => void pickMusic()}>Selecionar MP3</button>{settings.encounter_music_path && <button className="button ghost" onClick={() => { if (audioRef.current) { audioRef.current.currentTime = 0; void audioRef.current.play(); } }}>Testar</button>}{settings.encounter_music_path && <button className="button danger" onClick={() => void clearMusic()}>Remover</button>}</div></section>
        <section className="panel settings-section data-section"><h2>Dados</h2><dl><div><dt>Catálogo</dt><dd>{pokemonCatalogSnapshot.catalog_version}</dd></div><div><dt>Fonte</dt><dd>{pokemonCatalogSnapshot.entries[0]?.data_source}</dd></div><div><dt>Espécies</dt><dd>{pokemonCatalogSnapshot.entries.length}</dd></div></dl><div className="data-actions"><button className="button secondary" onClick={() => void clearCache()}>Limpar cache</button><button className="button secondary" onClick={() => void exportSettings(settings).then((saved) => saved && setNotice("Configurações exportadas."))}>Exportar</button><button className="button danger" onClick={() => void restoreDefaults()}>Restaurar padrões</button></div></section>
      </div></>}
    </main>
    <nav className="mobile-nav" aria-label="Navegação principal">{navItems.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}><span>{item.glyph}</span>{item.label}</button>)}</nav>
    {importPreview && <dialog open className="import-dialog" aria-labelledby="import-title"><div className="section-heading"><div><p className="eyebrow">{validationOnly ? "Validação" : "Importar terreno"}</p><h2 id="import-title">{importPreview.file?.terrain.name ?? "Arquivo inválido"}</h2></div><button className="close-button" aria-label="Fechar" onClick={() => setImportPreview(null)}>×</button></div>{importPreview.file && <dl className="import-summary"><div><dt>Pokémon</dt><dd>{importPreview.file.terrain.pokemon_table.length}</dd></div><div><dt>Frequência</dt><dd>{frequencyLabels[importPreview.file.terrain.encounter_frequency]}</dd></div><div><dt>Schema</dt><dd>{importPreview.file.schema_version}</dd></div></dl>}{importPreview.errors.length > 0 && <div className="validation errors"><strong>Erros que bloqueiam a importação</strong><ul>{importPreview.errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}{importPreview.warnings.length > 0 && <div className="validation warnings"><strong>Avisos</strong><ul>{importPreview.warnings.map((message) => <li key={message}>{message}</li>)}</ul></div>}<div className="dialog-actions"><button className="button ghost" onClick={() => setImportPreview(null)}>Fechar</button>{!validationOnly && importPreview.file && !importPreview.errors.length && <button className="button primary" onClick={() => void confirmImport()}>{importPreview.existingTerrain ? "Substituir terreno" : "Confirmar importação"}</button>}</div></dialog>}
    {(result || importPreview) && <div className="modal-backdrop" />}
    {result && <ResultCard result={result} imageUrl={resultImage} audio={audioRef} muted={sessionMuted} onMute={() => { setSessionMuted(true); audioRef.current?.pause(); }} onClose={() => { setResult(null); if (resultImage) URL.revokeObjectURL(resultImage); setResultImage(null); }} />}
  </div>;
}
