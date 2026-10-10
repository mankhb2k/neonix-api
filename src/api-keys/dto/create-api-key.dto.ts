import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;
}
