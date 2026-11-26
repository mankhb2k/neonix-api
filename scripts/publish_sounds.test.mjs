import { describe, expect, it } from "vitest";
import { displayName, mergeManifest, peaksOf, validateManifest } from "./publish_sounds.mjs";

const sound = (id, category, extra = {}) => ({ id, name: id, category, file: `soudeffects/${category}/${id}.m4a`, durationMs: 500, mimeType: "audio/mp4", peaks: [0.5, 1], ...extra });

describe("displayName", () => {
  it("turns kebab-case into words", () => {
    expect(displayName("bone-crack")).toBe("Bone Crack");
    expect(displayName("pop")).toBe("Pop");
  });
});

describe("peaksOf", () => {
  it("is all zeros for silence and for no samples", () => {
    expect(peaksOf(new Int16Array(0), 4)).toEqual([0, 0, 0, 0]);
    expect(peaksOf(new Int16Array(100), 4)).toEqual([0, 0, 0, 0]);
  });
  it("scales the loudest slice to 1, whatever the sign", () => {
    const samples = new Int16Array(8);
    samples[0] = 1000;
    samples[6] = -2000;
    expect(peaksOf(samples, 4)).toEqual([0.5, 0, 0, 1]);
  });
  it("has the number of slices asked for, even with fewer samples than slices", () => {
    const peaks = peaksOf(new Int16Array([100, 200]), 4);
    expect(peaks).toHaveLength(4);
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
  });
});

describe("mergeManifest", () => {
  it("starts a manifest when none is published", () => {
    const { manifest, replaced } = mergeManifest(null, ["ui"], [sound("sfx-b", "ui"), sound("sfx-a", "ui")]);
    expect(replaced).toEqual([]);
    expect(manifest.categories).toEqual([{ id: "ui", title: "UI" }]);
    expect(manifest.sounds.map((s) => s.id)).toEqual(["sfx-a", "sfx-b"]);
  });
  it("keeps published sounds and categories, replaces the same id, appends new categories", () => {
    const base = { version: 1, categories: [{ id: "ui", title: "My UI" }], sounds: [sound("sfx-click", "ui", { durationMs: 50 }), sound("sfx-pop", "ui")] };
    const { manifest, replaced } = mergeManifest(base, ["ui", "meme"], [sound("sfx-click", "ui", { durationMs: 230 }), sound("sfx-yeet", "meme")]);
    expect(replaced).toEqual(["sfx-click"]);
    expect(manifest.categories).toEqual([{ id: "ui", title: "My UI" }, { id: "meme", title: "Memes" }]);
    expect(manifest.sounds.find((s) => s.id === "sfx-click")?.durationMs).toBe(230);
    expect(manifest.sounds.map((s) => s.id)).toEqual(["sfx-click", "sfx-pop", "sfx-yeet"]);
    expect(base.sounds[0].durationMs).toBe(50);
  });
});

describe("validateManifest", () => {
  const manifest = (sounds) => ({ version: 1, categories: [{ id: "ui", title: "UI" }], sounds });
  it("accepts a good manifest", () => {
    expect(() => validateManifest(manifest([sound("sfx-a", "ui")]))).not.toThrow();
  });
  it.each([
    ["an unknown category", sound("sfx-a", "nope")],
    ["no duration", sound("sfx-a", "ui", { durationMs: 0 })],
    ["peaks above 1", sound("sfx-a", "ui", { peaks: [1.2] })],
    ["no peaks", sound("sfx-a", "ui", { peaks: [] })],
    ["no file", sound("sfx-a", "ui", { file: "" })],
  ])("rejects %s", (_, bad) => {
    expect(() => validateManifest(manifest([bad]))).toThrow();
  });
  it("rejects a repeated id", () => {
    expect(() => validateManifest(manifest([sound("sfx-a", "ui"), sound("sfx-a", "ui")]))).toThrow(/duplicate/);
  });
});
