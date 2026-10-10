import { describe, expect, it } from "vitest";
import { computeRenderRunCost, type RenderPricing } from "./render-cost";

const PRICING: RenderPricing = {
  vcpuSecondUsd: 0.000024,
  gibSecondUsd: 0.0000025,
  egressUsdPerGib: 0.12,
  usdVndRate: 25500,
  r2PutUsd: 4.5e-6,
  r2StorageUsdPerGbMonth: 0.015,
};

describe("computeRenderRunCost", () => {
  it("matches the c8a row of docs/benchmarks/render-cost.md (8 vCPU / 16 GiB, 158.4 s, 8.8 MB = $0.0379, 966 VND)", () => {
    const cost = computeRenderRunCost({ vcpu: 8, memoryGib: 16, billedMs: 158_400, outputBytes: 8_814_109 }, PRICING);
    expect(cost).toEqual({
      computeCostUsdMicros: 36_749,
      egressCostUsdMicros: 985,
      storageCostUsdMicros: 137,
      totalCostUsdMicros: 37_871,
      costVnd: 966,
    });
  });

  it("keeps the total equal to the sum of its parts (the table has a check constraint for this)", () => {
    const cost = computeRenderRunCost({ vcpu: 8, memoryGib: 16, billedMs: 662_400, outputBytes: 16_491_761 }, PRICING);
    expect(cost.totalCostUsdMicros).toBe(cost.computeCostUsdMicros + cost.egressCostUsdMicros + cost.storageCostUsdMicros);
  });

  it("costs nothing for a zero-length run with an empty output except the single R2 write", () => {
    const cost = computeRenderRunCost({ vcpu: 4, memoryGib: 16, billedMs: 0, outputBytes: 0 }, PRICING);
    expect(cost.computeCostUsdMicros).toBe(0);
    expect(cost.egressCostUsdMicros).toBe(0);
    expect(cost.storageCostUsdMicros).toBe(5);
  });
});
