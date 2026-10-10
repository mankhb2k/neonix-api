import { IsUUID } from "class-validator";

export class CompleteFontUploadDto {
  @IsUUID()
  assetId!: string;
}
