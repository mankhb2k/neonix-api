import { IsObject, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateAuditEventDto {
  @IsUUID()
  workspaceId!: string;

  @IsString()
  action!: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsObject()
  metadataJson?: Record<string, unknown>;
}
