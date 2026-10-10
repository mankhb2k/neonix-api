import { IsNumber, Max, Min } from "class-validator";

// Matches the minimum amount configured on the Polar top-up product.
const MIN_TOPUP_USD = 10;
const MAX_TOPUP_USD = 2000;

export class CreateCheckoutDto {
  @IsNumber()
  @Min(MIN_TOPUP_USD)
  @Max(MAX_TOPUP_USD)
  amountUsd!: number;
}
