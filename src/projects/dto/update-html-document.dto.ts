import { IsString } from "class-validator";

export class UpdateHtmlDocumentDto {
  @IsString()
  html!: string;
}
