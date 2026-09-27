import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@evolu/common",
    ],
    // Evolu's web runtime ships its own worker and sqlite wasm; pre-bundling
    // them breaks the worker URL resolution.
    exclude: ["@evolu/react-web", "@evolu/web", "@evolu/sqlite-wasm"],
  },
});
