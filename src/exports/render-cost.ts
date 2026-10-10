// Cost of one Cloud Run render execution, from its measured facts and a price list. Pure functions: the result is
// stored on the render_runs row together with the price list used, so old rows never change when prices change.
// Defaults and reasoning: docs/benchmarks/render-cost.md (section 2).

export type RenderPricing = {
  vcpuSecondUsd: number;
  gibSecondUsd: number;
  /** Internet egress from Google Cloud (the upload to R2 leaves Google's network). */
  egressUsdPerGib: number;
  usdVndRate: number;
  /** R2 Class A operation (one PUT of the finished video). */
  r2PutUsd: number;
  /** R2 standard storage, charged here for one month of keeping the output. */
  r2StorageUsdPerGbMonth: number;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function renderPricingFromEnv(): RenderPricing {
  return {
    vcpuSecondUsd: envNumber("RENDER_VCPU_SECOND_USD", 0.000024),
    gibSecondUsd: envNumber("RENDER_GIB_SECOND_USD", 0.0000025),
    egressUsdPerGib: envNumber("RENDER_EGRESS_USD_PER_GIB", 0.12),
    usdVndRate: envNumber("RENDER_USD_VND_RATE", 25500),
    r2PutUsd: envNumber("RENDER_R2_PUT_USD", 4.5e-6),
    r2StorageUsdPerGbMonth: envNumber("RENDER_R2_STORAGE_USD_PER_GB_MONTH", 0.015),
  };
}

export type RenderRunFacts = {
  vcpu: number;
  memoryGib: number;
  /** Cloud Run execution start to completion. */
  billedMs: number;
  outputBytes: number;
};

export type RenderRunCost = {
  computeCostUsdMicros: number;
  egressCostUsdMicros: number;
  storageCostUsdMicros: number;
  totalCostUsdMicros: number;
  costVnd: number;
};

const MICROS = 1_000_000;

export function computeRenderRunCost(facts: RenderRunFacts, pricing: RenderPricing): RenderRunCost {
  const seconds = facts.billedMs / 1000;
  const computeUsd = seconds * (facts.vcpu * pricing.vcpuSecondUsd + facts.memoryGib * pricing.gibSecondUsd);
  const egressUsd = (facts.outputBytes / 2 ** 30) * pricing.egressUsdPerGib;
  const storageUsd = pricing.r2PutUsd + (facts.outputBytes / 1e9) * pricing.r2StorageUsdPerGbMonth;
  const computeCostUsdMicros = Math.round(computeUsd * MICROS);
  const egressCostUsdMicros = Math.round(egressUsd * MICROS);
  const storageCostUsdMicros = Math.round(storageUsd * MICROS);
  const totalCostUsdMicros = computeCostUsdMicros + egressCostUsdMicros + storageCostUsdMicros;
  return {
    computeCostUsdMicros,
    egressCostUsdMicros,
    storageCostUsdMicros,
    totalCostUsdMicros,
    costVnd: Math.round((totalCostUsdMicros / MICROS) * pricing.usdVndRate),
  };
}
