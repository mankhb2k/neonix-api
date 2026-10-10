import { IsUUID } from "class-validator";

export class AttachAssetDto {
  @IsUUID()
  assetId!: string;
}
