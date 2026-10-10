import { IsInt, Max, Min } from "class-validator";

export const MIN_TOPUP_VND = 10_000;
export const MAX_TOPUP_VND = 50_000_000;

export class CreatePayosOrderDto {
  @IsInt()
  @Min(MIN_TOPUP_VND)
  @Max(MAX_TOPUP_VND)
  amountVnd!: number;
}
