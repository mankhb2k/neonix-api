import { IsOptional, IsString, IsUUID } from "class-validator";

export class CreateFontFamilyDto {
  @IsUUID()
  workspaceId!: string;

  @IsString()
  slug!: string;

  @IsString()
  familyName!: string;

  @IsOptional()
  @IsString()
  license?: string;
}
