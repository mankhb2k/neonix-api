import { IsOptional, IsString, IsUUID, Length } from "class-validator";

export class CreateHtmlProjectDto {
  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsString()
  html!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  idempotencyKey?: string;
}
