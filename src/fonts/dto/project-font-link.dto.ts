import { IsOptional, IsString, IsUUID } from "class-validator";

export class ProjectFontLinkDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  fontFamilyId!: string;

  @IsOptional()
  @IsString()
  alias?: string;
}
