import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [wgslVitePlugin({ minify: true })],
  build: { target: "es2022" },
});
