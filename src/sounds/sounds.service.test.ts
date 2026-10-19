import { describe, expect, it } from "vitest";
import { buildSoundCatalogue, parseSoundManifest } from "./sounds.service";

const manifest = {
  version: 1,
  categories: [{ id: "ui", title: "UI" }, { id: "impacts", title: "Impacts" }],
  sounds: [
    { id: "sfx-pop", name: "Pop", category: "ui", file: "soudeffects/ui/pop.m4a", durationMs: 180, mimeType: "audio/mp4", peaks: [1, 0.5, 0.2] },
    { id: "sfx-boom", name: "Boom", category: "impacts", file: "soudeffects/impacts/boom.m4a", durationMs: 2200, mimeType: "audio/mp4", peaks: [0.1, 1] },
  ],
};

describe("sound manifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseSoundManifest(JSON.stringify(manifest)).sounds).toHaveLength(2);
  });

  it("rejects an unknown version, a duplicate id, an unknown category, a zero length and bad peaks", () => {
    expect(() => parseSoundManifest(JSON.stringify({ ...manifest, version: 2 }))).toThrow(/version/);
    expect(() => parseSoundManifest(JSON.stringify({ ...manifest, sounds: [manifest.sounds[0], manifest.sounds[0]] }))).toThrow(/duplicate/);
    expect(() => parseSoundManifest(JSON.stringify({ ...manifest, sounds: [{ ...manifest.sounds[0], category: "nope" }] }))).toThrow(/bad sound/);
    expect(() => parseSoundManifest(JSON.stringify({ ...manifest, sounds: [{ ...manifest.sounds[0], durationMs: 0 }] }))).toThrow(/bad sound/);
    expect(() => parseSoundManifest(JSON.stringify({ ...manifest, sounds: [{ ...manifest.sounds[0], peaks: [] }] }))).toThrow(/peaks/);
    expect(() => parseSoundManifest(JSON.stringify({ ...manifest, sounds: [{ ...manifest.sounds[0], peaks: [2] }] }))).toThrow(/peaks/);
    expect(() => parseSoundManifest("{}")).toThrow();
  });

  it("builds the catalogue with a URL per sound and no file key", async () => {
    const catalogue = await buildSoundCatalogue(parseSoundManifest(JSON.stringify(manifest)), async (key) => `https://cdn.test/${key}`);
    expect(catalogue.sounds.map((s) => s.url)).toEqual(["https://cdn.test/soudeffects/ui/pop.m4a", "https://cdn.test/soudeffects/impacts/boom.m4a"]);
    expect(catalogue.categories.map((c) => c.title)).toEqual(["UI", "Impacts"]);
    expect(catalogue.sounds[0]).not.toHaveProperty("file");
    expect(catalogue.sounds[0].durationMs).toBe(180);
    expect(catalogue.sounds[0].peaks).toEqual([1, 0.5, 0.2]);
  });
});
