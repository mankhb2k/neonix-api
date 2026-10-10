declare module "fontkit" {
  export type FontkitFont = {
    familyName?: string;
    subfamilyName?: string;
    postscriptName?: string;
    version?: string;
    italicAngle?: number;
    variationAxes?: Record<string, unknown>;
    isVariable?: boolean;
    [key: string]: unknown;
  };

  export function create(buffer: Buffer): FontkitFont;
}
