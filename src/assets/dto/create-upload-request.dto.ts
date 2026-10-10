import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from "class-validator";

const ASSET_KINDS = ["image", "video", "audio", "font", "other"];

export class CreateUploadRequestDto {
  @IsUUID()
  workspaceId!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  byteSize!: number;

  @IsOptional()
  @IsIn(ASSET_KINDS)
  kind?: string;

  @IsOptional()
  @IsString()
  originalFilename?: string;
}
