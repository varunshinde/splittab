import { defineConfig } from "vitest/config";
import path from "path";

// Mirror the tsconfig "@/*" path alias so tests can import app modules.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
