/**
 * Vitest configuration for SimpleLogin MCP unit tests.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
