import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json so tests import modules exactly as the app does.
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // Colocated beside the module under test, per docs/parallel-plan.md.
    include: ["src/**/*.test.ts"],
  },
});
