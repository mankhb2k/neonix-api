import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { R2Service } from "../r2/r2.service";

/** Where the sound library lives in the system-assets bucket (the folder was created as `soudeffects/`). */
export const SOUNDS_PREFIX = "soudeffects";

/** What `soudeffects/manifest.json` holds (written by scripts/publish_sounds.mjs). */
export interface SoundManifest {
  version: number;
  categories: { id: string; title: string }[];
  sounds: { id: string; name: string; category: string; file: string; durationMs: number; mimeType: string; peaks: number[] }[];
}

export interface SoundCatalogue {
  categories: SoundManifest["categories"];
  sounds: { id: string; name: string; category: string; url: string; durationMs: number; mimeType: string; peaks: number[] }[];
}

/** Checks the manifest has the shape the app relies on; throws a readable error otherwise. */
export function parseSoundManifest(text: string): SoundManifest {
  const data = JSON.parse(text) as Partial<SoundManifest>;
  if (data.version !== 1) throw new Error(`unsupported sound manifest version ${String(data.version)}`);
  if (!Array.isArray(data.sounds) || !Array.isArray(data.categories)) throw new Error("malformed sound manifest");
  const categories = new Set(data.categories.map((c) => c.id));
  const ids = new Set<string>();
  for (const s of data.sounds) {
    if (!s.id || !s.file || !(s.durationMs > 0) || !categories.has(s.category)) throw new Error(`bad sound entry ${JSON.stringify(s)}`);
    // The mini waveform the picker draws before the file is downloaded: loudness per slice, 0...1.
    if (!Array.isArray(s.peaks) || s.peaks.length === 0 || !s.peaks.every((p) => typeof p === "number" && p >= 0 && p <= 1)) throw new Error(`bad peaks for ${s.id}`);
    if (ids.has(s.id)) throw new Error(`duplicate sound id ${s.id}`);
    ids.add(s.id);
  }
  return data as SoundManifest;
}

/** Turns the manifest's file keys into URLs the app can play and download. */
export async function buildSoundCatalogue(manifest: SoundManifest, urlFor: (key: string) => Promise<string>): Promise<SoundCatalogue> {
  const sounds = await Promise.all(
    manifest.sounds.map(async (s) => ({ id: s.id, name: s.name, category: s.category, url: await urlFor(s.file), durationMs: s.durationMs, mimeType: s.mimeType, peaks: s.peaks })),
  );
  return { categories: manifest.categories, sounds };
}

@Injectable()
export class SoundsService {
  private manifest: { value: SoundManifest; at: number } | null = null;

  constructor(private readonly r2: R2Service) {}

  async catalogue(): Promise<SoundCatalogue> {
    let manifest: SoundManifest;
    try {
      manifest = await this.loadManifest();
    } catch (error) {
      throw new ServiceUnavailableException(`Sound catalogue unavailable: ${(error as Error).message}`);
    }
    return buildSoundCatalogue(manifest, (key) => this.r2.systemAssetUrl(key));
  }

  /** The manifest changes rarely: keep it for five minutes. */
  private async loadManifest(): Promise<SoundManifest> {
    if (this.manifest && Date.now() - this.manifest.at < 5 * 60_000) return this.manifest.value;
    const value = parseSoundManifest(await this.r2.getText("system", `${SOUNDS_PREFIX}/manifest.json`));
    this.manifest = { value, at: Date.now() };
    return value;
  }
}
