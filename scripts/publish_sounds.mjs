#!/usr/bin/env node
// Publishes the sound-effect library to the system-assets bucket.
//
//   node --env-file=.env scripts/publish_sounds.mjs --src "../sound effect"            # dry run: encodes into --out, prints the plan, uploads nothing
//   node --env-file=.env scripts/publish_sounds.mjs --src "../sound effect" --upload   # also uploads the .m4a files, then manifest.json last
//
// --src is a folder of category folders (transitions/, ui/ ...) of .mp3 or .m4a files named in kebab-case. Each file becomes
// soudeffects/<category>/<name>.m4a (AAC) and one entry of soudeffects/manifest.json, which the API serves at GET /v1/sounds.
// The manifest already in the bucket is kept: sounds that are not in --src stay, a sound with the same id is replaced.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const PREFIX = "soudeffects";
const PEAK_SLICES = 48;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Titles for the categories this script adds; a category already in the manifest keeps its own title.
const CATEGORY_TITLES = {
  transitions: "Transitions",
  ui: "UI",
  impacts: "Impacts",
  game: "Game & Magic",
  fun: "Fun",
  voice: "Voice",
  meme: "Memes",
};

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { src: "", out: path.join(tmpdir(), "neonix-sounds"), upload: false, keepFormat: false, manifestOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--upload") options.upload = true;
    // The files are used as they are (no AAC encode): for a folder that was already uploaded by hand under the same names.
    else if (arg === "--keep-format") options.keepFormat = true;
    // With --upload: write manifest.json only, not the audio files.
    else if (arg === "--manifest-only") options.manifestOnly = true;
    else if (arg === "--src") options.src = argv[++i] ?? "";
    else if (arg === "--out") options.out = argv[++i] ?? "";
    else fail(`unknown argument ${arg}`);
  }
  if (!options.src) fail("--src <folder> is required");
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, { maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) fail(`${command} failed: ${result.stderr?.toString().slice(-400)}`);
  return result.stdout;
}

/** "bone-crack" -> "Bone Crack". */
export function displayName(slug) {
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Loudness per slice, 0...1, loudest slice = 1; what the picker draws before the file is downloaded. */
export function peaksOf(samples, slices = PEAK_SLICES) {
  const peaks = new Array(slices).fill(0);
  if (samples.length === 0) return peaks;
  const per = samples.length / slices;
  for (let s = 0; s < slices; s++) {
    const from = Math.floor(s * per);
    const to = Math.max(from + 1, Math.floor((s + 1) * per));
    let max = 0;
    for (let i = from; i < to && i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
    peaks[s] = max;
  }
  const loudest = Math.max(...peaks);
  return peaks.map((p) => (loudest > 0 ? Math.round((p / loudest) * 100) / 100 : 0));
}

/** Merges the new sounds into the manifest that is already published: same id replaces, others stay, new categories come last. */
export function mergeManifest(base, categories, sounds) {
  const knownCategories = new Map((base?.categories ?? []).map((c) => [c.id, c]));
  for (const id of categories) if (!knownCategories.has(id)) knownCategories.set(id, { id, title: CATEGORY_TITLES[id] ?? displayName(id) });
  const byId = new Map((base?.sounds ?? []).map((s) => [s.id, s]));
  const replaced = [];
  for (const sound of sounds) {
    if (byId.has(sound.id)) replaced.push(sound.id);
    byId.set(sound.id, sound);
  }
  const order = [...knownCategories.keys()];
  const merged = [...byId.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));
  return { manifest: { version: 1, categories: [...knownCategories.values()], sounds: merged }, replaced };
}

/** The checks the API makes when it reads the manifest (SoundsService.parseSoundManifest); a manifest that fails them is never uploaded. */
export function validateManifest(manifest) {
  const categories = new Set(manifest.categories.map((c) => c.id));
  const ids = new Set();
  for (const s of manifest.sounds) {
    if (!s.id || !s.file || !(s.durationMs > 0) || !categories.has(s.category)) throw new Error(`bad sound entry ${JSON.stringify({ ...s, peaks: undefined })}`);
    if (!Array.isArray(s.peaks) || s.peaks.length === 0 || !s.peaks.every((p) => typeof p === "number" && p >= 0 && p <= 1)) throw new Error(`bad peaks for ${s.id}`);
    if (ids.has(s.id)) throw new Error(`duplicate sound id ${s.id}`);
    ids.add(s.id);
  }
}

function listSource(src) {
  const found = [];
  for (const category of readdirSync(src).sort()) {
    const dir = path.join(src, category);
    if (!statSync(dir).isDirectory()) continue;
    if (!SLUG.test(category)) fail(`category folder "${category}" is not kebab-case`);
    for (const file of readdirSync(dir).sort()) {
      const ext = path.extname(file).toLowerCase();
      if (ext !== ".mp3" && ext !== ".m4a") continue;
      const slug = path.basename(file, ext);
      if (!SLUG.test(slug)) fail(`${category}/${file}: the name must be kebab-case (lowercase letters, digits, hyphens)`);
      found.push({ category, slug, file: path.join(dir, file) });
    }
  }
  return found;
}

function s3FromEnv() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_SYSTEM_ASSETS_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_SYSTEM_ASSETS_BUCKET) return null;
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT?.trim() || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return { client, bucket: R2_SYSTEM_ASSETS_BUCKET };
}

