// Shared font-face metadata resolution for the user-upload path
// (font-metadata.ts). Kept local to the API font boundary.
//
// Standard: OpenType/CSS font matching always treats the font's binary
// metadata (OS/2 table) as authoritative and the name-table strings
// (family/subfamily) as display-only. Name-string parsing here is a
// fallback, never the primary signal.

export type FontStyle = "normal" | "italic" | "oblique";

export const CSS_WEIGHT_NAME_PATTERNS: Array<[RegExp, number]> = [
  [/hairline|thin/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/regular|book|normal|roman/i, 400],
  [/medium/i, 500],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/bold/i, 700],
  [/black|heavy/i, 900],
];

/**
 * OS/2 usWeightClass is the authoritative binary metadata. Some families
 * (for example Lora) encode Medium/SemiBold as a `Regular` subfamily while
 * the actual weight is stored correctly in OS/2. Reading the subfamily first
 * collapses those faces into weight 400.
 */
export function resolveCssWeight(subfamilyName: string, os2WeightClass: unknown): number {
  const numeric = Number(os2WeightClass);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 1000) {
    return Math.round(numeric);
  }
  const named = CSS_WEIGHT_NAME_PATTERNS.find(([pattern]) => pattern.test(subfamilyName));
  if (named) return named[1];
  return Number.isFinite(numeric) ? Math.max(1, Math.min(1000, Math.round(numeric / 100) * 100)) : 400;
}

/**
 * OS/2 fsSelection ITALIC (bit 0) is the authoritative binary signal for
 * italic and is set reliably by virtually all font tools. The OBLIQUE bit
 * (bit 9) was added later (OpenType 1.5) and many genuinely oblique fonts
 * never set it, so unlike weight, the subfamily name is still a routine
 * second opinion here, not just a rare emergency fallback.
 */
export function resolveFontStyle(
  subfamilyName: string,
  isItalicBit: boolean,
  isObliqueBit: boolean,
): FontStyle {
  if (isItalicBit) return "italic";
  if (isObliqueBit || /oblique/i.test(subfamilyName)) return "oblique";
  if (/italic/i.test(subfamilyName)) return "italic";
  return "normal";
}
