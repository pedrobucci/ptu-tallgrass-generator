import { save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, exists, mkdir, readFile, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import { warn } from "@tauri-apps/plugin-log";
import { pokemonCatalog } from "./catalog";
import type { AppSettingsV1, EncounterResult } from "./types";

const downloads = new Map<string, Promise<string | null>>();

function looksLikeMp3(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

export async function storeMusic(bytes: Uint8Array): Promise<string> {
  if (!looksLikeMp3(bytes)) throw new Error("O arquivo selecionado não parece ser um MP3 válido.");
  await mkdir("media", { baseDir: BaseDirectory.AppData, recursive: true });
  await writeFile("media/encounter.mp3", bytes, { baseDir: BaseDirectory.AppData });
  return "media/encounter.mp3";
}

export async function removeMusic(): Promise<void> {
  if (await exists("media/encounter.mp3", { baseDir: BaseDirectory.AppData })) {
    await remove("media/encounter.mp3", { baseDir: BaseDirectory.AppData });
  }
}

function mimeFromPath(path: string): string {
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

export async function appFileUrl(path: string, mime = mimeFromPath(path)): Promise<string> {
  const bytes = await readFile(path, { baseDir: BaseDirectory.AppData });
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export async function musicUrl(path: string): Promise<string> {
  return appFileUrl(path, "audio/mpeg");
}

function safeRemoteUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Protocolo remoto não permitido.");
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(0|10|127|169\.254|192\.168)\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || privateIpv4) {
    throw new Error("Endereço local ou privado não permitido.");
  }
  return url;
}

function imageExtension(contentType: string): string {
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("jpeg")) return "jpg";
  return "png";
}

async function downloadImage(urlValue: string, basePath: string, maxBytes: number): Promise<string> {
  const url = safeRemoteUrl(urlValue);
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!contentType.startsWith("image/")) throw new Error("A URL não retornou uma imagem.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("A imagem excede o limite de tamanho.");
  const path = `${basePath}.${imageExtension(contentType)}`;
  await writeFile(path, bytes, { baseDir: BaseDirectory.AppData });
  return path;
}

async function findExisting(basePath: string): Promise<string | null> {
  for (const extension of ["png", "jpg", "webp", "gif"]) {
    const path = `${basePath}.${extension}`;
    if (await exists(path, { baseDir: BaseDirectory.AppData })) return path;
  }
  return null;
}

async function cachedDownload(url: string, basePath: string, maxBytes: number): Promise<string | null> {
  const existing = await findExisting(basePath);
  if (existing) return existing;
  const pending = downloads.get(basePath) ?? downloadImage(url, basePath, maxBytes).catch(async (error) => {
    await warn(`remote_image_unavailable ${String(error)}`);
    return null;
  });
  downloads.set(basePath, pending);
  try {
    return await pending;
  } finally {
    downloads.delete(basePath);
  }
}

export async function resolveEncounterImage(result: EncounterResult): Promise<{ url: string; path: string } | null> {
  const pokemon = pokemonCatalog.get(result.national_dex);
  if (!pokemon) return null;
  await mkdir("cache/pokemon", { baseDir: BaseDirectory.AppData, recursive: true });
  const dex = String(result.national_dex).padStart(4, "0");
  const variants: Array<{ suffix: string; remote: string | null }> = result.shiny
    ? [{ suffix: "shiny", remote: pokemon.sprite_shiny_url }, { suffix: "normal", remote: pokemon.sprite_default_url }]
    : [{ suffix: "normal", remote: pokemon.sprite_default_url }];
  for (const variant of variants) {
    const basePath = `cache/pokemon/${dex}-${variant.suffix}`;
    const path = (await findExisting(basePath)) ?? (variant.remote ? await cachedDownload(variant.remote, basePath, 5 * 1024 * 1024) : null);
    if (path) return { path, url: await appFileUrl(path) };
  }
  return null;
}

export async function cacheTerrainBackground(terrainId: string, remoteUrl: string): Promise<string | null> {
  await mkdir("cache/backgrounds", { baseDir: BaseDirectory.AppData, recursive: true });
  return cachedDownload(remoteUrl, `cache/backgrounds/${terrainId}`, 15 * 1024 * 1024);
}

export async function clearImageFiles(): Promise<void> {
  if (await exists("cache", { baseDir: BaseDirectory.AppData })) {
    await remove("cache", { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

export async function exportSettings(settings: AppSettingsV1): Promise<boolean> {
  const path = await save({ defaultPath: "ptu-encounter-settings.json", filters: [{ name: "Configurações JSON", extensions: ["json"] }] });
  if (!path) return false;
  await writeTextFile(path, `${JSON.stringify({ schema_version: "1.0", exported_at: new Date().toISOString(), settings }, null, 2)}\n`);
  return true;
}
