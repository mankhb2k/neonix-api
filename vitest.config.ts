import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// swc (not esbuild) so Nest's `design:paramtypes` decorator metadata is emitted.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
});
