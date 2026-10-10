/**
 * Lightweight structural validation for raw HTML projects. It only checks
 * the handful of structural invariants a headless-browser renderer needs:
 *
 * 1. Exactly one valid `<meta name="neonix-document">` composition tag.
 * 2. No `<script>` tags (no JS).
 * 3. The outermost sized element - `<body>`, or if body itself declares no
 *    width/height, its single top-level wrapping element - declares a
 *    width/height in px matching the composition exactly.
 *
 * API-local raw HTML validation.
 */

export type RawHtmlValidationError = {
  code: string;
  message: string;
};

/** Blank starting point for an HTML project - satisfies this file's own rules (inline body size, no script). */
export const DEFAULT_RAW_HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="neonix-document"
      content='{"kind":"neonix-html-document","schemaVersion":2,"composition":{"width":1080,"height":1920,"fps":30,"background":"#000000","colorSpace":"srgb"}}'
    />
  </head>
  <body style="margin:0;width:1080px;height:1920px;background:#000000;">
    <!-- Add your HTML elements here. -->
  </body>
</html>`;

type Composition = { width: number; height: number };

/** Full composition, including the fields only export (not creation validation) requires. */
export type RawHtmlComposition = {
  width: number;
  height: number;
  fps: number | null;
  durationMs: number | null;
};

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function attributeValue(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  return attributes.match(pattern)?.[2];
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** Parses the neonix-document meta tag's full composition. Exported for the export dispatcher, which additionally needs fps/durationMs that creation validation doesn't require. */
export function parseRawHtmlComposition(html: string): RawHtmlComposition | null {
  const matches = [...html.matchAll(/<meta\b([^>]*)>/gi)]
    .filter((match) => attributeValue(match[1] ?? "", "name")?.toLowerCase() === "neonix-document");
  if (matches.length !== 1) return null;
  const content = attributeValue(matches[0]?.[1] ?? "", "content");
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeHtmlAttribute(content));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.kind !== "neonix-html-document" || record.schemaVersion !== 2) return null;
  const composition = record.composition;
  if (!composition || typeof composition !== "object" || Array.isArray(composition)) return null;
  const c = composition as Record<string, unknown>;
  if (!Number.isInteger(c.width) || Number(c.width) <= 0) return null;
  if (!Number.isInteger(c.height) || Number(c.height) <= 0) return null;
  const fps = typeof c.fps === "number" && Number.isFinite(c.fps) && c.fps > 0 ? c.fps : null;
  const durationMs = typeof c.durationMs === "number" && Number.isFinite(c.durationMs) && c.durationMs > 0 ? c.durationMs : null;
  return { width: Number(c.width), height: Number(c.height), fps, durationMs };
}

function parseNeonixMetaComposition(html: string): Composition | null {
  return parseRawHtmlComposition(html);
}

function styleDeclaresPx(style: string | undefined, property: "width" | "height", expected: number): boolean {
  if (!style) return false;
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\s*(?:;|$)`, "i");
  const match = style.match(pattern);
  return match ? Number(match[1]) === expected : false;
}

function extractBody(html: string): { attributes: string; inner: string } | null {
  const match = /<body\b([^>]*)>([\s\S]*)<\/body\s*>/i.exec(html);
  if (!match) return null;
  return { attributes: match[1] ?? "", inner: match[2] ?? "" };
}

/** Finds the first top-level (depth-0) element tag inside a fragment of HTML. */
function firstTopLevelElement(inner: string): { attributes: string } | null {
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(inner))) {
    const [full, tagName, attributes = ""] = match;
    const isClosing = full.startsWith("</");
    const isVoid = VOID_ELEMENTS.has((tagName ?? "").toLowerCase());
    const isSelfClosing = full.endsWith("/>") || isVoid;
    if (isClosing) {
      depth -= 1;
      continue;
    }
    if (depth === 0) {
      if (isSelfClosing) continue; // can't be the required wrapper; keep scanning siblings.
      return { attributes };
    }
    depth += 1;
  }
  return null;
}

export function validateRawHtmlDocument(html: string): RawHtmlValidationError[] {
  const errors: RawHtmlValidationError[] = [];

  if (/<script\b/i.test(html)) {
    errors.push({ code: "html-script-forbidden", message: "Raw HTML projects cannot contain <script> tags" });
  }

  const composition = parseNeonixMetaComposition(html);
  if (!composition) {
    errors.push({
      code: "html-document-metadata-missing",
      message: "The document must contain exactly one meta[name=\"neonix-document\"] with a valid composition",
    });
    return errors; // No composition size to check the root element against.
  }

  const body = extractBody(html);
  if (!body) {
    errors.push({ code: "html-body-missing", message: "The document must contain a <body> element" });
    return errors;
  }

  const bodyStyle = attributeValue(body.attributes, "style");
  const bodyHasSize =
    styleDeclaresPx(bodyStyle, "width", composition.width) &&
    styleDeclaresPx(bodyStyle, "height", composition.height);

  if (!bodyHasSize) {
    const wrapper = firstTopLevelElement(body.inner);
    const wrapperStyle = wrapper ? attributeValue(wrapper.attributes, "style") : undefined;
    const wrapperHasSize =
      wrapper !== null &&
      styleDeclaresPx(wrapperStyle, "width", composition.width) &&
      styleDeclaresPx(wrapperStyle, "height", composition.height);
    if (!wrapperHasSize) {
      errors.push({
        code: "html-root-size-mismatch",
        message: `<body> (or its single top-level wrapping element) must declare width: ${composition.width}px and height: ${composition.height}px matching the neonix-document composition`,
      });
    }
  }

  return errors;
}
