// API-local font metadata helpers.
import { create } from "fontkit";
import { resolveCssWeight, resolveFontStyle, type FontStyle } from "./font-face-metadata";

export const USER_FONT_FORMATS = ["ttf", "woff", "woff2"] as const;
export type UserFontFormat = (typeof USER_FONT_FORMATS)[number];
export type { FontStyle };

export type ParsedFontMetadata = {
  familyName: string;
  subfamilyName: string;
  postscriptName: string | null;
  version: string;
  weight: number;
  style: FontStyle;
  widthClass: "normal";
  axes: Record<string, unknown>;
  faceKey: string;
};

function normalized(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function formatFromFilename(name: string): UserFontFormat | null {
  const extension = name.toLowerCase().split(".").pop();
  return USER_FONT_FORMATS.includes(extension as UserFontFormat)
    ? extension as UserFontFormat
    : null;
}

export function mimeTypeForFontFormat(format: UserFontFormat): string {
  return `font/${format}`;
}

export function parseUserFont(buffer: Buffer): ParsedFontMetadata {
  let font: ReturnType<typeof create>;
  try {
    font = create(buffer);
  } catch {
    throw new Error("The file is not a valid static font");
  }

  const familyName = normalized(typeof font.familyName === "string" ? font.familyName : "");
  const subfamilyName = normalized(typeof font.subfamilyName === "string" ? font.subfamilyName : "Regular") || "Regular";
  if (!familyName) throw new Error("Font family metadata is missing");

  const axes = font.variationAxes && typeof font.variationAxes === "object" ? font.variationAxes : {};
  if (font.isVariable || Object.keys(axes).length > 0 || /\[[^\]]+\]/.test(familyName) || /\[[^\]]+\]/.test(subfamilyName)) {
    throw new Error("Variable fonts are not supported. Upload a static .ttf, .woff, or .woff2 face");
  }

  const os2 = font["OS/2"] as { usWeightClass?: unknown; fsSelection?: { italic?: boolean; oblique?: boolean } } | undefined;
  const weight = resolveCssWeight(subfamilyName, os2?.usWeightClass);
  const style = resolveFontStyle(subfamilyName, os2?.fsSelection?.italic === true, os2?.fsSelection?.oblique === true);
  return {
    familyName,
    subfamilyName,
    postscriptName: typeof font.postscriptName === "string" ? font.postscriptName : null,
    version: typeof font.version === "string" ? font.version : "default",
    weight,
    style,
    widthClass: "normal",
    axes: {},
    faceKey: `${familyName.toLocaleLowerCase()}|${weight}|${style}`,
  };
}
