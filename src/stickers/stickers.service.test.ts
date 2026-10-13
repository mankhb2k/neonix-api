import { describe, expect, it } from "vitest";
import { buildCatalogue, parseManifest } from "./stickers.service";

const manifest = {
  version: 1,
  license: { name: "MIT", holder: "Microsoft Corporation", source: "https://github.com/microsoft/fluentui-emoji", file: "stickers/LICENSE.txt" },
  categories: [{ id: "smileys-emotion", title: "Smileys" }, { id: "food-drink", title: "Food" }],
  stickers: [
    { id: "grinning-face", name: "Grinning face", category: "smileys-emotion", file: "stickers/smileys-emotion/grinning-face.png", width: 256, height: 256 },
    { id: "sushi", name: "Sushi", category: "food-drink", file: "stickers/food-drink/sushi.png", width: 256, height: 256 },
  ],
};

describe("sticker manifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest(JSON.stringify(manifest)).stickers).toHaveLength(2);
  });

  it("rejects an unknown version, a duplicate id and a sticker in an unknown category", () => {
    expect(() => parseManifest(JSON.stringify({ ...manifest, version: 2 }))).toThrow(/version/);
    expect(() => parseManifest(JSON.stringify({ ...manifest, stickers: [manifest.stickers[0], manifest.stickers[0]] }))).toThrow(/duplicate/);
    expect(() => parseManifest(JSON.stringify({ ...manifest, stickers: [{ ...manifest.stickers[0], category: "nope" }] }))).toThrow(/bad sticker/);
    expect(() => parseManifest("{}")).toThrow();
  });

  it("builds the catalogue with a URL per sticker, keeping the license and categories", async () => {
    const asked: string[] = [];
    const catalogue = await buildCatalogue(parseManifest(JSON.stringify(manifest)), async (key) => { asked.push(key); return `https://cdn.test/${key}`; });
    expect(catalogue.stickers.map((s) => s.url)).toEqual(["https://cdn.test/stickers/smileys-emotion/grinning-face.png", "https://cdn.test/stickers/food-drink/sushi.png"]);
    expect(asked).toHaveLength(2);
    expect(catalogue.categories.map((c) => c.title)).toEqual(["Smileys", "Food"]);
    expect(catalogue.license.name).toBe("MIT");
    expect(catalogue.stickers[0]).not.toHaveProperty("file");
  });
});
