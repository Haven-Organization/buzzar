// Plan 02 phase 0: builds the matrix-js-sdk spike page on its own (`vite build --config spikes/matrix-js-sdk/vite.spike.config.ts`),
// so the app's build and deploys are untouched.
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "../../dist-spike"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
