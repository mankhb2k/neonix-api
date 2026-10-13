import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { R2Service } from "../r2/r2.service";

/** What `stickers/manifest.json` in the system-assets bucket holds (written by scripts/publish_stickers.mjs). */
export interface StickerManifest {
  version: number;
  license: { name: string; holder: string; source: string; file: string };
  categories: { id: string; title: string }[];
  stickers: { id: string; name: string; category: string; file: string; width: number; height: number }[];
}

export interface StickerCatalogue {
  license: StickerManifest["license"];
  categories: StickerManifest["categories"];
  stickers: { id: string; name: string; category: string; url: string; width: number; height: number }[];
}

/** Checks the manifest has the shape the app relies on; throws a readable error otherwise. */
export function parseManifest(text: string): StickerManifest {
  const data = JSON.parse(text) as Partial<StickerManifest>;
  if (data.version !== 1) throw new Error(`unsupported sticker manifest version ${String(data.version)}`);
  if (!Array.isArray(data.stickers) || !Array.isArray(data.categories) || !data.license) throw new Error("malformed sticker manifest");
  const categories = new Set(data.categories.map((c) => c.id));
  const ids = new Set<string>();
  for (const s of data.stickers) {
    if (!s.id || !s.file || !categories.has(s.category)) throw new Error(`bad sticker entry ${JSON.stringify(s)}`);
    if (ids.has(s.id)) throw new Error(`duplicate sticker id ${s.id}`);
    ids.add(s.id);
  }
  return data as StickerManifest;
}

/** Turns the manifest's file keys into URLs the app can download. */
export async function buildCatalogue(manifest: StickerManifest, urlFor: (key: string) => Promise<string>): Promise<StickerCatalogue> {
  const stickers = await Promise.all(
    manifest.stickers.map(async (s) => ({ id: s.id, name: s.name, category: s.category, url: await urlFor(s.file), width: s.width, height: s.height })),
  );
  return { license: manifest.license, categories: manifest.categories, stickers };
}

@Injectable()
export class StickersService {
  private manifest: { value: StickerManifest; at: number } | null = null;

  constructor(private readonly r2: R2Service) {}

  async catalogue(): Promise<StickerCatalogue> {
    let manifest: StickerManifest;
    try {
      manifest = await this.loadManifest();
    } catch (error) {
      throw new ServiceUnavailableException(`Sticker catalogue unavailable: ${(error as Error).message}`);
    }
    return buildCatalogue(manifest, (key) => this.r2.systemAssetUrl(key));
  }

  /** The manifest changes rarely: keep it for five minutes. */
  private async loadManifest(): Promise<StickerManifest> {
    if (this.manifest && Date.now() - this.manifest.at < 5 * 60_000) return this.manifest.value;
    const value = parseManifest(await this.r2.getText("system", "stickers/manifest.json"));
    this.manifest = { value, at: Date.now() };
    return value;
  }
}
