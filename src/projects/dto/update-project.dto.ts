import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";

export class UpdateProjectDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  title!: string;
}
