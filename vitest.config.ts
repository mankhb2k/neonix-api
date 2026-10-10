import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // Vitest's default esbuild transform strips decorators but does not
    // emit the `design:paramtypes` metadata NestJS's DI container reads at
    // runtime - confirmed for real: an implicit-type constructor param came
    // through as `undefined` under esbuild, and only worked once compiled
    // with a transform that honors `emitDecoratorMetadata` (real `tsc`, and
    // this swc plugin). Required for every Nest module to be testable.
    swc.vite({ module: { type: "es6" } }),
  ],
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // These are real integration tests against Neon/R2/Redis, not mocked
    // unit tests - vitest's 5s default is too tight once several test files
    // each open a fresh connection to real remote services in parallel
    // (e.g. Neon's compute waking from idle under concurrent cold connects).
    testTimeout: 20_000,
    // Every test file shares ONE real seed workspace in Neon (real
    // account-plan quotas, real active-project counts, etc.) - there is no
    // per-file isolation for this shared external state. Running files in
    // parallel (vitest's default) causes real, hard-to-fully-eliminate
    // races: e.g. a test that deliberately drops the seed account's
    // active-project quota to 1 for one assertion can transiently break
    // ANY other file's concurrent project creation, no matter how high the
    // normal quota is set. Per-test immediate cleanup (see individual test
    // files' own comments) reduces this but cannot fully remove it while
    // files run concurrently. Sequential file execution is the actual fix.
    fileParallelism: false,
  },
});
