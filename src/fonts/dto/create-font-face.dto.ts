import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

const STYLES = ["normal", "italic", "oblique"];
const WIDTH_CLASSES = [
  "ultra-condensed", "extra-condensed", "condensed", "semi-condensed",
  "normal",
  "semi-expanded", "expanded", "extra-expanded", "ultra-expanded",
];
const FORMATS = ["woff2", "woff", "ttf"];

export class CreateFontFaceDto {
  @IsUUID()
  assetId!: string;

  @IsString()
  faceKey!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  weight!: number;

  @IsOptional()
  @IsIn(STYLES)
  style?: string;

  @IsOptional()
  @IsIn(WIDTH_CLASSES)
  widthClass?: string;

  @IsIn(FORMATS)
  format!: string;
}