async function readPublishedManifest(s3) {
  if (!s3) return null;
  try {
    const result = await s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: `${PREFIX}/manifest.json` }));
    return JSON.parse((await result.Body?.transformToString("utf-8")) ?? "");
  } catch (error) {
    if (error?.name === "NoSuchKey") return null;
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sources = listSource(path.resolve(options.src));
  if (sources.length === 0) fail("no .mp3 or .m4a files found");

  rmSync(options.out, { recursive: true, force: true });
  const sounds = [];
  const localPaths = new Map();
  for (const source of sources) {
    let target = source.file;
    let ext = path.extname(source.file).toLowerCase();
    if (!options.keepFormat) {
      const dir = path.join(options.out, PREFIX, source.category);
      mkdirSync(dir, { recursive: true });
      target = path.join(dir, `${source.slug}.m4a`);
      ext = ".m4a";
      run("ffmpeg", ["-v", "error", "-y", "-i", source.file, "-vn", "-map_metadata", "-1", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", target]);
    }
    const seconds = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target]).toString().trim());
    const pcm = run("ffmpeg", ["-v", "error", "-i", target, "-ac", "1", "-ar", "22050", "-f", "s16le", "-"]);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    const file = `${PREFIX}/${source.category}/${source.slug}${ext}`;
    localPaths.set(file, target);
    sounds.push({
      id: `sfx-${source.slug}`,
      name: displayName(source.slug),
      category: source.category,
      file,
      durationMs: Math.round(seconds * 1000),
      mimeType: ext === ".mp3" ? "audio/mpeg" : "audio/mp4",
      peaks: peaksOf(samples),
    });
  }

  const s3 = s3FromEnv();
  if (options.upload && !s3) fail("--upload needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_SYSTEM_ASSETS_BUCKET (run with --env-file=.env)");
  const published = await readPublishedManifest(s3);
  const { manifest, replaced } = mergeManifest(published, [...new Set(sources.map((s) => s.category))], sounds);
  validateManifest(manifest);
  mkdirSync(path.join(options.out, PREFIX), { recursive: true });
  writeFileSync(path.join(options.out, PREFIX, "manifest.json"), JSON.stringify(manifest));

  console.log(`${sounds.length} sounds encoded into ${options.out}`);
  console.log(`manifest: ${manifest.sounds.length} sounds in ${manifest.categories.length} categories (${published ? "merged with the published one" : "no published manifest found"})`);
  console.log(`replaces ${replaced.length} published sounds: ${replaced.join(", ") || "none"}`);
  for (const category of manifest.categories) console.log(`  ${category.id}: ${manifest.sounds.filter((s) => s.category === category.id).length}`);
  if (!options.upload) {
    console.log("dry run: nothing uploaded (add --upload)");
    return;
  }

  for (const sound of options.manifestOnly ? [] : sounds) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: sound.file,
        Body: readFileSync(localPaths.get(sound.file)),
        ContentType: sound.mimeType,
        CacheControl: "public, max-age=86400",
      }),
    );
  }
  // The manifest goes last, so it never names a file that is not there yet.
  await s3.client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: `${PREFIX}/manifest.json`,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    }),
  );
  console.log(options.manifestOnly ? "uploaded the manifest" : `uploaded ${sounds.length} files and the manifest`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => fail(error?.message ?? String(error)));
}
