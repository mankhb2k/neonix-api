# Template package (`package.zip`)

One immutable zip per template version, stored in the private R2 bucket at
`creators/{creatorId}/{templateId}/v{n}/package.zip`. The public preview video/image is **not**
in the zip (separate bucket, `creators/{creatorId}/{templateId}/{uuid}.ext`).

```
package.zip
├── manifest.json   required
├── document.json   required  (the app's EditorDocument, not compiled Protocol V2)
└── assets/         optional  (fixed media owned by the template: music, stickers, LUTs, decorative images/video)
```

- **Fonts are never packaged.** They ship inside the iOS app; `manifest.fonts` only names them.
- **Slot media is never packaged.** A slot is a layer left empty for the user to fill.
- Music / stickers may either live in `assets/` (referenced by relative path, e.g. `assets/bgm.m4a`)
  or be referenced by id when the app itself ships them (`manifest.builtinAssets`). Both can be mixed.
- No absolute / `http(s)` URIs and no `..` paths in `document.json`.

## manifest.json

```json
{
  "formatVersion": 2,
  "minAppVersion": "1.0",
  "name": "Summer Vlog",
  "composition": { "width": 1080, "height": 1920, "durationMs": 15000 },
  "fonts": ["Montserrat-Bold"],
  "builtinAssets": ["sfx-whoosh"],
  "music": { "title": "Summer Days", "artist": "Neonix" },
  "slots": [
    { "id": "s1", "kind": "media", "layerId": "layer-3", "label": "Opening clip", "durationMs": 3000, "required": true },
    { "id": "s2", "kind": "media", "layerId": "layer-5", "label": "Memory photo", "durationMs": 2000, "required": false },
    { "id": "s3", "kind": "text",  "layerId": "layer-8", "label": "Title", "required": true }
  ]
}
```

- `slots[].layerId` points at a layer in `document.json`. **Media slots** (`"kind": "media"`) take a photo or a
  video: the app swaps the layer's kind and asset. `durationMs` is the length the clip fills: a photo is held that
  long, a video shorter than it is refused, a longer one is cropped to a window of exactly that length (the user
  picks where it starts). **Text slots** (`"kind": "text"`): the app runs `SetTextContentCommand`.
- **Music** is real audio: `document.json` carries an `audio` domain whose clips use an audio asset stored in
  `assets/`. `manifest.music` is only the label shown in the viewer. The app unpacks `assets/*` into its media
  folder and rewrites those asset paths.
- `formatVersion` is the EditorDocument format. The app refuses a package newer than it supports
  (`minAppVersion` is what the catalogue shows).

## What the server knows

The server does not unzip. At `POST /v1/creator/templates/:id/versions/:n/complete` the creator's app
sends `sha256` plus a summary read from the manifest (`slotCount`, `width`, `height`, `durationMs`);
it is stored on `template_versions` for filtering/display only, never for pricing or review.
Real validation (unzip, forbidden paths, size) belongs in `src/templates/review-policy.ts` later.

## Flow

1. Creator: `POST /v1/creator/templates` → `POST .../preview-upload` (`kind: "poster"`, required; and optionally a
   short looping `kind: "preview"` mp4) → `PATCH` the keys → `POST .../versions` (presigned PUT) → PUT zip → `.../complete` → `.../submit`.
2. User browses `GET /v1/templates` (preview URL, slotCount, size, aspect), then
   `GET /v1/templates/:id/package` (free presigned download).
3. User edits on device; at Export the app calls `POST /v1/exports { templateId }`. The first export of a template buys it
   (credits spent once); every later export is free. Then the device exports locally.
